import { GetItemCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import type { AttributeValue, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { parseAgentResultEvent } from "../contracts/src/index.ts";
import { reportSummary } from "../contracts/src/api.ts";
import { consolidationJob } from "../contracts/src/jobs.ts";
import { canonicalJson, digest } from "../core/results.ts";

export class InvalidCursor extends Error {}

type Key = Record<string, AttributeValue>;
type PageOptions = { limit: number; cursor?: string };
type ResultPageOptions = PageOptions & { from?: string; to?: string; eventId?: string };

function decodeCursor(
  cursor: string | undefined,
  scope: string,
  partitionName: string,
  partition: string,
  indexed: boolean,
) {
  if (!cursor) return undefined;
  try {
    const data: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      !Array.isArray(data) ||
      data[0] !== scope ||
      data.length !== (indexed ? 5 : 3) ||
      data.slice(1).some((value) => typeof value !== "string" || !value || value.length > 1024)
    )
      throw new Error();
    const [, pk, sk, indexPk, indexSk] = data;
    const key: Key = { pk: { S: pk }, sk: { S: sk } };
    if (indexed) Object.assign(key, { indexPk: { S: indexPk }, indexSk: { S: indexSk } });
    if (key[partitionName].S !== partition) throw new Error();
    return key;
  } catch {
    throw new InvalidCursor("Invalid pagination cursor");
  }
}

export function encodeCursor(scope: string, key: Key | undefined, indexed: boolean) {
  if (!key || !Object.keys(key).length) return null;
  const values = [scope, key.pk.S, key.sk.S];
  if (indexed) values.push(key.indexPk.S, key.indexSk.S);
  return Buffer.from(JSON.stringify(values)).toString("base64url");
}

export class AwsApiQueries {
  readonly #dynamo: DynamoDBClient;
  readonly #results: string;
  readonly #consolidations: string;

  constructor(dynamo: DynamoDBClient, results: string, consolidations: string) {
    this.#dynamo = dynamo;
    this.#results = results;
    this.#consolidations = consolidations;
  }

  async #page(
    TableName: string,
    partition: string,
    indexed: boolean,
    options: ResultPageOptions,
    prefix?: string,
  ) {
    const { from, to } = options;
    const range =
      from || to
        ? {
            ":start": { S: (prefix ?? "") + (from ? new Date(from).toISOString() + "#" : "0000-") },
            ":end": { S: (prefix ?? "") + (to ? new Date(to).toISOString() + "#" : "") + "~" },
          }
        : undefined;
    const scope = digest(canonicalJson([TableName, partition, indexed, prefix, range]));
    const partitionName = indexed ? "indexPk" : "pk";
    const partitionMatch = "#partition = :partition";
    const expression = range
      ? partitionMatch + " AND #sort BETWEEN :start AND :end"
      : prefix
        ? partitionMatch + " AND begins_with(sk, :prefix)"
        : partitionMatch;
    const result = await this.#dynamo.send(
      new QueryCommand({
        TableName,
        IndexName: indexed ? "lookup" : undefined,
        ConsistentRead: indexed ? undefined : true,
        KeyConditionExpression: expression,
        ExpressionAttributeNames: {
          "#partition": partitionName,
          ...(range ? { "#sort": indexed ? "indexSk" : "sk" } : {}),
        },
        ExpressionAttributeValues: {
          ":partition": { S: partition },
          ...(range ?? (prefix ? { ":prefix": { S: prefix } } : {})),
        },
        ExclusiveStartKey: decodeCursor(options.cursor, scope, partitionName, partition, indexed),
        Limit: options.limit,
        ScanIndexForward: false,
      }),
    );
    return {
      items: result.Items ?? [],
      nextCursor: encodeCursor(scope, result.LastEvaluatedKey, indexed),
    };
  }

  async results(project: string, topic: string | undefined, options: ResultPageOptions) {
    const partition = `project#${digest(project)}`;
    if (options.eventId) {
      const event = await this.#resultByEvent(partition, options.eventId);
      return { items: event ? [event] : [], nextCursor: null };
    }
    const page = topic
      ? await this.#page(this.#results, `${partition}#topic#${digest(topic)}`, true, options)
      : await this.#page(this.#results, partition, false, options, "result#");
    return {
      ...page,
      items: page.items.map((item) => parseAgentResultEvent(JSON.parse(item.event.S!))),
    };
  }

  async #resultByEvent(partition: string, eventId: string) {
    const read = async (pk: string, sk: string) =>
      (
        await this.#dynamo.send(
          new GetItemCommand({
            TableName: this.#results,
            Key: { pk: { S: pk }, sk: { S: sk } },
            ConsistentRead: true,
          }),
        )
      ).Item;
    const receipt = await read(`event#${eventId}`, "receipt");
    if (!receipt) return undefined;
    if (receipt.resultPk?.S !== undefined) {
      if (receipt.resultPk.S !== partition || !receipt.resultSk?.S) return undefined;
      const result = await read(partition, receipt.resultSk.S);
      return result && parseAgentResultEvent(JSON.parse(result.event.S!));
    }
    // Older receipts contain only the fingerprint. Search the authorized project.
    let cursor: string | undefined;
    do {
      const page = await this.#page(
        this.#results,
        partition,
        false,
        { limit: 50, cursor },
        "result#",
      );
      const item = page.items.find((result) => result.sk.S?.endsWith(`#${eventId}`));
      if (item) return parseAgentResultEvent(JSON.parse(item.event.S!));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
  }

  async consolidations(project: string, kind: "reports" | "jobs", options: PageOptions) {
    const partition = `${kind === "jobs" ? "jobs" : "project"}#${digest(project)}`;
    const page = await this.#page(this.#consolidations, partition, true, options);
    return {
      ...page,
      items: page.items.map((item) =>
        kind === "jobs"
          ? consolidationJob.parse(JSON.parse(item.job.S!))
          : reportSummary.parse({
              runId: item.runId.S,
              reportId: item.reportId.S,
              revision: Number(item.revision.N),
              generatedAt: item.generatedAt.S,
              status: item.status.S,
              inputFingerprint: item.inputFingerprint.S,
              scope: JSON.parse(item.scope.S!),
              provider: item.provider.S,
              model: item.model.S,
            }),
      ),
    };
  }

  async latestReportRun(reportId: string) {
    const pk = { S: `report#${reportId}` };
    const read = async (sk: string) =>
      (
        await this.#dynamo.send(
          new GetItemCommand({
            TableName: this.#consolidations,
            Key: { pk, sk: { S: sk } },
            ConsistentRead: true,
          }),
        )
      ).Item;
    const head = await read("head");
    if (!head?.revision.N) return undefined;
    const revision = await read(`revision#${head.revision.N.padStart(16, "0")}`);
    return revision?.runId.S;
  }
}
