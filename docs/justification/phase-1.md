# Phase 1 rationale

The v1.1 plan approved in chat establishes a TypeScript workspace, a versioned event boundary, and a verified local AWS substrate. Both local and remote Git baselines are empty. All files in this phase are additions.

A TypeScript AWS SDK bootstrap exercises the same protocol as the adapters and limits the initial provisioning surface. Terraform is deferred pending compatibility evaluation. Docker Compose provides persistent local infrastructure with a pinned image. Unit fixtures and live probes cover contract evolution, queue delivery, transaction rollback, and persistence. Application processes and real model testing belong to later phases.
