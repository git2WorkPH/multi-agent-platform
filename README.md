# Local-first multi-agent platform

Two independent agents publish evidence to a local AWS-compatible stack. A background worker consolidates stored results into versioned reports with a deterministic Mock or local Ollama provider.

Use the Node version in `.node-version`, pnpm 12.18.0, and Docker Compose.

```sh
pnpm install --frozen-lockfile
docker compose -f infrastructure/docker-compose.yml up -d
pnpm bootstrap
pnpm typecheck
pnpm test
LOCAL_RESOURCE_PREFIX=phase1-probe-$(date +%s) pnpm test:floci
```

The bootstrap prints the names and URLs it provisioned. It is safe to rerun with the same configuration. For overrides, export the desired variables from `.env.example` or invoke Node with `--env-file`. If changing `FLOCI_PORT`, set `LOCAL_AWS_ENDPOINT` to the matching host port. See [Floci operations](docs/operations/floci.md) for restart verification and [contract evolution](docs/architecture/decisions/001-local-substrate-and-contract.md) for the wire policy.

## End-to-end walkthrough

[Watch the 34-second captioned demo (WebM)](docs/media/end-to-end-walkthrough.webm?raw=1). It follows two independent agent publications through Floci ingestion, automatic consolidation, source tracing, and a forced second report revision. The recording uses the deterministic Mock provider.

## Format the code

Run `pnpm format` to apply ESLint fixes or `pnpm lint` to check formatting without editing files. CI runs the same check.

## Run the example agents

With Floci running and the resources bootstrapped, start the consumer in one terminal.

```sh
pnpm consume:results
```

Publish each result independently from another terminal.

```sh
pnpm agent:research
pnpm agent:analysis
```

Set `RESEARCH_FIXTURE` to a JSON array of findings or `ANALYSIS_FIXTURE` to a JSON array of numbers to use your own inputs. Both agents accept `AGENT_PROJECT_ID`, `AGENT_TOPIC`, and `AGENT_CORRELATION_ID`. Set `AGENT_RESULT_ID` and `AGENT_REVISION` to publish a new revision of an existing result. To replay the same publication across processes, also pin `AGENT_EVENT_ID` and `AGENT_OCCURRED_AT` and keep the payload and scope identical.

The consumer acknowledges deliveries after storing them. Malformed and conflicting deliveries remain eligible for SQS dead-letter routing. See [the ingestion decision](docs/architecture/decisions/002-result-ingestion.md) for storage and retry behavior.

## Model providers

Set `AI_PROVIDER=mock` for deterministic simulated output or `AI_PROVIDER=ollama` for local inference. Run `pnpm test:ollama` with a reachable server and installed `OLLAMA_MODEL`. See [Ollama setup](docs/learning/ollama-integration.md) and [AI mocking examples](docs/learning/ai-mocking.md).

## Run a standalone consolidation

After the consumer stores results, run:

```sh
AI_PROVIDER=mock pnpm consolidate demo sample demo-run
```

The topic and correlation ID are optional. Supply an empty topic argument to filter only by correlation ID. Set `CONSOLIDATION_EXPECTED_AGENTS` to a comma-separated list of expected publishers and `CONSOLIDATION_STALE_MS` to a freshness threshold. Each new run creates a report revision. To retry the same run after a failure, set `CONSOLIDATION_RUN_ID` to the same UUID on each attempt. See [consolidation design](docs/learning/consolidation-design.md).

## Run the hybrid scheduler and API

Run `pnpm work:consolidation` alongside the result consumer for automatic reports. Start `API_AUTH_MODE=development API_DEV_PROJECTS=demo pnpm api` for local API access and manual requests. See [API and worker operations](docs/operations/api.md) for authentication, polling, and request examples.

## Open the dashboard

Run `pnpm dashboard` after starting the API, consumer, and worker. The dashboard shows publisher activity, agent evidence, jobs, and report revisions. See [dashboard operations](docs/operations/dashboard.md) for setup, credentials, and browser tests.

## Architecture and verification

- [Architecture overview](docs/architecture/overview.md)
- [Setup and troubleshooting](docs/operations/setup.md)
- [Acceptance criteria and verification commands](docs/testing/verification.md)
- [Event-driven architecture](docs/learning/event-driven-architecture.md)
- [AWS with Floci](docs/learning/aws-with-floci.md)
