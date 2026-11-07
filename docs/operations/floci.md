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

Compatibility probes leave isolated resources in the emulator for inspection. Floci tests exercise application-facing AWS operations. They do not exercise production IAM, service quotas, or AWS latency. The SDK bootstrap and optional Terraform module have both been verified against the pinned Floci image.

## Optional Terraform provisioning

Use Terraform 1.17.1 and the pinned AWS provider in `infrastructure/terraform`. Start Floci, then choose a separate resource prefix. The Terraform module uses local endpoints and dummy credentials.

```sh
export TF_VAR_prefix=multi-agent-tf
terraform -chdir=infrastructure/terraform init
terraform -chdir=infrastructure/terraform plan
terraform -chdir=infrastructure/terraform apply
export LOCAL_RESOURCE_PREFIX="$TF_VAR_prefix"
```

Use the Terraform state for resources created by Terraform and the SDK bootstrap for its own prefix. Keep state files local. The module also supports `TF_VAR_endpoint=http://floci:4566` for a Terraform runner on the Compose network. On the pinned Floci release, queue creation took roughly 25 seconds per stage in the containerized Terraform probe. Allow the provider to finish its propagation checks.
