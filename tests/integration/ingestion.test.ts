import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { QueryCommand } from "@aws-sdk/client-dynamodb";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import {
  ChangeMessageVisibilityCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SetQueueAttributesCommand,
} from "@aws-sdk/client-sqs";
import { expect, it } from "vitest";
import { consumeOne } from "../../apps/result-consumer/consume.ts";
import { bootstrap, localAws } from "../../infrastructure/bootstrap/resources.ts";
import { AwsResultStore } from "../../packages/aws-adapters/result-store.ts";
import { digest } from "../../packages/core/results.ts";
import { parseAgentResultEvent } from "../../packages/contracts/src/index.ts";

const exec = promisify(execFile);

it("persists independent publishers, handles replay after a lost acknowledgement, and redrives malformed events", async () => {
  const prefix = `ingestion-${randomUUID().slice(0, 12)}`;
  const env = { ...process.env, LOCAL_RESOURCE_PREFIX: prefix };
  const aws = localAws(prefix);
  const resources = await bootstrap(aws);
  const store = new AwsResultStore(aws, resources.results, resources.bucket);
  await Promise.all([
    exec(process.execPath, ["agents/research-agent/run.ts"], { env }),
    exec(process.execPath, ["agents/analysis-agent/run.ts"], { env }),
  ]);
  const consume = () => consumeOne(aws.sqs, resources.ingestion, store, 2);
  expect(await consume()).toBe("stored");
  expect(await consume()).toBe("stored");

  const results = async () =>
    (
      await aws.dynamo.send(
        new QueryCommand({
          TableName: resources.results,
          KeyConditionExpression: "pk = :p AND begins_with(sk, :kind)",
          ExpressionAttributeValues: {
            ":p": { S: `project#${digest("demo")}` },
            ":kind": { S: "result#" },
          },
        }),
      )
    ).Items?.map((item) => parseAgentResultEvent(JSON.parse(item.event.S ?? ""))) ?? [];
  const initial = await results();
  expect(initial.map((event) => event.agentId).sort()).toEqual(["analysis", "research"]);
  expect(initial.find((event) => event.agentId === "analysis")?.data).toEqual({
    count: 4,
    min: 12,
    max: 30,
    mean: 21,
  });

  const QueueUrl = resources.ingestion;
  const event = { ...initial[0], eventId: randomUUID(), revision: 2, data: "x".repeat(40_000) };
  const send = (value: unknown) =>
    aws.sqs.send(new SendMessageCommand({ QueueUrl, MessageBody: JSON.stringify(value) }));
  await send(event);
  const { Messages } = await aws.sqs.send(
    new ReceiveMessageCommand({ QueueUrl, VisibilityTimeout: 1 }),
  );
  expect(Messages).toHaveLength(1);
  expect(await store.save(parseAgentResultEvent(JSON.parse(Messages![0].Body!)))).toBe("stored");
  expect(await consume()).toBe("duplicate");
  await expect(
    store.save(parseAgentResultEvent({ ...event, summary: "different" })),
  ).rejects.toThrow(/reused/);
  await expect(
    store.save(parseAgentResultEvent({ ...event, eventId: randomUUID() })),
  ).rejects.toMatchObject({
    name: "TransactionCanceledException",
  });
  const persisted = await results();
  expect(persisted).toHaveLength(3);
  const artifact = persisted.find((result) => result.eventId === event.eventId);
  expect(artifact?.artifactKey).toBeDefined();
  const object = await aws.s3.send(
    new GetObjectCommand({ Bucket: resources.bucket, Key: artifact?.artifactKey }),
  );
  expect(JSON.parse(await object.Body!.transformToString())).toBe(event.data);

  await aws.sqs.send(
    new SetQueueAttributesCommand({ QueueUrl, Attributes: { VisibilityTimeout: "1" } }),
  );
  await send({ schemaVersion: 99 });
  await expect(consume()).rejects.toThrow(/Unsupported/);
  // The failed consumer did not acknowledge. Reset visibility using a short queue timeout
  // on subsequent receives once the first delivery becomes visible.
  const firstRetry = await aws.sqs.send(
    new ReceiveMessageCommand({ QueueUrl, WaitTimeSeconds: 20, VisibilityTimeout: 0 }),
  );
  const retry =
    firstRetry.Messages?.[0] ??
    (
      await aws.sqs.send(
        new ReceiveMessageCommand({
          QueueUrl,
          WaitTimeSeconds: 15,
          VisibilityTimeout: 0,
        }),
      )
    ).Messages?.[0];
  expect(retry?.Body).toBe('{"schemaVersion":99}');
  const third = await aws.sqs.send(
    new ReceiveMessageCommand({ QueueUrl, VisibilityTimeout: 5, WaitTimeSeconds: 2 }),
  );
  await aws.sqs.send(
    new ChangeMessageVisibilityCommand({
      QueueUrl,
      ReceiptHandle: third.Messages?.[0].ReceiptHandle,
      VisibilityTimeout: 0,
    }),
  );
  expect(
    (await aws.sqs.send(new ReceiveMessageCommand({ QueueUrl, WaitTimeSeconds: 1 }))).Messages,
  ).toBeUndefined();
  const dead = await aws.sqs.send(
    new ReceiveMessageCommand({ QueueUrl: resources.dlq, WaitTimeSeconds: 2 }),
  );
  expect(dead.Messages?.[0].Body).toBe('{"schemaVersion":99}');
}, 60_000);
