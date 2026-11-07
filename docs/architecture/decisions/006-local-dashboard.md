# 006 Local dashboard

Build the dashboard as a React and Vite workspace and use the existing Zod API contracts to validate responses. A same-origin proxy serves the browser API paths. The dashboard keeps bearer credentials in memory and renders agent and model text as text.

Use authenticated fetch streams to support both bearer and loopback development modes. A bounded stream parser reads invalidation events, polls after disconnection or inactivity, and reconnects. The browser shows provider provenance on report summaries and details.

Add project-scoped event lookups to the existing results route. New receipts store the result key in the ingestion transaction. Older receipts fall back to a paginated search within the authorized project. This preserves links to historical evidence without a migration. The UI displays artifact keys without granting direct S3 access.
