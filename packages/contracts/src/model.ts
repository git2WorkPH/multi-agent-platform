import { z } from "zod";

const eventId = z.uuid();
const text = z.string().trim().min(1).max(4096);
const references = z.array(eventId).min(1).max(64);
const sourcedText = z.strictObject({ text, sourceEventIds: references });

export const modelGenerationRequest = z
  .strictObject({
    schemaVersion: z.literal(1),
    projectId: z.string().min(1).max(128),
    topic: z.string().min(1).max(256).optional(),
    sources: z
      .array(
        z.strictObject({
          eventId,
          agentId: z.string().min(1).max(128),
          status: z.enum(["completed", "partial", "failed"]),
          summary: z.string().max(8192),
          content: z.string().max(16000),
        }),
      )
      .min(1)
      .max(64),
  })
  .refine(
    (request) =>
      new Set(request.sources.map((source) => source.eventId)).size === request.sources.length,
    "Source event IDs must be unique",
  )
  .refine(
    (request) => Buffer.byteLength(JSON.stringify(request)) <= 10_000,
    "Model input exceeds the generation budget",
  );

export const modelReport = z.strictObject({
  executiveSummary: text,
  findings: z.array(sourcedText).max(64),
  conflicts: z.array(sourcedText).max(64),
  missingInformation: z.array(text).max(64),
  recommendations: z.array(text).max(64),
});

export const modelGenerationResult = z
  .strictObject({
    provider: z.enum(["mock", "ollama"]),
    model: z.string().min(1).max(128),
    simulated: z.boolean(),
    report: modelReport,
  })
  .refine(
    (result) => result.simulated === (result.provider === "mock"),
    "Invalid provider provenance",
  );

export type ModelGenerationRequest = z.infer<typeof modelGenerationRequest>;
export type ModelGenerationResult = z.infer<typeof modelGenerationResult>;
