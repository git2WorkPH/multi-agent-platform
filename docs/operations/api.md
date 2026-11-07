# API and worker

With Floci running and resources bootstrapped, start the result consumer and consolidation worker in separate terminals:

```sh
pnpm consume:results
pnpm work:consolidation
```

For local development, start the API on loopback with an explicit project grant:

```sh
API_AUTH_MODE=development API_DEV_PROJECTS=demo pnpm api
```

Publish either example agent. After the debounce and worker poll, list the reports:

```sh
curl http://127.0.0.1:3000/api/projects/demo/consolidations
curl -N 'http://127.0.0.1:3000/api/events?projectId=demo'
curl -i http://127.0.0.1:3000/api/projects/demo/consolidations \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: demo-force-1' \
  -d '{"topic":"sample","force":true}'
```

Follow the returned `Location` for job status and the completed report. The detail route also accepts a report run UUID or a stable report ID for the latest revision. Use `kind=jobs` on the consolidation listing for queued, running, retrying, failed, and completed jobs. Listings accept `limit` and `cursor`. The result listing accepts `topic`, `from`, and `to` filters, with inclusive ISO 8601 timestamps. Use the same filters when following a cursor. [OpenAPI](http://127.0.0.1:3000/openapi.json) describes the HTTP contracts.

SSE publishes an initial invalidation and another when the project's durable change counter advances. Use the same authenticated GET endpoints after each invalidation. On stream failure, poll those endpoints. Bearer-mode browser clients should stream with `fetch` to attach the authorization header.

Token authentication is the default. Configure `API_AUTH_CONFIG` with JSON entries containing a bearer `token` of at least 32 characters and a `projects` array. Supply it through a secret environment variable. Use TLS at the ingress when exposing token mode beyond loopback. Development auth is refused in production and requires loopback address, host, and origin checks.

`CONSOLIDATION_DEBOUNCE_MS` applies at ingestion. Set `CONSOLIDATION_LEASE_MS` longer than the worst-case provider call including retries and storage overhead. Expired attempts can be recovered on the next poll, and the expired token cannot publish. Configure the same `AI_PROVIDER` and model in the API and worker so the health endpoint describes the worker's intended configuration.
