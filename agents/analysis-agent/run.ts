import { readFile } from "node:fs/promises";
import { publishResult } from "../../packages/messaging/results.ts";

const path = process.env.ANALYSIS_FIXTURE ?? new URL("./fixture.json", import.meta.url);
const samples: unknown = JSON.parse(await readFile(path, "utf8"));
if (
  !Array.isArray(samples) ||
  samples.length === 0 ||
  samples.length > 10_000 ||
  samples.some((sample) => typeof sample !== "number" || !Number.isFinite(sample))
) {
  throw new Error("Analysis fixture must contain between 1 and 10000 finite numbers");
}
const mean = samples.reduce((sum: number, sample: number) => sum + sample / samples.length, 0);
await publishResult(
  "analysis",
  `Analyzed ${samples.length} sample values`,
  {
    count: samples.length,
    min: Math.min(...samples),
    max: Math.max(...samples),
    mean,
  },
  [{ title: "Configured numeric sample fixture" }],
);
