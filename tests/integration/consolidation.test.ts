import { randomUUID } from "node:crypto";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { expect, it } from "vitest";
import { bootstrap, localAws } from "../../infrastructure/bootstrap/resources.ts";
import { consolidate } from "../../packages/ai/consolidation/index.ts";
import { MockModelProvider } from "../../packages/ai/providers/mock/index.ts";
import { AwsConsolidationRepository } from "../../packages/aws-adapters/consolidations.ts";
import { AwsConsolidationJobs } from "../../packages/aws-adapters/jobs.ts";
import { AwsResultStore } from "../../packages/aws-adapters/result-store.ts";
import { parseAgentResultEvent } from "../../packages/contracts/src/index.ts";
import { artifactNamespace, digest } from "../../packages/core/results.ts";
import { report } from "../fixtures/model-request.ts";

it("captures scoped evidence, recovers failed inference, and commits immutable revisions concurrently", async () => {
  const aws = localAws(`reports-${randomUUID().slice(0, 12)}`);
  const resources = await bootstrap(aws);
  const results = new AwsResultStore(aws, resources.results, resources.bucket);
  const reports = new AwsConsolidationRepository(aws, resources.consolidations, resources.bucket);
  const scope = { projectId: "demo", topic: "sample", correlationId: "group" };
  const event = (input: Record<string, unknown> = {}) =>
    parseAgentResultEvent({
      schemaVersion: 1,
      eventId: randomUUID(),
      eventType: "agent.result",
      agentId: "research",
      agentVersion: "1",
      projectId: "demo",
      topic: "sample",
      correlationId: "group",
      resultId: "research",
      revision: 1,
      occurredAt: "2026-11-01T00:00:00Z",
      status: "completed",
      summary: "Original observation",
      contentType: "application/json",
      sources: [{ title: "Observation" }],
      metadata: {},
      data: { value: 2 },
      ...input,
    });
  const old = event();
  const partial = event({ revision: 2, status: "partial", summary: "Updated observation" });
  const bytes = '{"reason":"missing sample"}';
  const key = artifactNamespace("demo") + digest("application/json") + "/" + digest(bytes);
  await aws.s3.send(
    new PutObjectCommand({
      Bucket: resources.bucket,
      Key: key,
      Body: bytes,
      ContentType: "application/json",
    }),
  );
  const failed = event({
    agentId: "analysis",
    resultId: "analysis",
    status: "failed",
    artifactKey: key,
    data: undefined,
  });
  const excluded = event({ resultId: "unrelated", correlationId: "other" });
  for (const result of [old, partial, failed, excluded]) await results.save(result);

  const runId = randomUUID();
  const now = () => new Date("2026-11-07T00:00:00Z");
  const options = { expectedAgentIds: ["unknown"], staleAfterMs: 86_400_000 };
  const failing = new MockModelProvider({ failure: "timeout" });
  await expect(
    consolidate({ results, reports, provider: failing, now }, runId, scope, options),
  ).rejects.toMatchObject({ code: "timeout" });
  expect(await reports.getReport(runId, scope)).toBeUndefined();
  const capture = await reports.getCapture(runId, scope);
  expect(capture?.input.evidence.map((source) => source.eventId).sort()).toEqual(
    [partial.eventId, failed.eventId].sort(),
  );
  expect(
    capture?.input.evidence.find((source) => source.eventId === failed.eventId)?.artifactDigest,
  ).toBe(digest(bytes));

  const invalid = {
    name: "mock",
    async generate() {
      return { provider: "mock", simulated: true, model: "test", report } as const;
    },
  };
  await expect(
    consolidate({ results, reports, provider: invalid, now }, runId, scope, options),
  ).rejects.toMatchObject({ code: "invalid_output" });
  expect(await reports.getReport(runId, scope)).toBeUndefined();

  const next = event({ revision: 3, summary: "Late arrival" });
  await results.save(next);
  const provider = new MockModelProvider();
  const deps = { results, reports, provider, now };
  const recovered = await consolidate(deps, runId, scope, options);
  expect(recovered.revision).toBe(1);
  expect(recovered.inputFingerprint).toBe(capture?.inputFingerprint);
  expect(recovered.sourceEventIds).toEqual(capture?.input.evidence.map((source) => source.eventId));
  expect(recovered.issues.map((issue) => issue.kind).sort()).toEqual([
    "failed",
    "missing_publisher",
    "partial",
    "stale",
    "stale",
  ]);
  expect(
    provider.invocations[0].sources.find((source) => source.eventId === failed.eventId)?.content,
  ).toBe(bytes);
  expect(await consolidate(deps, runId, scope, options)).toEqual(recovered);
  expect(provider.invocations).toHaveLength(1);
  await expect(consolidate(deps, runId, { projectId: "other" })).rejects.toThrow(/different scope/);

  const secondRun = randomUUID();
  const thirdRun = randomUUID();
  const later = await Promise.all(
    [secondRun, thirdRun].map((id) => consolidate(deps, id, scope, options)),
  );
  expect(later.map((result) => result.revision).sort()).toEqual([2, 3]);
  expect(new Set(later.map((result) => result.inputFingerprint)).size).toBe(1);
  expect(later[0].inputFingerprint).not.toBe(recovered.inputFingerprint);
  expect(later[0].sourceEventIds).toContain(next.eventId);
  expect(await reports.getReport(runId, scope)).toEqual(recovered);
  const duplicateRun = randomUUID();
  const replay = await Promise.all([
    consolidate(deps, duplicateRun, scope),
    consolidate(deps, duplicateRun, scope),
  ]);
  expect(replay[0]).toEqual(replay[1]);
  expect(replay[0].revision).toBe(4);
  expect(
    (
      await aws.s3.send(
        new GetObjectCommand({
          Bucket: resources.bucket,
          Key: recovered.snapshotKey,
        }),
      )
    ).ContentType,
  ).toBe("application/json");
  let originalCount = 0;
  for await (const _ of results.projectResults("demo")) originalCount++;
  expect(originalCount).toBe(5);
}, 45_000);

