# Local-first multi-agent platform

Phase 1 provides the local AWS infrastructure and the v1 agent result contract.

Use the Node version in `.node-version`, pnpm 11.25.0, and Docker Compose.

```sh
pnpm install --frozen-lockfile
docker compose -f infrastructure/docker-compose.yml up -d
pnpm bootstrap
pnpm typecheck
pnpm test
LOCAL_RESOURCE_PREFIX=phase1-probe-$(date +%s) pnpm test:floci
```

The bootstrap prints the names and URLs it provisioned. It is safe to rerun with the same configuration. For overrides, export the desired variables from `.env.example` or invoke Node with `--env-file`. If changing `FLOCI_PORT`, set `LOCAL_AWS_ENDPOINT` to the matching host port. See [Floci operations](docs/operations/floci.md) for restart verification and [contract evolution](docs/architecture/decisions/001-local-substrate-and-contract.md) for the wire policy.
