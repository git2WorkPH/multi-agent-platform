# 003 Local model provider boundary

Use a versioned request schema and a shared output validator with explicit provenance. Findings and conflicts require evidence IDs drawn from the normalized source records. Recommendations and identified information gaps have their own fields. The caller supplies source content as data. Ollama receives no tools and the prompt instructs it to disregard embedded instructions. Output validation constrains shape and reference membership. It cannot establish whether a claim is true or whether the source supports it.

The adapter uses native fetch, disables redirects, checks installed models, and retries timeouts, transport failures, rate limits, and server errors with bounded exponential backoff. Invalid output and missing models fail immediately. Inputs exceeding the configured contract budget fail explicitly. The mock uses deterministic fixtures and simulated failures. The consolidation engine and persistence of report revisions enter in later phases.

Ollama 0.18.1 stopped its runner with the full bounded Zod schema on the tested machine. The wire grammar keeps the required object shape and types while dropping repetition and format constraints that can expand the grammar. The full Zod schema still checks length, cardinality, UUIDs, and provenance after decoding. Native CPU execution is selectable through `OLLAMA_NUM_GPU=0`.
