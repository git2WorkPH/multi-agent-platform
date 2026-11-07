# Phase 5 rationale

The user approved the v1.1 hybrid job scheduler and API. Mark changed scopes in the ingestion transaction, use DynamoDB as the durable scheduling authority, and treat SQS as an optional wake-up signal. A project lease prevents overlapping jobs and a transactional fence guards report publication. Fastify exposes project-scoped reads and manual job requests with authenticated SSE invalidation. Existing standalone consolidation remains available.
