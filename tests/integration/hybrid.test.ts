import { randomUUID } from "node:crypto";
import { UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { expect, it } from "vitest";
import { apiAuth } from "../../apps/api/auth.ts";
import { buildApi } from "../../apps/api/server.ts";
import { workOnce } from "../../apps/consolidation-worker/work.ts";
import { consolidate } from "../../packages/ai/consolidation/index.ts";
import { MockModelProvider } from "../../packages/ai/providers/mock/index.ts";
import { AwsApiQueries } from "../../packages/aws-adapters/api-queries.ts";
import { AwsConsolidationJobs } from "../../packages/aws-adapters/jobs.ts";
import { AwsConsolidationRepository } from "../../packages/aws-adapters/consolidations.ts";
import { AwsResultStore } from "../../packages/aws-adapters/result-store.ts";
import { parseAgentResultEvent } from "../../packages/contracts/src/index.ts";
import { bootstrap, localAws } from "../../infrastructure/bootstrap/resources.ts";

async function fixture(debounceMs = 100) {
  const aws = localAws(`hybrid-${randomUUID().slice(0, 12)}`);
  const resources = await bootstrap(aws);
  const table = resources.consolidations;
  let time = Date.parse("2026-11-07T00:00:00Z");
  const now = () => time;
  const advance = (ms: number) => { time += ms; };
  const jobs = new AwsConsolidationJobs(aws.dynamo, table);
  const reports = new AwsConsolidationRepository(aws, table, resources.bucket);
  const results = new AwsResultStore(aws, resources.results, resources.bucket, { table, debounceMs, now });
  const queries = new AwsApiQueries(aws.dynamo, resources.results, table);
  const scope = { projectId: "demo", topic: "sample" };
  const provider = new MockModelProvider();
  const deps = {
    now, jobs, results, provider, leaseMs: 1000,
    reports: (lease: Parameters<typeof jobs.fence>[0]) =>
      new AwsConsolidationRepository(aws, table, resources.bucket, () => jobs.fence(lease, now())),
  };
  const publish = async (agentId: string, revision = 1, projectId = scope.projectId) => {
    const event = parseAgentResultEvent({
      ...scope, projectId, schemaVersion: 1, eventType: "agent.result", eventId: randomUUID(),
      agentId, agentVersion: "1", resultId: agentId, revision, correlationId: "group",
      occurredAt: new Date(now()).toISOString(), status: "completed",
      summary: "Observed a sample value", contentType: "application/json", data: { value: 10 },
      sources: [], metadata: {},
    });
    await results.save(event);
    return event;
  };
  return { aws, resources, now, advance, jobs, reports, results, queries, scope, provider, deps, publish };
}

it("coalesces durable changes, keeps a change made during work, and fences an expired worker", async () => {
  const f = await fixture();
  await f.publish("first");
  f.advance(50);
  const second = await f.publish("second");
  f.advance(50);
  expect(await workOnce(f.deps)).toBe(false);
  expect(await f.results.save(second)).toBe("duplicate");
  f.advance(50);
  await Promise.all([f.jobs.schedule(f.now()), f.jobs.schedule(f.now())]);
  const candidates: NonNullable<Awaited<ReturnType<typeof f.jobs.get>>>[] = [];
  for await (const job of f.jobs.due(f.now())) candidates.push(job);
  expect(candidates).toHaveLength(1);
  const claims = await Promise.all([1, 2].map(() => f.jobs.claim(candidates[0], f.now(), 1000)));
  expect(claims.filter(Boolean)).toHaveLength(1);
  const oldLease = claims.find(Boolean)!;
  await f.publish("second", 2);
  f.advance(100);
  await f.jobs.schedule(f.now());
  const manual = await f.jobs.enqueue({ projectId: "demo" }, true, undefined, f.now());
  expect(await f.jobs.claim(manual, f.now(), 1000)).toBeUndefined();
  f.advance(900);
  await expect(consolidate({
    ...f.deps, now: () => new Date(f.now()), reports: f.deps.reports(oldLease),
  }, oldLease.job.id, oldLease.job.scope)).rejects.toThrow();
  expect(await f.reports.getReport(oldLease.job.id, oldLease.job.scope)).toBeUndefined();
  expect(await f.jobs.finish(oldLease, f.now(), { status: "failed" })).toBe(false);
  for (let i = 0; i < 3; i++) expect(await workOnce(f.deps)).toBe(true);
  expect(await workOnce(f.deps)).toBe(false);
  expect(await f.jobs.get(oldLease.job.id)).toMatchObject({ status: "completed", attempts: 2 });
  const list = await f.queries.consolidations("demo", "reports", { limit: 10 });
  expect(list.items).toHaveLength(3);
}, 40_000);

it("authorizes and paginates API reads, streams scoped invalidations, reuses and forces manual reports", async () => {
  const f = await fixture();
  const token = "demo-token-00000000000000000000000000000";
  const otherToken = "other-token-000000000000000000000000000";
  const headers = { authorization: `Bearer ${token}` };
  const other = { authorization: `Bearer ${otherToken}` };
  const app = await buildApi({
    ...f, logger: false, eventIntervalMs: 25,
    wake: async () => { throw new Error("SQS unavailable"); },
    auth: apiAuth({ API_AUTH_CONFIG: JSON.stringify([
      { token, projects: ["demo"] }, { token: otherToken, projects: ["other"] },
    ]) }),
  });
  try {
    const firstResult = await f.publish("first");
    await f.publish("second");
    const privateResult = await f.publish("private", 1, "other");
    const results = "/api/projects/demo/results";
    expect((await app.inject(results)).statusCode).toBe(401);
    expect((await app.inject({ url: results, headers: other })).statusCode).toBe(403);
    const evidence = (await app.inject({ url: results + "?eventId=" + firstResult.eventId, headers })).json();
    expect(evidence.items).toEqual([firstResult]);
    await f.aws.dynamo.send(new UpdateItemCommand({
      TableName: f.resources.results,
      Key: { pk: { S: `event#${firstResult.eventId}` }, sk: { S: "receipt" } },
      UpdateExpression: "REMOVE resultPk, resultSk",
    }));
    expect((await app.inject({ url: results + "?eventId=" + firstResult.eventId, headers })).json()).toEqual(evidence);
    const forbiddenEvidence = (await app.inject({ url: results + "?eventId=" + privateResult.eventId, headers })).json();
    expect(forbiddenEvidence).toEqual({ items: [], nextCursor: null });
    const page = (await app.inject({ url: results + "?limit=1", headers })).json();
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBeTruthy();
    const next = (await app.inject({ url: results + "?limit=1&cursor=" + page.nextCursor, headers })).json();
    expect(next.items).toHaveLength(1);
    expect(next.items[0].eventId).not.toBe(page.items[0].eventId);
    expect((await app.inject({ url: results + "?topic=sample&cursor=" + page.nextCursor, headers })).statusCode).toBe(400);
    const date = encodeURIComponent(new Date(f.now()).toISOString());
    const ranged = (await app.inject({ url: results + `?topic=sample&from=${date}&to=${date}`, headers })).json();
    expect(ranged.items).toHaveLength(2);
    expect((await app.inject({ url: "/api/agents", headers })).json().items.map((item: { agentId: string }) => item.agentId)).toEqual(["first", "second"]);
    expect((await app.inject("/openapi.json")).json().paths["/api/events"]).toBeDefined();

    const origin = await app.listen({ host: "127.0.0.1", port: 0 });
    const forbidden = await fetch(origin + "/api/events?projectId=other", { headers });
    expect(forbidden.status).toBe(403);
    await forbidden.arrayBuffer();
    const stream = await fetch(origin + "/api/events?projectId=demo", { headers, signal: AbortSignal.timeout(5000) });
    const reader = stream.body!.getReader();
    const decode = new TextDecoder();
    expect(decode.decode((await reader.read()).value)).toContain('"projectId":"demo"');

    const url = "/api/projects/demo/consolidations";
    const post = (force: boolean, key: string) => app.inject({
      method: "POST", url, headers: { ...headers, "idempotency-key": key }, payload: { topic: "sample", force },
    });
    const first = await post(false, "first-request");
    expect(first.statusCode).toBe(202);
    expect(first.headers.location).toBe(`/api/consolidations/${first.json().job.id}`);
    let notice = "";
    while (!notice.includes("event: invalidate")) {
      const frame = await reader.read();
      if (frame.done) throw new Error("SSE closed before project change");
      notice += decode.decode(frame.value);
    }
    await reader.cancel();
    expect((await post(false, "first-request")).json().job.id).toBe(first.json().job.id);
    expect((await post(true, "first-request")).statusCode).toBe(409);
    expect((await app.inject({ url: first.headers.location!, headers: other })).statusCode).toBe(404);
    expect(await workOnce(f.deps)).toBe(true);
    const detail = (await app.inject({ url: first.headers.location!, headers })).json();
    expect(detail).toMatchObject({ job: { status: "completed" }, report: { revision: 1 } });

    const reused = await post(false, "reuse");
    expect(await workOnce(f.deps)).toBe(true);
    const reusedDetail = (await app.inject({ url: reused.headers.location!, headers })).json();
    expect(reusedDetail.report.runId).toBe(detail.report.runId);
    expect(f.provider.invocations).toHaveLength(1);

    const forced = await post(true, "force");
    expect(await workOnce(f.deps)).toBe(true);
    const latest = (await app.inject({ url: forced.headers.location!, headers })).json();
    expect(latest.report.revision).toBe(2);
    expect((await app.inject({ url: `/api/consolidations/${latest.report.reportId}`, headers })).json().report.revision).toBe(2);
    expect((await app.inject({ url: url + "?kind=jobs", headers })).json().items).toHaveLength(3);
    expect((await app.inject({ url, headers })).json().items).toHaveLength(2);
  } finally {
    await app.close();
  }
}, 40_000);

it("persists retry deadlines and recovers a committed report after job acknowledgement is lost", async () => {
  const f = await fixture(10_000);
  await f.publish("first");
  const job = await f.jobs.enqueue(f.scope, true, undefined, f.now());
  expect(await workOnce({ ...f.deps, provider: new MockModelProvider({ failure: "timeout" }) })).toBe(true);
  const retry = (await f.jobs.get(job.id))!;
  expect(retry).toMatchObject({ status: "retry", dueAt: f.now() + 1000, error: "timeout" });
  f.advance(1000);
  const lease = (await f.jobs.claim(retry, f.now(), 1000))!;
  const report = await consolidate({ ...f.deps, now: () => new Date(f.now()), reports: f.deps.reports(lease) }, job.id, f.scope);
  expect(report.revision).toBe(1);
  f.advance(1000);
  expect(await workOnce(f.deps)).toBe(true);
  expect(await f.jobs.get(job.id)).toMatchObject({ status: "completed", reportRunId: job.id });
  expect(f.provider.invocations).toHaveLength(1);
}, 40_000);
