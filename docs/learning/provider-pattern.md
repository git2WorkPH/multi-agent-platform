# Provider pattern

The application receives the `ModelProvider` port and passes a normalized request. The factory is the configuration boundary. The concrete providers attach provenance and both use the same output validator.

Run this TypeScript example with Node from the repository root:

```sh
AI_PROVIDER=mock node --input-type=module <<'JS'
import { createModelProvider } from "./packages/ai/index.ts";
import { request } from "./tests/fixtures/model-request.ts";
const provider = createModelProvider();
console.log(await provider.generate(request));
JS
```

Switch to an installed Ollama model by setting `AI_PROVIDER=ollama` and `OLLAMA_MODEL`. The caller uses the same request and response types.
