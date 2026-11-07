# Ollama integration

On macOS, start the Ollama application or run `OLLAMA_NO_CLOUD=1 ollama serve` in a terminal. Use `ollama list` to find installed models. If needed, download a local model with `ollama pull qwen3:4b`. A model download requires network access. Inference can run locally after installation.

For CPU-only Docker operation:

```sh
docker run -d --name multi-agent-ollama \
  -p 127.0.0.1:11434:11434 -e OLLAMA_NO_CLOUD=1 \
  -v multi-agent-ollama:/root/.ollama ollama/ollama
docker exec multi-agent-ollama ollama pull llama3.2
```

Host applications use `http://127.0.0.1:11434`. A container reaching native Ollama on Docker Desktop for macOS can use `http://host.docker.internal:11434` if the host listener accepts that traffic. Keep access restricted to the intended interface and clients. Services on the same Docker network can use the Ollama container or service name instead.

```sh
OLLAMA_MODEL=llama3.2:latest pnpm test:ollama
```

The adapter checks `GET /api/tags` before submitting non-streaming chat with a Zod-derived JSON Schema. It validates the report and source IDs after inference. Configure the endpoint, model, attempt timeout, and retry count in `.env.example`. A missing model error identifies the tag to install. A timeout may indicate that model loading or inference exceeds the configured budget. Connection failures point to the endpoint and server configuration.

See the [chat API](https://docs.ollama.com/api/chat), [model listing API](https://docs.ollama.com/api/tags), and [Docker setup](https://docs.ollama.com/docker).

If the native Metal runner exits while loading or generating, set `OLLAMA_NUM_GPU=0` to run inference on the CPU. For example, use `OLLAMA_MODEL=qwen2.5:7b OLLAMA_NUM_GPU=0 pnpm test:ollama` with that tag installed. Model listing verifies the tag is advertised. The smoke test also verifies that the server can load it and generate a report.

Run the provider directly from the repository root on the pinned Node version:

```sh
AI_PROVIDER=ollama OLLAMA_MODEL=qwen2.5:7b OLLAMA_NUM_GPU=0 node --input-type=module <<'JS'
import { createModelProvider } from "./packages/ai/index.ts";
import { request } from "./tests/fixtures/model-request.ts";
const result = await createModelProvider().generate(request);
console.log(result.model, result.report.findings.map(finding => finding.sourceEventIds));
JS
```
