# Consolidation design

Agents publish results independently. The engine consumes persisted data through a reader port and selects the latest revision within the requested scope. Failed and partial results remain part of the evidence. Freshness and missing-publisher checks use explicit project expectations.

A content fingerprint identifies the normalized input. A run UUID identifies one attempt that may be retried. A report ID identifies a scope, and a revision identifies one successful generation for that scope. A new run can create a new revision with the same fingerprint. Retrying the same run returns its existing report or uses the original snapshot to continue.

After running the example publishers and consumer, run this TypeScript example from the repository root:

```sh
AI_PROVIDER=mock node --input-type=module <<'JS'
import { randomUUID } from "node:crypto";
import { localAws } from "./infrastructure/bootstrap/resources.ts";
import { createModelProvider } from "./packages/ai/index.ts";
import { consolidate } from "./packages/ai/consolidation/index.ts";
import { AwsResultStore } from "./packages/aws-adapters/result-store.ts";
import { AwsConsolidationRepository } from "./packages/aws-adapters/consolidations.ts";

const aws = localAws();
const bucket = `${aws.prefix}-artifacts`;
const report = await consolidate({
  results: new AwsResultStore(aws, `${aws.prefix}-results`, bucket),
  reports: new AwsConsolidationRepository(aws, `${aws.prefix}-consolidations`, bucket),
  provider: createModelProvider(),
}, randomUUID(), { projectId: "demo", topic: "sample" });
console.log(report.revision, report.inputFingerprint, report.sourceEventIds);
JS
```
