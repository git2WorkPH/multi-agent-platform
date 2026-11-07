import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { workOnce } from "../../apps/consolidation-worker/work.ts";
import { consumeOne } from "../../apps/result-consumer/consume.ts";
import { bootstrap, localAws } from "../../infrastructure/bootstrap/resources.ts";
import { createModelProvider } from "../../packages/ai/index.ts";
import { AwsConsolidationRepository } from "../../packages/aws-adapters/consolidations.ts";
import { AwsConsolidationJobs } from "../../packages/aws-adapters/jobs.ts";
import { AwsResultStore } from "../../packages/aws-adapters/result-store.ts";

const exec = promisify(execFile);

it("consolidates both independent agents through real Floci and Ollama, then persists a forced revision", async () => {
  const prefix = `ollama-stack-${randomUUID().slice(0, 12)}`;
  const aws = localAws(prefix);
  const { ingestion, results: resultsTable, consolidations, bucket } = await bootstrap(aws);
  const scope = { projectId: "demo", topic: "sample" };
  const env = {
    ...process.env,
    LOCAL_RESOURCE_PREFIX: prefix,
    AGENT_PROJECT_ID: scope.projectId,
    AGENT_TOPIC: scope.topic,
    AGENT_CORRELATION_ID: "live-check",
    AGENT_EVENT_ID: undefined,
    AGENT_RESULT_ID: undefined,
    AGENT_REVISION: undefined,
    AGENT_OCCURRED_AT: undefined,
  };
  await Promise.all(
    ["research", "analysis"].map((agent) =>
      exec(process.execPath, [`agents/${agent}-agent/run.ts`], { env }),
    ),
  );
  const results = new AwsResultStore(aws, resultsTable, bucket, {
    table: consolidations,
    debounceMs: 0,
  });
  expect(await consumeOne(aws.sqs, ingestion, results, 2)).toBe("stored");
  expect(await consumeOne(aws.sqs, ingestion, results, 2)).toBe("stored");
  const persisted = [];
  for await (const event of results.projectResults(scope.projectId)) persisted.push(event);
  expect(persisted).toHaveLength(2);
  const jobs = new AwsConsolidationJobs(aws.dynamo, consolidations);
  const reports = new AwsConsolidationRepository(aws, consolidations, bucket);
  const provider = createModelProvider({ ...process.env, AI_PROVIDER: "ollama" });
  const deps = {
    jobs,
    results,
    provider,
    leaseMs: 600_000,
    maxAttempts: 1,
    reports: (lease: Parameters<typeof jobs.fence>[0]) =>
      new AwsConsolidationRepository(aws, consolidations, bucket, () =>
        jobs.fence(lease, Date.now()),
      ),
    onError: (_job: unknown, error: unknown) => console.error(error),
  };
  await jobs.schedule(Date.now());
  const automatic = [];
  for await (const candidate of jobs.due(Date.now())) automatic.push(candidate);
  expect(automatic).toHaveLength(1);
  expect(await workOnce(deps)).toBe(true);
  const first = await reports.getReport(automatic[0].id, scope);
  expect(await jobs.get(automatic[0].id)).toMatchObject({
    status: "completed",
    trigger: "automatic",
  });
  expect(first).toMatchObject({
    revision: 1,
    generation: { provider: "ollama", simulated: false },
  });
  expect(first?.sourceEventIds).toHaveLength(2);
  const citations =
    first?.generation.report.findings.flatMap((finding) => finding.sourceEventIds) ?? [];
  expect(citations.length).toBeGreaterThan(0);
  expect(citations.every((id) => first?.sourceEventIds.includes(id))).toBe(true);

  const manual = await jobs.enqueue(scope, true, "real-stack-force", Date.now());
  expect(await workOnce(deps)).toBe(true);
  const second = await reports.getReport(manual.id, scope);
  expect(second).toMatchObject({ revision: 2, inputFingerprint: first?.inputFingerprint });
  expect(await reports.getReport(automatic[0].id, scope)).toEqual(first);
}, 600_000);
