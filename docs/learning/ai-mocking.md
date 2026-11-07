# AI mocking

A test double substitutes for an inference provider so tests can control what the application receives. Stable fixtures make failures reproducible and let the suite run without a model server.

- A stub returns a predetermined answer.
- A fake implements simplified behavior, such as turning input fixtures into a report.
- A spy records calls for inspection.
- A mock verifies interactions against expectations.

The Mock provider can play each role. Pass it as a constructor argument or function parameter typed as `ModelProvider`. A composition root selects the concrete provider with the factory.

Run this example from the repository root on the pinned Node version:

```sh
node --input-type=module <<'JS'
import assert from "node:assert/strict";
import { MockModelProvider } from "./packages/ai/providers/mock/index.ts";
import { request, report } from "./tests/fixtures/model-request.ts";

const provider = new MockModelProvider({
  response: report,
  assertInput: input => assert.equal(input.projectId, "demo"),
});
const result = await provider.generate(request);
assert.equal(result.simulated, true);
assert.deepEqual(provider.invocations, [request]);

const throttled = new MockModelProvider({ failure: "rate_limit" });
await assert.rejects(throttled.generate(request), { code: "rate_limit" });
JS
```

Use `failure` to inject invalid JSON, timeouts, provider errors, or throttling. In Vitest, fake timers advance mock delays without wall-clock sleeps. For the HTTP adapter, the protocol suite stalls a real local HTTP response to exercise aborts and counts attempts to verify bounded retries.

Run `pnpm test` for deterministic checks and `pnpm test:ollama` with an installed model for real inference. Both validate the same report schema and source IDs. Mock outputs test application behavior and are labelled simulated. Real-model tests are needed to assess prompt adherence, synthesis quality, and hardware performance.
