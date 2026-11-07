# 001 Local substrate and v1 agent result contract

Use a digest-pinned Floci 2.4.0 image and standard SQS queues. Provision queues, DynamoDB tables, a sparse lookup index on each table, and an S3 bucket with TypeScript and the AWS SDK v3. The bootstrap isolates local endpoint and credential settings. A second provisioning path would require its own apply and reconciliation checks.

Publish JSON with numeric `schemaVersion` and stable `eventType`. A producer generates one UUID for each publication and reuses it for delivery retries. Group related results using `correlationId` within a project. A logical result can publish additional positive revisions. Every event has exactly one payload representation, even when the status is partial or failed. Source metadata and agent content are untrusted. Artifact ownership, size, and digest checks belong at ingestion.

For v1, additive optional fields may be ignored by older readers. Producers must not depend on older consumers retaining those fields. Changing a required field, enum, representation, or meaning requires a new version and a separate decoder. Unsupported versions are explicit failures. Retain the original v1 fixture and run it against every reader change.
