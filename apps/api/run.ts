import "../../packages/core/load-env.ts";
import { localAws } from "../../infrastructure/bootstrap/resources.ts";
import { createModelProvider } from "../../packages/ai/index.ts";
import { AwsApiQueries } from "../../packages/aws-adapters/api-queries.ts";
import { AwsConsolidationJobs } from "../../packages/aws-adapters/jobs.ts";
import { AwsConsolidationRepository } from "../../packages/aws-adapters/consolidations.ts";
import { AwsResultStore } from "../../packages/aws-adapters/result-store.ts";
import { consolidationWake } from "../../packages/messaging/consolidation.ts";
import { apiAuth } from "./auth.ts";
import { buildApi } from "./server.ts";

const aws = localAws();
const auth = apiAuth();
const host = process.env.API_HOST ?? "127.0.0.1";
if (auth.localOnly && !["127.0.0.1", "::1"].includes(host))
  throw new Error("Development API must bind to loopback");
const table = `${aws.prefix}-consolidations`;
const resultsTable = `${aws.prefix}-results`;
const bucket = `${aws.prefix}-artifacts`;
const wake = consolidationWake(aws.sqs, aws.prefix);
const app = await buildApi({
  auth,
  provider: createModelProvider(),
  queries: new AwsApiQueries(aws.dynamo, resultsTable, table),
  jobs: new AwsConsolidationJobs(aws.dynamo, table),
  reports: new AwsConsolidationRepository(aws, table, bucket),
  results: new AwsResultStore(aws, resultsTable, bucket),
  wake: wake.send,
});
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => void app.close());
await app.listen({ host, port: Number(process.env.API_PORT ?? 3000) });
