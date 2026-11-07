import { readFile } from "node:fs/promises";
import { publishResult } from "../../packages/messaging/results.ts";

const path = process.env.RESEARCH_FIXTURE ?? new URL("./fixture.json", import.meta.url);
const findings: unknown = JSON.parse(await readFile(path, "utf8"));
if (!Array.isArray(findings) || findings.length === 0 ||
  findings.some(item => typeof item !== "string" || !item.trim())) {
  throw new Error("Research fixture must be a nonempty JSON array of findings");
}
await publishResult("research", `Collected ${findings.length} fixture findings`, { findings }, [
  { title: "Configured research fixture" },
]);
