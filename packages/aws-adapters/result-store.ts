import { GetItemCommand, QueryCommand, TransactWriteItemsCommand } from "@aws-sdk/client-dynamodb";
import type { AttributeValue } from "@aws-sdk/client-dynamodb";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import type { AgentResultEvent } from "../contracts/src/index.ts";
import {
  artifactLimit,
  artifactNamespace,
  canonicalJson,
  digest,
  inlineLimit,
} from "../core/results.ts";
import type { ConsolidationResultReader } from "../core/consolidation.ts";
import type { ResultStore } from "../core/results.ts";
import type { localAws } from "../../infrastructure/bootstrap/resources.ts";
import { markDirty, signalChange } from "./jobs.ts";

export class AwsResultStore implements ResultStore, ConsolidationResultReader {
  constructor(
    privateConfig: Pick<ReturnType<typeof localAws>, "dynamo" | "s3">,
    table: string,
    bucket: string,
    scheduling?: { table: string; debounceMs: number; now?: () => number },
  ) {
    this.aws = privateConfig;
    this.table = table;
    this.bucket = bucket;
    this.scheduling = scheduling;
  }

  private readonly aws;
  private readonly table;
  private readonly bucket;
  private readonly scheduling;

  async *projectResults(projectId: string): AsyncGenerator<unknown> {
    let cursor: Record<string, AttributeValue> | undefined;
    do {
      const page = await this.aws.dynamo.send(
        new QueryCommand({
          TableName: this.table,
          ConsistentRead: true,
          ExclusiveStartKey: cursor,
          Limit: 100,
          KeyConditionExpression: "pk = :project AND begins_with(sk, :prefix)",
          ExpressionAttributeValues: {
            ":project": { S: `project#${digest(projectId)}` },
            ":prefix": { S: "result#" },
          },
        }),
      );
      for (const item of page.Items ?? []) yield JSON.parse(item.event.S ?? "null");
      cursor = page.LastEvaluatedKey;
    } while (cursor && Object.keys(cursor).length);
  }

  async readArtifact(event: AgentResultEvent & { artifactKey: string }): Promise<Uint8Array> {
    const namespace = artifactNamespace(event.projectId) + digest(event.contentType) + "/";
    const expected = event.artifactKey.slice(namespace.length);
    if (!event.artifactKey.startsWith(namespace) || !/^[a-f0-9]{64}$/.test(expected)) {
      throw new Error("Invalid managed artifact key");
    }
    const object = await this.aws.s3.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: event.artifactKey }),
    );
    const body = object.Body?.transformToWebStream();
    if (!body) throw new Error("Missing artifact body");
    if (
      object.ContentType !== event.contentType ||
      (object.ContentLength ?? Infinity) > artifactLimit
    ) {
      await body.cancel();
      throw new Error("Artifact content type or size is invalid");
    }
    const bytes = await new Response(body).arrayBuffer();
    if (bytes.byteLength > artifactLimit || digest(new Uint8Array(bytes)) !== expected) {
      throw new Error("Artifact size or digest mismatch");
    }
    return new Uint8Array(bytes);
  }

  async save(event: AgentResultEvent): Promise<"stored" | "duplicate"> {
    const fingerprint = digest(canonicalJson(event));
    const receipt = { pk: { S: `event#${event.eventId}` }, sk: { S: "receipt" } };
    const readReceipt = async () =>
      (
        await this.aws.dynamo.send(
          new GetItemCommand({
            TableName: this.table,
            Key: receipt,
            ConsistentRead: true,
          }),
        )
      ).Item;
    const existing = await readReceipt();
    if (existing) {
      if (existing.fingerprint.S === fingerprint) return "duplicate";
      throw new Error("Event ID reused with different content");
    }

    const namespace = artifactNamespace(event.projectId) + digest(event.contentType) + "/";
    let stored = event;
    if (event.artifactKey !== undefined) {
      await this.readArtifact({ ...event, artifactKey: event.artifactKey });
    } else {
      const body = canonicalJson(event.data);
      const length = Buffer.byteLength(body);
      if (length > artifactLimit) throw new Error("Result payload exceeds artifact limit");
      if (length > inlineLimit) {
        const artifactKey = namespace + digest(body);
        await this.aws.s3.send(
          new PutObjectCommand({
            Bucket: this.bucket,
            Key: artifactKey,
            Body: body,
            ContentType: event.contentType,
          }),
        );
        const { data: _data, ...envelope } = event;
        stored = { ...envelope, artifactKey };
      }
    }
    const projectKey = `project#${digest(event.projectId)}`;
    const revisionKey = digest(canonicalJson([event.agentId, event.resultId, event.revision]));
    const timestamp = new Date(event.occurredAt).toISOString();
    const resultKey = `result#${timestamp}#${event.eventId}`;
    try {
      await this.aws.dynamo.send(
        new TransactWriteItemsCommand({
          TransactItems: [
            {
              Put: {
                TableName: this.table,
                Item: {
                  ...receipt,
                  fingerprint: { S: fingerprint },
                  resultPk: { S: projectKey },
                  resultSk: { S: resultKey },
                },
                ConditionExpression: "attribute_not_exists(pk)",
              },
            },
            {
              Put: {
                TableName: this.table,
                Item: {
                  pk: { S: projectKey },
                  sk: { S: resultKey },
                  indexPk: { S: `${projectKey}#topic#${digest(event.topic)}` },
                  indexSk: { S: `${timestamp}#${event.eventId}` },
                  event: { S: canonicalJson(stored) },
                },
                ConditionExpression: "attribute_not_exists(pk)",
              },
            },
            {
              Put: {
                TableName: this.table,
                Item: {
                  pk: { S: projectKey },
                  sk: { S: `revision#${revisionKey}` },
                  eventId: { S: event.eventId },
                },
                ConditionExpression: "attribute_not_exists(pk)",
              },
            },
            ...(this.scheduling
              ? [
                  markDirty(
                    this.scheduling.table,
                    {
                      projectId: event.projectId,
                      topic: event.topic,
                    },
                    (this.scheduling.now ?? Date.now)() + this.scheduling.debounceMs,
                  ),
                  signalChange(this.scheduling.table, event.projectId),
                ]
              : []),
          ],
        }),
      );
    } catch (error) {
      const committed = await readReceipt();
      if (committed?.fingerprint.S === fingerprint) return "duplicate";
      throw error;
    }
    return "stored";
  }
}
