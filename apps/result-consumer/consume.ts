import { DeleteMessageCommand, ReceiveMessageCommand } from "@aws-sdk/client-sqs";
import type { SQSClient } from "@aws-sdk/client-sqs";
import { parseAgentResultEvent } from "../../packages/contracts/src/index.ts";
import type { ResultStore } from "../../packages/core/results.ts";

export async function consumeOne(sqs: SQSClient, QueueUrl: string, store: ResultStore, wait = 20) {
  const { Messages } = await sqs.send(new ReceiveMessageCommand({
    QueueUrl, WaitTimeSeconds: wait, MaxNumberOfMessages: 1,
  }));
  const message = Messages?.[0];
  if (!message) return "empty";
  if (!message.ReceiptHandle) throw new Error("SQS message has no receipt handle");
  if (Buffer.byteLength(message.Body ?? "") > 240 * 1024) throw new Error("Event exceeds ingestion budget");
  const event = parseAgentResultEvent(JSON.parse(message.Body ?? ""));
  const outcome = await store.save(event);
  await sqs.send(new DeleteMessageCommand({ QueueUrl, ReceiptHandle: message.ReceiptHandle }));
  return outcome;
}
