# Phase 7 verification

Completed the learning guides, architecture and security review, setup and troubleshooting runbook, and acceptance matrix. Added deterministic GitHub Actions, an opt-in real Ollama stack suite, optional Terraform provisioning, and an optional Ollama Compose service.

| Check | Observed result |
|---|---|
| Frozen install, strict TypeScript, Vite production build on Node 24.22.2 | Passed |
| Deterministic unit tests | 21 passed |
| Live Floci SDK integration tests | 9 passed |
| Playwright browser test against the live Mock stack | 1 passed |
| Native Ollama 0.18.1 with CPU-only qwen2.5:7b | Structured provider smoke and real Floci stack test passed. Automatic revision 1 and forced revision 2 were persisted. |
| Docker Ollama 0.18.1 with CPU-only qwen2.5:7b | Structured provider smoke passed. Optional Compose profile started and responded to the version endpoint. |
| Terraform 1.17.1 and AWS provider 6.72.0 | Both native macOS and container runners created six resources and showed no drift. The 9 Floci tests passed after each apply. |
| Production dependency advisory audit | Registry reported no known vulnerabilities at verification time. |

The Mock browser suite exercised both independent publishers, automatic and forced reports, evidence navigation, and polling fallback. Real model assertions checked schema and traceability. Review covered local-only infrastructure, project grants, development auth rejection in production, untrusted input handling, storage budgets, conditional publication, and separation of the agent runners from consolidation.

The verified model was qwen2.5:7b. Real AWS deployment and IAM parity remain outside the local acceptance checks. The scheduler and SSE query patterns target local MVP volumes. The unrelated bootstrap formatting edit is outside this phase.
