import type { ModelGenerationRequest } from "../../packages/contracts/src/model.ts";

export const request: ModelGenerationRequest = {
  schemaVersion: 1,
  projectId: "demo",
  topic: "sample",
  sources: [
    {
      eventId: "00000000-0000-4000-8000-000000000001",
      agentId: "research",
      status: "completed",
      summary: "The sample contains four measurements.",
      content: "Measurements: 12, 18, 24, 30.",
    },
  ],
};

export const report = {
  executiveSummary: "Four measurements were supplied.",
  findings: [{ text: "Four measurements", sourceEventIds: [request.sources[0].eventId] }],
  conflicts: [],
  missingInformation: [],
  recommendations: [],
};
