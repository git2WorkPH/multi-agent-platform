# Phase 3 rationale

The user approved v1.1 Phase 3. Add a versioned Zod generation boundary and a factory for the deterministic Mock and local Ollama providers. Native fetch avoids another client dependency. Structured output constrains generation, while runtime validation independently verifies schema and source membership. Limit retries to transient transport and HTTP failures. Keep the deterministic suite separate from live inference. No existing functionality is removed.
