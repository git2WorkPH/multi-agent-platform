# Dashboard

Start Floci, bootstrap the resources, and run the API, result consumer, and consolidation worker as described in [API operations](api.md). Start the dashboard from the repository root:

```sh
pnpm dashboard
```

Open `http://127.0.0.1:5174`. If that port is busy, set `DASHBOARD_PORT` in `.env` or use `pnpm dashboard --port 5198`. Vite proxies `/api` and `/health` to the loopback API using `API_PORT`. Set `DASHBOARD_API_URL` to override that target. Use `pnpm build:dashboard` to produce `apps/dashboard/dist`. A static deployment needs a same-origin reverse proxy for those two API paths.

For token mode, enter the bearer token under API access. The dashboard keeps the token in memory. Reloading the page requires re-entry. For local development, leave the token blank and configure the API's explicit loopback development mode.

Select an authorized project and enter an exact topic to filter results. Job and report filters apply to the pages loaded so far. Use Load more to search earlier pages. The manual control uses the current project and topic, with an optional correlation ID and force flag. Open any job or report to view details. Source buttons look up the original result by project and event ID. Inline evidence is shown as text and artifact evidence displays its stored key.

The dashboard consumes authenticated SSE invalidations, refreshes affected panels, and switches to polling when the stream disconnects or stalls. It reconnects in the background.

With Floci running, verify the browser flow:

```sh
pnpm exec playwright install chromium
pnpm test:e2e
```

The test boots an isolated stack, uses both independent agents, and checks automatic and manual revisions and the browser fallback. Set `PLAYWRIGHT_CHANNEL=chrome` to use a local Chrome installation.
