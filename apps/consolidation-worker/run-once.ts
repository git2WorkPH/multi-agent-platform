import "../../packages/core/load-env.ts";
import { randomUUID } from "node:crypto";
import { localAws } from "../../infrastructure/bootstrap/resources.ts";
import { createModelProvider } from "../../packages/ai/index.ts";
import { consolidate } from "../../packages/ai/consolidation/index.ts";
import { AwsConsolidationRepository } from "../../packages/aws-adapters/consolidations.ts";
import { AwsResultStore } from "../../packages/aws-adapters/result-store.ts";

const [projectId, topic, correlationId] = process.argv.slice(2);
if (!projectId) throw new Error("Usage: pnpm consolidate <projectId> [topic] [correlationId]");
const aws = localAws();
const bucket = `${aws.prefix}-artifacts`;
const provider = createModelProvider();
const result = await consolidate(
  {
    results: new AwsResultStore(aws, `${aws.prefix}-results`, bucket),
    reports: new AwsConsolidationRepository(aws, `${aws.prefix}-consolidations`, bucket),
    provider,
  },
  process.env.CONSOLIDATION_RUN_ID ?? randomUUID(),
  {
    projectId,
    topic: topic || undefined,
    correlationId: correlationId || undefined,
  },
  {
    expectedAgentIds: process.env.CONSOLIDATION_EXPECTED_AGENTS?.split(",")
      .map((agent) => agent.trim())
      .filter(Boolean),
    staleAfterMs:
      process.env.CONSOLIDATION_STALE_MS === undefined
        ? undefined
        : Number(process.env.CONSOLIDATION_STALE_MS),
  },
);
console.log(JSON.stringify(result, null, 2));
