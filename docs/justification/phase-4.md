# Phase 4 rationale

The user approved the v1.1 consolidation engine. Select persisted revisions through a reader port and capture the exact normalized input before inference. Store content by digest in S3 and allocate immutable revision metadata with conditional DynamoDB transactions. A run ID supports replay after ambiguous writes and preserves the original snapshot across retries. Keep the invocation standalone so Phase 5 can call the same engine from both triggers. No existing behavior is removed.
