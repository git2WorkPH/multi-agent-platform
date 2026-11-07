import { pathToFileURL } from "node:url";
import {
  CreateQueueCommand, GetQueueAttributesCommand, QueueNameExists, SQSClient,
} from "@aws-sdk/client-sqs";
import {
  CreateTableCommand, DescribeTableCommand, DynamoDBClient, ResourceInUseException, waitUntilTableExists,
} from "@aws-sdk/client-dynamodb";
import {
  BucketAlreadyOwnedByYou, CreateBucketCommand, S3Client,
} from "@aws-sdk/client-s3";
import type { BucketLocationConstraint } from "@aws-sdk/client-s3";

export function localAws(prefix = process.env.LOCAL_RESOURCE_PREFIX ?? "multi-agent") {
  const endpoint = new URL(process.env.LOCAL_AWS_ENDPOINT ?? "http://127.0.0.1:4566");
  if (endpoint.protocol !== "http:" || !["127.0.0.1", "localhost", "floci"].includes(endpoint.hostname)
    || endpoint.username || endpoint.password || endpoint.pathname !== "/" || endpoint.search || endpoint.hash) {
    throw new Error("LOCAL_AWS_ENDPOINT must be an HTTP loopback or Compose Floci endpoint");
  }
  if (!/^[a-z][a-z0-9-]{2,39}$/.test(prefix)) throw new Error("Invalid LOCAL_RESOURCE_PREFIX");
  const region = process.env.AWS_REGION ?? "us-east-1";
  const config = {
    endpoint: endpoint.origin,
    region,
    credentials: {
      accessKeyId: process.env.LOCAL_AWS_ACCESS_KEY_ID ?? "test",
      secretAccessKey: process.env.LOCAL_AWS_SECRET_ACCESS_KEY ?? "test",
    },
  };
  return {
    region, prefix,
    sqs: new SQSClient({ ...config, useQueueUrlAsEndpoint: false }),
    dynamo: new DynamoDBClient(config),
    s3: new S3Client({ ...config, forcePathStyle: true }),
  };
}

export async function bootstrap(aws = localAws()) {
  const { sqs, dynamo, s3, prefix, region } = aws;
  async function queue(suffix: string, redrivePolicy?: string) {
    const QueueName = `${prefix}-${suffix}`;
    try {
      const { QueueUrl } = await sqs.send(new CreateQueueCommand({
        QueueName,
        Attributes: redrivePolicy ? { RedrivePolicy: redrivePolicy } : undefined,
      }));
      if (!QueueUrl) throw new Error(`Missing queue URL for ${QueueName}`);
      return QueueUrl;
    } catch (error) {
      if (error instanceof QueueNameExists) {
        throw new Error(`Queue configuration differs for ${QueueName}`, { cause: error });
      }
      throw error;
    }
  }

  const dlq = await queue("ingestion-dlq");
  const { Attributes } = await sqs.send(new GetQueueAttributesCommand({
    QueueUrl: dlq, AttributeNames: ["QueueArn"],
  }));
  if (!Attributes?.QueueArn) throw new Error("Missing ingestion DLQ ARN");
  const ingestion = await queue("ingestion", JSON.stringify({
    deadLetterTargetArn: Attributes.QueueArn, maxReceiveCount: 3,
  }));
  const consolidation = await queue("consolidation");

  const results = `${prefix}-results`;
  const consolidations = `${prefix}-consolidations`;
  for (const TableName of [results, consolidations]) {
    const KeySchema = [
      { AttributeName: "pk", KeyType: "HASH" },
      { AttributeName: "sk", KeyType: "RANGE" },
    ] as const;
    const indexKeys = [
      { AttributeName: "indexPk", KeyType: "HASH" },
      { AttributeName: "indexSk", KeyType: "RANGE" },
    ] as const;
    try {
      await dynamo.send(new CreateTableCommand({
        TableName,
        BillingMode: "PAY_PER_REQUEST",
        KeySchema: [...KeySchema],
        AttributeDefinitions: [...KeySchema, ...indexKeys].map(({ AttributeName }) => ({
          AttributeName, AttributeType: "S",
        })),
        GlobalSecondaryIndexes: [{
          IndexName: "lookup", KeySchema: [...indexKeys], Projection: { ProjectionType: "ALL" },
        }],
      }));
    } catch (error) {
      if (!(error instanceof ResourceInUseException)) throw error;
    }
    await waitUntilTableExists({ client: dynamo, maxWaitTime: 30 }, { TableName });
    const { Table: table } = await dynamo.send(new DescribeTableCommand({ TableName }));
    const matches = (actual: NonNullable<typeof table>["KeySchema"], expected: typeof KeySchema | typeof indexKeys) =>
      actual?.length === expected.length && expected.every(key =>
        actual.some(candidate => candidate.AttributeName === key.AttributeName && candidate.KeyType === key.KeyType),
      );
    const lookup = table?.GlobalSecondaryIndexes?.find(index => index.IndexName === "lookup");
    if (!table || !matches(table.KeySchema, KeySchema) || !matches(lookup?.KeySchema, indexKeys)
      || lookup?.Projection?.ProjectionType !== "ALL") {
      throw new Error(`Table configuration differs for ${TableName}`);
    }
  }

  const bucket = `${prefix}-artifacts`;
  try {
    await s3.send(new CreateBucketCommand({
      Bucket: bucket,
      CreateBucketConfiguration: region === "us-east-1" ? undefined : {
        LocationConstraint: region as BucketLocationConstraint,
      },
    }));
  } catch (error) {
    if (!(error instanceof BucketAlreadyOwnedByYou)) throw error;
  }
  return { dlq, ingestion, consolidation, results, consolidations, bucket };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await bootstrap(), null, 2));
}