it("keeps private results visible in storage and out of automatic and manual consolidation", async () => {
  const aws = localAws(`private-${randomUUID().slice(0, 12)}`);
  const resources = await bootstrap(aws);
  const scope = { projectId: "email", topic: "urgent-inbox" };
  const results = new AwsResultStore(aws, resources.results, resources.bucket, {
    table: resources.consolidations,
    debounceMs: 0,
  });
  const jobs = new AwsConsolidationJobs(aws.dynamo, resources.consolidations);
  const reports = new AwsConsolidationRepository(aws, resources.consolidations, resources.bucket);
  const event = parseAgentResultEvent({
    ...scope,
    schemaVersion: 1,
    eventId: randomUUID(),
    eventType: "agent.result",
    agentId: "gmail-urgency",
    agentVersion: "1",
    correlationId: "gmail",
    resultId: "private",
    revision: 1,
    occurredAt: new Date().toISOString(),
    status: "completed",
    summary: "Private digest",
    contentType: "application/json",
    data: { messages: [] },
    sources: [],
    metadata: { includeInConsolidation: false },
  });
  expect(await results.save(event)).toBe("stored");
  expect(await jobs.version("email")).toBe("1");
  await jobs.schedule(Date.now());
  for await (const job of jobs.due(Date.now()))
    throw new Error(`Unexpected automatic job ${job.id}`);
  const provider = new MockModelProvider();
  await expect(consolidate({ results, reports, provider }, randomUUID(), scope)).rejects.toThrow(
    /No persisted results/,
  );
  expect(provider.invocations).toHaveLength(0);
  for await (const result of results.projectResults("email"))
    expect(result).toMatchObject({ eventId: event.eventId });
});
