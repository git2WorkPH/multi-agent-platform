# Phase 3 verification

Added a shared Zod generation contract, configuration factory, deterministic Mock provider, and Ollama HTTP provider. The provider boundary validates output and source membership before returning a report. Mock output carries simulated provenance. The learning guides include runnable examples.

| Check | Result |
|---|---|
| Frozen install and strict TypeScript on Node 24.22.2 | Passed |
| Deterministic unit and provider HTTP tests | 20 passed |
| Live Floci regression tests | 5 passed |
| Native Ollama 0.18.1, qwen2.5:7b, CPU-only | 1 passed in 12.59 seconds |

The default example tag qwen3:4b was unavailable locally. The listed llama3.2 tag returned HTTP 404, and the Qwen runner stopped with the original schema. The structural grammar projection and CPU setting produced a valid report citing the supplied event. The full Zod validator still checks all output constraints. Docker operation is documented. The recorded live pass used native macOS.

Review covered provenance, reference membership, bounded input and output, timeout coverage through body reads, bounded retry attempts, and separation from the real-model suite. Phase 4 adds persisted input selection and immutable report revisions.
