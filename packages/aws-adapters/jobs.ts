import { randomUUID } from "node:crypto";
import { GetItemCommand, ScanCommand, TransactWriteItemsCommand } from "@aws-sdk/client-dynamodb";
import type { AttributeValue, DynamoDBClient, TransactWriteItem } from "@aws-sdk/client-dynamodb";
import { consolidationScope } from "../contracts/src/consolidation.ts";
import type { ConsolidationScope } from "../contracts/src/consolidation.ts";
import { consolidationJob } from "../contracts/src/jobs.ts";
import type { ConsolidationJob } from "../contracts/src/jobs.ts";
import { canonicalJson, digest } from "../core/results.ts";

type Item = Record<string, AttributeValue>;
const key = (pk: string) => ({ pk: { S: pk }, sk: { S: "state" } });
const jobKey = (id: string) => key(`job#${id}`);
const leaseKey = (projectId: string) => key(`lease#${digest(projectId)}`);
const signalKey = (projectId: string) => key(`signal#${digest(projectId)}`);
const projectJobs = (projectId: string) => `jobs#${digest(projectId)}`;
const number = (value: number) => ({ N: String(value) });
const failedCondition = (error: unknown) =>
  error instanceof Error &&
  ["TransactionCanceledException", "ConditionalCheckFailedException"].includes(error.name);

export type Lease = { job: ConsolidationJob; token: string };

export function signalChange(table: string, projectId: string): TransactWriteItem {
  return {
    Update: {
      TableName: table,
      Key: signalKey(projectId),
      UpdateExpression: "ADD changeVersion :one",
      ExpressionAttributeValues: { ":one": number(1) },
    },
  };
}

export function markDirty(
  table: string,
  scope: ConsolidationScope,
  dueAt: number,
): TransactWriteItem {
  return {
    Update: {
      TableName: table,
      Key: key(`dirty#${digest(canonicalJson(scope))}`),
      UpdateExpression:
        "SET #scope = :scope, dueAt = :due, #kind = :kind, dirty = :true ADD generation :one",
      ExpressionAttributeNames: { "#scope": "scope", "#kind": "kind" },
      ExpressionAttributeValues: {
        ":scope": { S: canonicalJson(scope) },
        ":due": number(dueAt),
        ":kind": { S: "dirty" },
        ":true": { BOOL: true },
        ":one": number(1),
      },
    },
  };
}

function jobItem(job: ConsolidationJob, identity?: string): Item {
  return {
    ...jobKey(job.id),
    kind: { S: "job" },
    job: { S: canonicalJson(job) },
    indexPk: { S: projectJobs(job.scope.projectId) },
    indexSk: { S: `${job.updatedAt}#${job.id}` },
    ...(identity ? { identity: { S: identity } } : {}),
  };
}

function decodeJob(item: Item) {
  return consolidationJob.parse(JSON.parse(item.job.S ?? "null"));
}

export class JobConflict extends Error {}

export class AwsConsolidationJobs {
  readonly #client: DynamoDBClient;
  readonly #table: string;

  constructor(client: DynamoDBClient, table: string) {
    this.#client = client;
    this.#table = table;
  }

