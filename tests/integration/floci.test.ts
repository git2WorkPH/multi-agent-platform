import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  GetItemCommand, PutItemCommand, QueryCommand, TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import {
  ChangeMessageVisibilityCommand, DeleteMessageCommand, ReceiveMessageCommand, SendMessageCommand,
} from "@aws-sdk/client-sqs";
import { beforeAll, describe, expect, it } from "vitest";
import { bootstrap, localAws } from "../../infrastructure/bootstrap/resources.ts";

if (!process.env.LOCAL_RESOURCE_PREFIX || process.env.LOCAL_RESOURCE_PREFIX === "multi-agent") {
  throw new Error("Set LOCAL_RESOURCE_PREFIX to a fresh, isolated probe prefix");
}
const aws = localAws();
let resources: Awaited<ReturnType<typeof bootstrap>>;
const key = (pk: string, sk: string) => ({ pk: { S: pk }, sk: { S: sk } });
const run = randomUUID();

beforeAll(async () => {
  resources = await bootstrap(aws);
}, 60_000);

describe("pinned Floci AWS SDK compatibility", () => {
  it("reconciles the same resources on repeated bootstrap", async () => {
    expect(await bootstrap(aws)).toEqual(resources);
  }, 60_000);

  it("round-trips a checksummed artifact using the normal SDK defaults", async () => {
    const Key = `probe/${run}`;
    await aws.s3.send(new PutObjectCommand({ Bucket: resources.bucket, Key, Body: run }));
    const object = await aws.s3.send(new GetObjectCommand({ Bucket: resources.bucket, Key }));
    expect(await object.Body?.transformToString()).toBe(run);
  });

  it("honors conditional races, rollback, consistent reads, and index cursors", async () => {
    const TableName = resources.results;
    const item = (revision: string) => ({
      ...key(run, revision), indexPk: { S: run }, indexSk: { S: revision },
    });
    const insert = () => aws.dynamo.send(new PutItemCommand({
      TableName, Item: item("1"), ConditionExpression: "attribute_not_exists(pk)",
    }));
    const race = await Promise.allSettled([insert(), insert()]);
    expect(race.map(result => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(race.find(result => result.status === "rejected")).toMatchObject({
      reason: { name: "ConditionalCheckFailedException" },
    });

    await expect(aws.dynamo.send(new TransactWriteItemsCommand({
      TransactItems: [
        { Put: { TableName: resources.consolidations, Item: key(run, "rollback") } },
        { Put: { TableName, Item: item("1"), ConditionExpression: "attribute_not_exists(pk)" } },
      ],
    }))).rejects.toMatchObject({ name: "TransactionCanceledException" });
    expect((await aws.dynamo.send(new GetItemCommand({
      TableName: resources.consolidations, Key: key(run, "rollback"), ConsistentRead: true,
    }))).Item).toBeUndefined();

    await aws.dynamo.send(new TransactWriteItemsCommand({
      TransactItems: [
        { Put: { TableName, Item: item("2") } },
        { Put: { TableName: resources.consolidations, Item: key(run, "committed") } },
      ],
    }));
    expect((await aws.dynamo.send(new GetItemCommand({
      TableName: resources.consolidations, Key: key(run, "committed"), ConsistentRead: true,
    }))).Item).toEqual(key(run, "committed"));

    const query = {
      TableName, IndexName: "lookup", Limit: 1,
      KeyConditionExpression: "indexPk = :pk",
      ExpressionAttributeValues: { ":pk": { S: run } },
    };
    await expect.poll(async () => {
      const first = await aws.dynamo.send(new QueryCommand(query));
      if (!first.LastEvaluatedKey) return [];
      const second = await aws.dynamo.send(new QueryCommand({
        ...query, ExclusiveStartKey: first.LastEvaluatedKey,
      }));
      return [...first.Items ?? [], ...second.Items ?? []].map(row => row.sk.S);
    }, { timeout: 4_000 }).toEqual(["1", "2"]);
  });

  it("long-polls, expires visibility, redrives a poison message, and acknowledges a wake-up", async () => {
    const receive = async (QueueUrl: string, VisibilityTimeout = 10) => (await aws.sqs.send(
      new ReceiveMessageCommand({
        QueueUrl, VisibilityTimeout, WaitTimeSeconds: 2,
        MessageSystemAttributeNames: ["ApproximateReceiveCount"],
      }),
    )).Messages?.[0];
    const firstReceive = receive(resources.ingestion, 1);
    await delay(150);
    await aws.sqs.send(new SendMessageCommand({ QueueUrl: resources.ingestion, MessageBody: run }));
    const first = await firstReceive;
    expect(first?.Body).toBe(run);
    expect(first?.Attributes?.ApproximateReceiveCount).toBe("1");
    for (const attempt of [2, 3]) {
      const message = await receive(resources.ingestion);
      expect(message?.Body).toBe(run);
      expect(message?.Attributes?.ApproximateReceiveCount).toBe(String(attempt));
      await aws.sqs.send(new ChangeMessageVisibilityCommand({
        QueueUrl: resources.ingestion, ReceiptHandle: message?.ReceiptHandle, VisibilityTimeout: 0,
      }));
    }
    expect(await receive(resources.ingestion)).toBeUndefined();
    const dead = await receive(resources.dlq);
    expect(dead?.Body).toBe(run);
    await aws.sqs.send(new DeleteMessageCommand({
      QueueUrl: resources.dlq, ReceiptHandle: dead?.ReceiptHandle,
    }));

    await aws.sqs.send(new SendMessageCommand({ QueueUrl: resources.consolidation, MessageBody: run }));
    const wake = await receive(resources.consolidation);
    expect(wake?.Body).toBe(run);
    await aws.sqs.send(new DeleteMessageCommand({
      QueueUrl: resources.consolidation, ReceiptHandle: wake?.ReceiptHandle,
    }));
  }, 20_000);
});
