# 007 Verification and provisioning

Keep the SDK bootstrap as the default local path. Offer Terraform as a separate state-managed option with equivalent queues, tables, indexes, and bucket. Terraform 1.17.1 with AWS provider 6.72.0 completed an apply and a no-change plan against Floci 2.4.0 from both macOS and a container. SDK probes passed against the resulting resources.

The deterministic CI job builds the dashboard and runs unit, Floci, and browser tests without Ollama. Real inference remains opt-in because it depends on a locally installed model and available compute. The optional Compose profile starts a pinned Ollama image with local cloud features disabled.