  async #get(Key: Item) {
    return (
      await this.#client.send(
        new GetItemCommand({
          TableName: this.#table,
          Key,
          ConsistentRead: true,
        }),
      )
    ).Item;
  }

  async get(id: string) {
    const item = await this.#get(jobKey(id));
    return item && decodeJob(item);
  }

  async version(projectId: string) {
    return (await this.#get(signalKey(projectId)))?.changeVersion?.N ?? "0";
  }

  #newJob(
    scope: ConsolidationScope,
    now: number,
    trigger: ConsolidationJob["trigger"],
    force: boolean,
  ) {
    return consolidationJob.parse({
      id: randomUUID(),
      scope,
      trigger,
      force,
      status: "queued",
      attempts: 0,
      updatedAt: now,
      dueAt: now,
    });
  }

  async enqueue(
    scope: ConsolidationScope,
    force: boolean,
    idempotencyKey: string | undefined,
    now: number,
  ) {
    const job = this.#newJob(scope, now, "manual", force);
    if (idempotencyKey !== undefined) {
      const hash = digest(canonicalJson([scope.projectId, idempotencyKey]));
      const hex = hash.slice(0, 32);
      job.id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`;
    }
    const identity = digest(canonicalJson([scope, force]));
    try {
      await this.#client.send(
        new TransactWriteItemsCommand({
          TransactItems: [
            {
              Put: {
                TableName: this.#table,
                Item: jobItem(job, identity),
                ConditionExpression: "attribute_not_exists(pk)",
              },
            },
            signalChange(this.#table, scope.projectId),
          ],
        }),
      );
      return job;
    } catch (error) {
      const item = await this.#get(jobKey(job.id));
      if (!item) throw error;
      if (item.identity?.S !== identity)
        throw new JobConflict("Idempotency key was already used for a different request");
      return decodeJob(item);
    }
  }

  async *#scan(kind: string): AsyncGenerator<Item> {
    let cursor: Item | undefined;
    do {
      const page = await this.#client.send(
        new ScanCommand({
          TableName: this.#table,
          ExclusiveStartKey: cursor,
          Limit: 100,
          FilterExpression: "#kind = :kind",
          ExpressionAttributeNames: { "#kind": "kind" },
          ExpressionAttributeValues: { ":kind": { S: kind } },
        }),
      );
      yield* page.Items ?? [];
      cursor = page.LastEvaluatedKey;
    } while (cursor && Object.keys(cursor).length);
  }

  async schedule(now: number) {
    for await (const item of this.#scan("dirty")) {
      if (!item.dirty.BOOL || Number(item.dueAt.N) > now) continue;
      const scope = consolidationScope.parse(JSON.parse(item.scope.S ?? "null"));
      const job = this.#newJob(scope, now, "automatic", false);
      try {
        await this.#client.send(
          new TransactWriteItemsCommand({
            TransactItems: [
              {
                Update: {
                  TableName: this.#table,
                  Key: { pk: item.pk, sk: item.sk },
                  UpdateExpression: "SET dirty = :false",
                  ConditionExpression:
                    "dirty = :true AND generation = :generation AND dueAt <= :now",
                  ExpressionAttributeValues: {
                    ":false": { BOOL: false },
                    ":true": { BOOL: true },
                    ":generation": item.generation,
                    ":now": number(now),
                  },
                },
              },
              {
                Put: {
                  TableName: this.#table,
                  Item: jobItem(job),
                  ConditionExpression: "attribute_not_exists(pk)",
                },
              },
              signalChange(this.#table, scope.projectId),
            ],
          }),
        );
      } catch (error) {
        if (!failedCondition(error)) throw error;
      }
    }
  }

  async *due(now: number) {
    for await (const item of this.#scan("job")) {
      const job = decodeJob(item);
      if (!["failed", "completed"].includes(job.status) && job.dueAt <= now) yield job;
    }
  }

  async claim(
    candidate: ConsolidationJob,
    now: number,
    leaseMs: number,
  ): Promise<Lease | undefined> {
    if (candidate.dueAt > now || ["completed", "failed"].includes(candidate.status)) return;
    const token = randomUUID();
    const expires = now + leaseMs;
    const job: ConsolidationJob = {
      ...candidate,
      status: "running",
      attempts: candidate.attempts + 1,
      updatedAt: now,
      dueAt: expires,
    };
    try {
      await this.#client.send(
        new TransactWriteItemsCommand({
          TransactItems: [
            {
              Put: {
                TableName: this.#table,
                Item: {
                  ...leaseKey(job.scope.projectId),
                  token: { S: token },
                  expires: number(expires),
                },
                ConditionExpression: "attribute_not_exists(pk) OR expires <= :now",
                ExpressionAttributeValues: { ":now": number(now) },
              },
            },
            {
              Update: {
                TableName: this.#table,
                Key: jobKey(job.id),
                UpdateExpression: "SET job = :next, indexSk = :index, #token = :token",
                ConditionExpression: "job = :previous",
                ExpressionAttributeNames: { "#token": "token" },
                ExpressionAttributeValues: {
                  ":previous": { S: canonicalJson(candidate) },
                  ":next": { S: canonicalJson(job) },
                  ":index": jobItem(job).indexSk,
                  ":token": { S: token },
                },
              },
            },
            signalChange(this.#table, job.scope.projectId),
          ],
        }),
      );
      return { job, token };
    } catch (error) {
      if (!failedCondition(error)) throw error;
    }
  }

  fence(lease: Lease, now: number): TransactWriteItem {
    return {
      ConditionCheck: {
        TableName: this.#table,
        Key: leaseKey(lease.job.scope.projectId),
        ConditionExpression: "#token = :token AND expires > :now",
        ExpressionAttributeNames: { "#token": "token" },
        ExpressionAttributeValues: { ":token": { S: lease.token }, ":now": number(now) },
      },
    };
  }

  async finish(
    lease: Lease,
    now: number,
    outcome: {
      status: "completed" | "retry" | "failed";
      reportRunId?: string;
      error?: string;
      dueAt?: number;
    },
  ) {
    const job = consolidationJob.parse({
      ...lease.job,
      ...outcome,
      dueAt: outcome.dueAt ?? now,
      updatedAt: now,
    });
    const guard = this.fence(lease, now).ConditionCheck!;
    try {
      await this.#client.send(
        new TransactWriteItemsCommand({
          TransactItems: [
            { Delete: guard },
            {
              Update: {
                TableName: this.#table,
                Key: jobKey(job.id),
                UpdateExpression: "SET job = :job, indexSk = :index REMOVE #token",
                ConditionExpression: "#token = :token",
                ExpressionAttributeNames: { "#token": "token" },
                ExpressionAttributeValues: {
                  ":job": { S: canonicalJson(job) },
                  ":index": jobItem(job).indexSk,
                  ":token": { S: lease.token },
                },
              },
            },
            signalChange(this.#table, job.scope.projectId),
          ],
        }),
      );
      return true;
    } catch (error) {
      if (!failedCondition(error)) throw error;
      return false;
    }
  }
}
