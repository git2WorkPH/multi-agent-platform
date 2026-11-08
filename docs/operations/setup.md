# Local setup and troubleshooting

## Start with deterministic inference

Install the Node version in `.node-version`, pnpm 12.18.0, and Docker Compose. From the repository root:

```sh
pnpm install --frozen-lockfile
test -f .env || cp .env.example .env
docker compose -f infrastructure/docker-compose.yml up -d floci
pnpm bootstrap
```

Start each process in a separate terminal. Dotenv reads the repository's `.env` at startup. Exported environment variables take precedence, so use the same resource prefix and endpoint across all processes.

```sh
pnpm consume:results
pnpm work:consolidation
pnpm api
pnpm dashboard
```

Publish both independent agents with `pnpm agent:research` and `pnpm agent:analysis`. Open the URL printed by Vite. Use Reports to view the automatic result after debounce. In the manual form, enter the topic filter `sample` and select Force new revision to create the next revision of that scope. Match the API and worker AI configuration to display the intended provider on the dashboard.

## Switch to Ollama

Choose an installed model and set `AI_PROVIDER=ollama` and `OLLAMA_MODEL` before restarting the API and worker. The environment example defaults to `qwen3:4b`. Choose `qwen2.5:7b` if it is already installed. On a host with a failing Metal runner, set `OLLAMA_NUM_GPU=0`.

For a separate CPU-only container, use the optional Compose profile:

```sh
OLLAMA_PORT=11436 docker compose -f infrastructure/docker-compose.yml --profile ollama up -d ollama
docker compose -f infrastructure/docker-compose.yml --profile ollama exec ollama ollama pull qwen3:4b
```

Set `OLLAMA_BASE_URL=http://127.0.0.1:11436` in host processes when using this port. [Ollama integration](../learning/ollama-integration.md) covers native macOS and container networking.

## Diagnose startup and job issues

| Symptom | Check |
|---|---|
| Bootstrap cannot connect | Check Docker is running and inspect Floci logs. The host port is 4566 unless overridden. Set `LOCAL_AWS_ENDPOINT` to match. |
| Dashboard returns 401 | Configure the loopback development grant or enter an authorized bearer token under API access. |
| Dashboard returns 403 | Check the selected project grant and, in development mode, use a loopback hostname. |
| Jobs stay queued | Check the worker is running with the same resource prefix as the API and consumer. A lost wake-up is recovered on the next DynamoDB poll. |
| Job fails with `missing_model` | Check `/api/tags` on the configured Ollama endpoint and install or select a supported model. |
| Job retries with `timeout` or `unavailable` | Inspect the Ollama server and runner logs. Check CPU/GPU settings, model availability, and the attempt and lease budgets. |
| Old events appear without an automatic job | Automatic dirty markers are written when results are first accepted. Use a manual request for results stored before scheduling was enabled. |
| Source evidence shows an artifact key | The dashboard displays the managed storage reference. Use authorized local S3 operations to inspect its bytes. |
