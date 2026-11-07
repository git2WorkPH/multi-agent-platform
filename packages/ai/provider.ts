import { modelGenerationResult } from "../contracts/src/model.ts";
import type { ModelGenerationRequest, ModelGenerationResult } from "../contracts/src/model.ts";

export interface ModelProvider {
  readonly name: string;
  readonly model?: string;
  generate(request: ModelGenerationRequest): Promise<ModelGenerationResult>;
}

type ErrorCode =
  "timeout" | "rate_limit" | "unavailable" | "missing_model" | "provider_error" | "invalid_output";

export class ModelProviderError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ModelProviderError";
    this.code = code;
  }
}

export function validateGeneration(
  request: ModelGenerationRequest,
  raw: string,
  provider: "mock" | "ollama",
  model: string,
): ModelGenerationResult {
  let result: ModelGenerationResult;
  try {
    if (raw.length > 256_000) throw new Error("Output exceeds generation budget");
    result = modelGenerationResult.parse({
      provider,
      model,
      simulated: provider === "mock",
      report: JSON.parse(raw),
    });
  } catch (cause) {
    throw new ModelProviderError("invalid_output", `${provider} returned invalid report JSON`, {
      cause,
    });
  }

  const allowed = new Set(request.sources.map((source) => source.eventId));
  for (const item of [...result.report.findings, ...result.report.conflicts]) {
    if (item.sourceEventIds.some((id) => !allowed.has(id))) {
      throw new ModelProviderError(
        "invalid_output",
        `${provider} cited an event outside the supplied sources`,
      );
    }
  }
  return result;
}
