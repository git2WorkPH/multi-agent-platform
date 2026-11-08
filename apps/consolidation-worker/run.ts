import "../../packages/core/load-env.ts";
import { setTimeout as delay } from "node:timers/promises";
import pino from "pino";
import { localAws } from "../../infrastructure/bootstrap/resources.ts";
import { createModelProvider } from "../../packages/ai/index.ts";
import { AwsConsolidationJobs } from "../../packages/aws-adapters/jobs.ts";
import { AwsConsolidationRepository } from "../../packages/aws-adapters/consolidations.ts";
import { AwsResultStore } from "../../packages/aws-adapters/result-store.ts";
import { consolidationWake } from "../../packages/messaging/consolidation.ts";
import { workOnce } from "./work.ts";

const aws = localAws();
const table = `${aws.prefix}-consolidations`;
const bucket = `${aws.prefix}-artifacts`;
const logger = pino({ name: "consolidation-worker" });
const jobs = new AwsConsolidationJobs(aws.dynamo, table);
const provider = createModelProvider();
const wake = consolidationWake(aws.sqs, aws.prefix);
const results = new AwsResultStore(aws, `${aws.prefix}-results`, bucket);
const leaseMs = Number(process.env.CONSOLIDATION_LEASE_MS ?? 600_000);
if (!Number.isSafeInteger(leaseMs) || leaseMs < 1000)
  throw new Error("Invalid CONSOLIDATION_LEASE_MS");
const staleAfterMs =
  process.env.CONSOLIDATION_STALE_MS === undefined
    ? undefined
    : Number(process.env.CONSOLIDATION_STALE_MS);
if (staleAfterMs !== undefined && (!Number.isSafeInteger(staleAfterMs) || staleAfterMs < 0)) {
  throw new Error("Invalid CONSOLIDATION_STALE_MS");
}
let running = true;
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    running = false;
  });
while (running) {
  try {
    const worked = await workOnce({
      jobs,
      results,
      provider,
      leaseMs,
      reports: (lease) =>
        new AwsConsolidationRepository(aws, table, bucket, () => jobs.fence(lease, Date.now())),
      options: {
        staleAfterMs,
        expectedAgentIds: process.env.CONSOLIDATION_EXPECTED_AGENTS?.split(",")
          .map((value) => value.trim())
          .filter(Boolean),
      },
      onError: (job, error) =>
        logger.warn(
          {
            jobId: job.id,
            attempt: job.attempts,
            errorType: error instanceof Error ? error.name : "unknown",
          },
          "Consolidation attempt failed",
        ),
    });
    if (!worked && running) await wake.wait();
  } catch (error) {
    logger.warn(
      { errorType: error instanceof Error ? error.name : "unknown" },
      "Worker poll failed",
    );
    if (running) await delay(1000);
  }
}
