# 004 Consolidation snapshots and immutable revisions

Read persisted project results through a paginated repository port. Select the highest revision per agent and logical result, then apply the optional topic and correlation filters. A result that moved topics is selected only in its latest scope. Older revisions remain stored. The snapshot records ordered event IDs, digests, normalized content, source metadata, and explicit failed, partial, stale, and missing-publisher observations.

Capture the canonical input before inference. A conditional run record binds its UUID to the scope and snapshot fingerprint. Retries reuse that snapshot even if new results arrive. The snapshot preserves the exact model request. The report preserves provider, model, generation time, references, and the input fingerprint. Source references are checked again at the engine boundary. Artifact inputs are read as verified UTF-8 text or JSON. Unsupported inputs and inputs above the generation budget fail explicitly.

Use a report ID derived from the canonical scope. Write digest-addressed report content to S3, then transactionally advance the scope head, insert the immutable revision metadata, and complete the run record. A concurrent writer can retry revision allocation. A repeated completed run returns the same revision. A failed write can leave an unreferenced S3 object, which has no visible report revision.

The paginated source query can observe results arriving during selection. The captured snapshot records what was actually used. Phase 5 will add durable dirty generations, job leases, and fenced scheduling. Phase 4 stores snapshots and completed reports and exposes generation failures to its caller.
