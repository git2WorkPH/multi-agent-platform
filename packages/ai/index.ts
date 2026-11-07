import { MockModelProvider } from "./providers/mock/index.ts";
import { OllamaModelProvider } from "./providers/ollama/index.ts";
import type { ModelProvider } from "./provider.ts";

export function createModelProvider(env: NodeJS.ProcessEnv = process.env): ModelProvider {
  const provider = env.AI_PROVIDER ?? "mock";
  switch (provider) {
    case "mock":
      return new MockModelProvider();
    case "ollama":
      return new OllamaModelProvider({
        baseUrl: env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434",
        model: env.OLLAMA_MODEL ?? "qwen3:4b",
        timeoutMs: Number(env.OLLAMA_TIMEOUT_MS ?? "120000"),
        retries: Number(env.OLLAMA_RETRIES ?? "1"),
        numGpu: env.OLLAMA_NUM_GPU === undefined ? undefined : Number(env.OLLAMA_NUM_GPU),
      });
    default:
      throw new Error("AI_PROVIDER must be mock or ollama");
  }
}
