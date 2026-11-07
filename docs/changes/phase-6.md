# Phase 6 verification

Added the React and Vite dashboard for project and topic selection, publisher activity, agent results, job progress, manual runs, and report history. Report details display provider provenance, contradictions, missing information, and clickable references to the original event. The dashboard uses bearer-capable SSE with polling fallback and reconnect.

| Check | Result |
|---|---|
| Frozen install, strict TypeScript, and production Vite build on Node 24.22.2 | Passed |
| Deterministic unit tests | 21 passed |
| Live Floci integration tests | 9 passed |
| Playwright against local Chrome and a live Floci, Fastify, and worker stack | 1 passed |
| Desktop preview and narrow viewport overflow check | Passed |

The browser test exercised credential entry, project and topic filters, both agent results, automatic revision 1, mock provenance, missing publishers, source lookup, and manual revision 2 after blocking SSE. Integration checks covered current and legacy evidence receipts and denied cross-project evidence lookup.

The API remains project-authorized. The dashboard keeps tokens in memory. Report and job topic filters apply to the currently loaded pages. Artifact evidence shows the persisted key. This phase used the Mock provider for browser verification. Phase 7 is the full validation and documentation pass.
