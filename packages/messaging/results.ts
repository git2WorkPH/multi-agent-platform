import { randomUUID } from "node:crypto";
import { GetQueueUrlCommand, SendMessageCommand } from "@aws-sdk/client-sqs";
import { parseAgentResultEvent } from "../contracts/src/index.ts";
import type { AgentResultEvent } from "../contracts/src/index.ts";
import type { ResultPublisher } from "../core/results.ts";
import { localAws } from "../../infrastructure/bootstrap/resources.ts";

export async function ingestionQueue(aws: ReturnType<typeof localAws>) {
  const { QueueUrl } = await aws.sqs.send(
    new GetQueueUrlCommand({ QueueName: `${aws.prefix}-ingestion` }),
  );
  if (!QueueUrl) throw new Error("Ingestion queue missing. Run pnpm bootstrap first.");
  return QueueUrl;
}

export async function publishResult(
  agentId: string,
  summary: string,
  data: NonNullable<AgentResultEvent["data"]>,
  sources: AgentResultEvent["sources"],
) {
  const aws = localAws();
  const QueueUrl = await ingestionQueue(aws);
  const publisher: ResultPublisher = {
    async publish(event) {
      const MessageBody = JSON.stringify(parseAgentResultEvent(event));
      if (Buffer.byteLength(MessageBody) > 240 * 1024)
        throw new Error("Event exceeds the inline publishing budget");
      await aws.sqs.send(new SendMessageCommand({ QueueUrl, MessageBody }));
    },
  };
  const eventId = process.env.AGENT_EVENT_ID ?? randomUUID();
  await publisher.publish(
    parseAgentResultEvent({
      schemaVersion: 1,
      eventId,
      eventType: "agent.result",
      agentId,
      agentVersion: "1.0.0",
      projectId: process.env.AGENT_PROJECT_ID ?? "demo",
      correlationId: process.env.AGENT_CORRELATION_ID ?? "demo-run",
      topic: process.env.AGENT_TOPIC ?? "sample",
      resultId: process.env.AGENT_RESULT_ID ?? eventId,
      revision: Number(process.env.AGENT_REVISION ?? "1"),
      occurredAt: process.env.AGENT_OCCURRED_AT ?? new Date().toISOString(),
      status: "completed",
      summary,
      contentType: "application/json",
      data,
      sources,
      metadata: {},
    }),
  );
  console.log(JSON.stringify({ agentId, eventId }));
}
