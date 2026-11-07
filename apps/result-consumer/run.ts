import { setTimeout as delay } from "node:timers/promises";
import { localAws } from "../../infrastructure/bootstrap/resources.ts";
import { AwsResultStore } from "../../packages/aws-adapters/result-store.ts";
import { ingestionQueue } from "../../packages/messaging/results.ts";
import { consumeOne } from "./consume.ts";

const aws = localAws();
const queue = await ingestionQueue(aws);
const store = new AwsResultStore(aws, `${aws.prefix}-results`, `${aws.prefix}-artifacts`);
let running = true;
process.once("SIGINT", () => { running = false; });
process.once("SIGTERM", () => { running = false; });
let backoff = 250;
while (running) {
  try {
    const outcome = await consumeOne(aws.sqs, queue, store);
    if (outcome !== "empty") console.log(JSON.stringify({ outcome }));
    backoff = 250;
  } catch (error) {
    console.error(JSON.stringify({ outcome: "retry", errorType: error instanceof Error ? error.name : "unknown" }));
    if (running) await delay(backoff);
    backoff = Math.min(backoff * 2, 5000);
  }
}
