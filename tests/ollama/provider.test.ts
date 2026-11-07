import { expect, it } from "vitest";
import { createModelProvider } from "../../packages/ai/index.ts";
import { request } from "../fixtures/model-request.ts";

it("checks the installed model and generates a traceable report using real inference", async () => {
  const provider = createModelProvider({ ...process.env, AI_PROVIDER: "ollama" });
  const result = await provider.generate(request);
  expect(result).toMatchObject({ provider: "ollama", simulated: false });
  expect(result.report.findings.length).toBeGreaterThan(0);
  const sourceIds = result.report.findings.flatMap(finding => finding.sourceEventIds);
  expect(new Set(sourceIds)).toEqual(new Set(request.sources.map(source => source.eventId)));
}, 600_000);
