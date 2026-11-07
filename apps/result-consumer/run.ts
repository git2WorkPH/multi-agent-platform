import { setTimeout as delay } from "node:timers/promises";
import pino from "pino";
import { consolidationWake } from "../../packages/messaging/consolidation.ts";
import { localAws } from "../../infrastructure/bootstrap/resources.ts";
import { AwsResultStore } from "../../packages/aws-adapters/result-store.ts";
import { ingestionQueue } from "../../packages/messaging/results.ts";
import { consumeOne } from "./consume.ts";

const aws = localAws();
const queue = await ingestionQueue(aws);
const debounceMs = Number(process.env.CONSOLIDATION_DEBOUNCE_MS ?? 3000);
if (!Number.isSafeInteger(debounceMs) || debounceMs < 0) throw new Error("Invalid CONSOLIDATION_DEBOUNCE_MS");
const logger = pino({ name: "result-consumer" });
const wake = consolidationWake(aws.sqs, aws.prefix);
const store = new AwsResultStore(aws, `${aws.prefix}-results`, `${aws.prefix}-artifacts`, {
  table: `${aws.prefix}-consolidations`, debounceMs,
});
let running = true;
process.once("SIGINT", () => { running = false; });
process.once("SIGTERM", () => { running = false; });
let backoff = 250;
while (running) {
  try {
    const outcome = await consumeOne(aws.sqs, queue, store);
    if (outcome !== "empty") logger.info({ outcome }, "Ingestion delivery handled");
    if (outcome === "stored") await wake.send().catch(() => logger.warn("Consolidation wake-up unavailable"));
    backoff = 250;
  } catch (error) {
    logger.warn({ outcome: "retry", errorType: error instanceof Error ? error.name : "unknown" }, "Ingestion delivery failed");
    if (running) await delay(backoff);
    backoff = Math.min(backoff * 2, 5000);
  }
}
