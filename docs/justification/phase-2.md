# Phase 2 rationale

Approved in chat. Add independent fixture publishers and an ingestion consumer. Standard SQS delivery plus transactional receipts and revision keys protect against replays and conflicting revisions. Store bounded large payloads under digest keys before publishing metadata. A crash can leave an unreferenced object, but retrying uses the same object. Keep AWS client operations in adapters and leave scheduling to Phase 5. No existing behavior or tests are removed.
