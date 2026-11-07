import { setTimeout as delay } from "node:timers/promises";
import { modelGenerationRequest } from "../../../contracts/src/model.ts";
import type { ModelGenerationRequest, ModelGenerationResult } from "../../../contracts/src/model.ts";
import { ModelProviderError, validateGeneration } from "../../provider.ts";
import type { ModelProvider } from "../../provider.ts";

type MockOptions = {
  response?: unknown | ((request: ModelGenerationRequest) => unknown);
  delayMs?: number;
  failure?: "invalid_json" | "timeout" | "provider_error" | "rate_limit";
  assertInput?: (request: ModelGenerationRequest) => void;
};

export class MockModelProvider implements ModelProvider {
  readonly name = "mock";
  readonly #calls: ModelGenerationRequest[] = [];
  readonly #options: MockOptions;

  constructor(options: MockOptions = {}) {
    this.#options = options;
  }

  get invocations(): readonly ModelGenerationRequest[] {
    return structuredClone(this.#calls);
  }

  async generate(input: ModelGenerationRequest): Promise<ModelGenerationResult> {
    const request = modelGenerationRequest.parse(input);
    this.#calls.push(structuredClone(request));
    this.#options.assertInput?.(structuredClone(request));
    if (this.#options.delayMs) await delay(this.#options.delayMs);
    const { failure, response } = this.#options;
    if (failure === "invalid_json") return validateGeneration(request, "{", "mock", "fixture-v1");
    if (failure) throw new ModelProviderError(failure, `Simulated mock failure: ${failure}`);
    const report = response === undefined ? {
      executiveSummary: `Simulated fixture report for ${request.projectId}`,
      findings: request.sources.map(source => ({
        text: `${source.agentId} (${source.status}): ${source.summary}`.slice(0, 4096),
        sourceEventIds: [source.eventId],
      })),
      conflicts: [],
      missingInformation: [],
      recommendations: [],
    } : typeof response === "function" ? response(structuredClone(request)) : response;
    return validateGeneration(request, JSON.stringify(report), "mock", "fixture-v1");
  }
}
