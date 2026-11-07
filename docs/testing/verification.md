# v1.1 verification

Run deterministic tests without Ollama:

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build:dashboard
pnpm test
docker compose -f infrastructure/docker-compose.yml up -d floci
LOCAL_RESOURCE_PREFIX=verify-$(date +%s) pnpm test:floci
pnpm exec playwright install chromium
pnpm test:e2e
```

The GitHub Actions workflow runs the deterministic checks on pull requests and pushes to `master`. Browser tests start an isolated local stack. Floci probes leave their resource prefixes for inspection.

Run the real-model suites only with an installed model and reachable endpoint:

```sh
OLLAMA_MODEL=qwen2.5:7b OLLAMA_NUM_GPU=0 pnpm test:ollama
OLLAMA_MODEL=qwen2.5:7b OLLAMA_NUM_GPU=0 pnpm test:ollama-stack
```

The first suite verifies real structured inference and cited event IDs. The second also requires Floci and checks both independently published results, automatic synthesis, a forced revision, and preservation of the earlier revision. Assertions check shape, provenance, and reference membership. Generated prose can vary.

| Acceptance area | Verification |
|---|---|
| Local execution and independence | Browser and real-model stack tests execute both independent Node agents. Core code has no agent imports or scheduling controls for agent execution. |
| Wire version, replay, persistence | Unit and Floci tests cover v1 compatibility, collisions, redrive, immutable evidence, S3 offload, pagination, and transaction rollback. |
| Dual providers and valid reports | Provider unit, HTTP protocol, and real-model tests cover configuration selection, timeouts, retries, schema validation, provenance, and source references. |
| Automatic and manual consolidation | Floci tests cover debounce, lost wake-ups, worker races, fencing, recovery, reuse, and force. Browser tests verify both report revisions and fallback polling. |
| Authorization and dashboard | API and browser tests cover project grants, evidence lookup, history, publisher display, and simulated labels. |
| Learning and operations | Six runnable [learning guides](../learning/) and [setup instructions](../operations/setup.md) describe the boundaries and local workflow. |

See the [Phase 7 record](../changes/phase-7.md) for measured results and remaining environment limits.
