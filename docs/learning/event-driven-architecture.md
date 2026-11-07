# Event-driven architecture

A publisher sends an `AgentResultEvent` without knowing which consumer processes it. The consumer validates the versioned envelope and acknowledges after the DynamoDB commit. SQS can deliver an event more than once. The event ID identifies delivery duplicates, the logical result ID and revision identify immutable history, and the correlation ID groups evidence from independent agents.

Run the following TypeScript example from the repository root. It reads the wire format through the same decoder as ingestion:

```sh
node --input-type=module <<'JS'
import { randomUUID } from "node:crypto";
import { parseAgentResultEvent } from "./packages/contracts/src/index.ts";
const eventId = randomUUID();
const event = parseAgentResultEvent({
  schemaVersion: 1, eventType: "agent.result", eventId,
  agentId: "research", agentVersion: "1.0.0", projectId: "demo",
  correlationId: "demo-run", topic: "sample", resultId: eventId, revision: 1,
  occurredAt: new Date().toISOString(), status: "partial",
  summary: "One sample is available.", contentType: "application/json",
  data: { count: 1 }, sources: [], metadata: {},
});
console.log(event.eventId, event.correlationId, event.status);
JS
```

Publish both demo agents with `pnpm agent:research` and `pnpm agent:analysis` after bootstrapping. A durable dirty generation advances in the ingestion transaction. The consolidation queue is a wake-up channel, so a lost wake-up delays discovery until the next poll. A poison delivery can be inspected in the ingestion DLQ after the receive limit.
