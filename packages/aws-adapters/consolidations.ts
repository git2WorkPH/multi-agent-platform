import { GetItemCommand, PutItemCommand, TransactWriteItemsCommand } from "@aws-sdk/client-dynamodb";
import type { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import type { S3Client } from "@aws-sdk/client-s3";
import { consolidationInput, consolidationReport } from "../contracts/src/consolidation.ts";
import type { ConsolidationInput, ConsolidationScope } from "../contracts/src/consolidation.ts";
import type { ConsolidationRepository, ReportDraft } from "../core/consolidation.ts";
import { artifactLimit, canonicalJson, digest } from "../core/results.ts";

const runKey = (id: string) => ({ pk: { S: `run#${id}` }, sk: { S: "capture" } });
const scopeId = (scope: ConsolidationScope) => digest(canonicalJson(scope));

export class AwsConsolidationRepository implements ConsolidationRepository {
  readonly #dynamo: DynamoDBClient;
  readonly #s3: S3Client;
  readonly #table: string;
  readonly #bucket: string;

  constructor(aws: { dynamo: DynamoDBClient; s3: S3Client }, table: string, bucket: string) {
    this.#dynamo = aws.dynamo;
    this.#s3 = aws.s3;
    this.#table = table;
    this.#bucket = bucket;
  }

  async #run(runId: string, scope: ConsolidationScope) {
    const { Item } = await this.#dynamo.send(new GetItemCommand({
      TableName: this.#table, Key: runKey(runId), ConsistentRead: true,
    }));
    if (Item && Item.scopeId?.S !== scopeId(scope)) throw new Error("Run ID belongs to a different scope");
    return Item;
  }

  async #write(kind: "snapshots" | "reports", value: unknown) {
    const Body = canonicalJson(value);
    if (Buffer.byteLength(Body) > artifactLimit) throw new Error("Consolidation artifact exceeds the storage budget");
    const hash = digest(Body);
    const Key = `consolidations/${kind}/${hash}.json`;
    await this.#s3.send(new PutObjectCommand({
      Bucket: this.#bucket, Key, Body, ContentType: "application/json",
    }));
    return { Key, hash };
  }

  async #read(key: string) {
    const expected = /^consolidations\/(?:snapshots|reports)\/([a-f0-9]{64})\.json$/.exec(key)?.[1];
    if (!expected) throw new Error("Invalid consolidation artifact key");
    const object = await this.#s3.send(new GetObjectCommand({ Bucket: this.#bucket, Key: key }));
    if ((object.ContentLength ?? Infinity) > artifactLimit) {
      await object.Body?.transformToWebStream().cancel();
      throw new Error("Consolidation artifact exceeds the storage budget");
    }
    const body = await object.Body?.transformToString();
    if (body === undefined || digest(body) !== expected) throw new Error("Consolidation artifact digest mismatch");
    return JSON.parse(body);
  }

  async getCapture(runId: string, scope: ConsolidationScope) {
    const item = await this.#run(runId, scope);
    if (!item) return undefined;
    const snapshotKey = item.snapshotKey.S!;
    const inputFingerprint = item.inputFingerprint.S!;
    const input = consolidationInput.parse(await this.#read(snapshotKey));
    if (scopeId(input.scope) !== scopeId(scope) || digest(canonicalJson(input)) !== inputFingerprint) {
      throw new Error("Stored snapshot does not match the run");
    }
    return { input, inputFingerprint, snapshotKey };
  }

  async capture(runId: string, input: ConsolidationInput) {
    const existing = await this.getCapture(runId, input.scope);
    if (existing) return existing;
    const { Key: snapshotKey, hash: inputFingerprint } = await this.#write("snapshots", input);
    try {
      await this.#dynamo.send(new PutItemCommand({
        TableName: this.#table,
        Item: {
          ...runKey(runId), scopeId: { S: scopeId(input.scope) },
          snapshotKey: { S: snapshotKey }, inputFingerprint: { S: inputFingerprint },
        },
        ConditionExpression: "attribute_not_exists(pk)",
      }));
    } catch (error) {
      const winner = await this.getCapture(runId, input.scope);
      if (winner) return winner;
      throw error;
    }
    return { input, inputFingerprint, snapshotKey };
  }

  async getReport(runId: string, scope: ConsolidationScope) {
    const item = await this.#run(runId, scope);
    const key = item?.reportKey?.S;
    if (!key) return undefined;
    const report = consolidationReport.parse(await this.#read(key));
    if (report.runId !== runId || report.reportId !== scopeId(scope)
      || scopeId(report.scope) !== report.reportId || report.inputFingerprint !== item.inputFingerprint.S) {
      throw new Error("Stored report does not match the run");
    }
    return report;
  }

  async append(draft: ReportDraft) {
    const { runId, scope, reportId, inputFingerprint } = draft;
    if (reportId !== scopeId(scope)) throw new Error("Report ID does not match scope");
    const pk = { S: `report#${reportId}` };
    const headKey = { pk, sk: { S: "head" } };
    for (let attempt = 0; attempt < 5; attempt++) {
      const existing = await this.getReport(runId, scope);
      if (existing) return existing;
      const { Item: head } = await this.#dynamo.send(new GetItemCommand({
        TableName: this.#table, Key: headKey, ConsistentRead: true,
      }));
      const revision = Number(head?.revision.N ?? 0) + 1;
      const report = consolidationReport.parse({ ...draft, revision });
      const { Key: reportKey } = await this.#write("reports", report);
      try {
        await this.#dynamo.send(new TransactWriteItemsCommand({
          TransactItems: [
            { Put: {
              TableName: this.#table, Item: { ...headKey, revision: { N: String(revision) } },
              ConditionExpression: head ? "revision = :previous" : "attribute_not_exists(pk)",
              ExpressionAttributeValues: head ? { ":previous": { N: String(revision - 1) } } : undefined,
            } },
            { Put: {
              TableName: this.#table,
              Item: {
                pk, sk: { S: `revision#${String(revision).padStart(16, "0")}` },
                reportKey: { S: reportKey }, runId: { S: runId },
                indexPk: { S: `project#${digest(scope.projectId)}` },
                indexSk: { S: `${report.generatedAt}#${reportId}#${String(revision).padStart(16, "0")}` },
                generatedAt: { S: report.generatedAt }, inputFingerprint: { S: inputFingerprint },
                reportId: { S: reportId }, revision: { N: String(revision) },
                status: { S: report.status }, provider: { S: report.generation.provider },
                model: { S: report.generation.model }, scope: { S: canonicalJson(scope) },
              },
              ConditionExpression: "attribute_not_exists(pk)",
            } },
            { Update: {
              TableName: this.#table, Key: runKey(runId),
              UpdateExpression: "SET reportKey = :report",
              ConditionExpression: "scopeId = :scope AND inputFingerprint = :input AND snapshotKey = :snapshot AND attribute_not_exists(reportKey)",
              ExpressionAttributeValues: {
                ":report": { S: reportKey }, ":scope": { S: reportId }, ":input": { S: inputFingerprint },
                ":snapshot": { S: draft.snapshotKey },
              },
            } },
          ],
        }));
        return report;
      } catch (error) {
        const winner = await this.getReport(runId, scope);
        if (winner) return winner;
        if (!(error instanceof Error) || error.name !== "TransactionCanceledException" || attempt === 4) throw error;
        const current = await this.#run(runId, scope);
        if (current?.inputFingerprint.S !== inputFingerprint || current?.snapshotKey.S !== draft.snapshotKey) throw error;
      }
    }
    throw new Error("Report revision allocation exhausted");
  }
}
