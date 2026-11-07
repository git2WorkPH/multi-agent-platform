import { DeleteMessageCommand, GetQueueUrlCommand, ReceiveMessageCommand, SendMessageCommand } from "@aws-sdk/client-sqs";
import type { SQSClient } from "@aws-sdk/client-sqs";

export function consolidationWake(sqs: SQSClient, prefix: string) {
  let queue: string | undefined;
  const url = async () => {
    queue ??= (await sqs.send(new GetQueueUrlCommand({ QueueName: `${prefix}-consolidation` }))).QueueUrl;
    if (!queue) throw new Error("Missing consolidation queue");
    return queue;
  };
  return {
    async send() {
      await sqs.send(new SendMessageCommand({ QueueUrl: await url(), MessageBody: '{"type":"consolidation.wake"}' }));
    },
    async wait() {
      const QueueUrl = await url();
      const { Messages } = await sqs.send(new ReceiveMessageCommand({ QueueUrl, WaitTimeSeconds: 2 }));
      for (const message of Messages ?? []) {
        if (message.ReceiptHandle) await sqs.send(new DeleteMessageCommand({ QueueUrl, ReceiptHandle: message.ReceiptHandle }));
      }
    },
  };
}
