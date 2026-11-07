import assert from "node:assert/strict";
import { GetItemCommand, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { ReceiveMessageCommand, SendMessageCommand } from "@aws-sdk/client-sqs";
import { bootstrap, localAws } from "../../infrastructure/bootstrap/resources.ts";

const [mode, token] = process.argv.slice(2);
if (!token || !["write", "verify"].includes(mode) || !process.env.LOCAL_RESOURCE_PREFIX) {
  throw new Error("Set an isolated LOCAL_RESOURCE_PREFIX and pass write|verify and a probe token");
}
const aws = localAws();
const resources = await bootstrap(aws);
const key = { pk: { S: "restart-probe" }, sk: { S: token } };
const object = { Bucket: resources.bucket, Key: `restart-probe/${token}` };

if (mode === "write") {
  await aws.dynamo.send(new PutItemCommand({ TableName: resources.results, Item: key }));
  await aws.s3.send(new PutObjectCommand({ ...object, Body: token }));
  await aws.sqs.send(
    new SendMessageCommand({ QueueUrl: resources.consolidation, MessageBody: token }),
  );
} else {
  const result = await aws.dynamo.send(
    new GetItemCommand({
      TableName: resources.results,
      Key: key,
      ConsistentRead: true,
    }),
  );
  assert.deepEqual(result.Item, key);
  assert.equal(
    await (await aws.s3.send(new GetObjectCommand(object))).Body?.transformToString(),
    token,
  );
  const { Messages } = await aws.sqs.send(
    new ReceiveMessageCommand({
      QueueUrl: resources.consolidation,
      WaitTimeSeconds: 2,
      VisibilityTimeout: 0,
    }),
  );
  assert.equal(Messages?.[0]?.Body, token);
}
console.log(`Restart probe ${mode} passed`);
