# Local Floci operations

Compose binds Floci to loopback and stores state on a named volume. Host SDK clients use `http://127.0.0.1:4566`. Clients on the Compose network use `http://floci:4566`. The bootstrap sets the SQS client to use the configured endpoint even when Floci returns a localhost queue URL. Local credentials are dummy values and S3 uses path-style addressing.

Check port conflicts with `docker compose -f infrastructure/docker-compose.yml ps` and inspect service logs if bootstrap cannot connect. If resource definitions differ from the expected configuration, use a fresh prefix or reconcile the resources explicitly.

Run restart verification against a dedicated local instance when no workloads are active:

```sh
export LOCAL_RESOURCE_PREFIX=restart-probe-$(date +%s)
node tests/integration/persistence.ts write "$LOCAL_RESOURCE_PREFIX"
docker compose -f infrastructure/docker-compose.yml restart floci
# Wait for Floci to listen before verifying.
node tests/integration/persistence.ts verify "$LOCAL_RESOURCE_PREFIX"
```

Compatibility probes leave isolated resources in the emulator for inspection. Floci tests exercise application-facing AWS operations. They do not exercise production IAM, service quotas, or AWS latency. Terraform support is documented upstream. The SDK bootstrap is the verified local provisioning path.
