# AWS with Floci

Floci implements AWS-compatible service endpoints. The local configuration passes an explicit endpoint and test credentials to SDK v3, enables path-style S3, and keeps SQS on the configured endpoint even when the returned queue URL advertises a different host. The business layer uses repository ports.

Start Floci, then run this example from the repository root on the pinned Node version:

```sh
node --input-type=module <<'JS'
import { GetQueueAttributesCommand } from "@aws-sdk/client-sqs";
import { bootstrap, localAws } from "./infrastructure/bootstrap/resources.ts";
const aws = localAws();
const resources = await bootstrap(aws);
const queue = await aws.sqs.send(new GetQueueAttributesCommand({
  QueueUrl: resources.ingestion, AttributeNames: ["RedrivePolicy"],
}));
console.log(JSON.parse(queue.Attributes.RedrivePolicy).maxReceiveCount);
JS
```

Expect a receive limit of three. The integration suite covers real message delivery, conditional writes, rollback, pagination, and artifact reads through the SDK. Emulation does not reproduce all AWS authorization, latency, and throughput characteristics. See [Floci operations](../operations/floci.md) for configuration.
