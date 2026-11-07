import type { AgentResultEvent } from "../contracts/src/index.ts";
import type { ConsolidationInput, ConsolidationReport, ConsolidationScope } from "../contracts/src/consolidation.ts";

export interface ConsolidationResultReader {
  projectResults(projectId: string): AsyncIterable<unknown>;
  readArtifact(event: AgentResultEvent & { artifactKey: string }): Promise<Uint8Array>;
}

export interface CapturedInput {
  input: ConsolidationInput;
  inputFingerprint: string;
  snapshotKey: string;
}

export type ReportDraft = Omit<ConsolidationReport, "revision">;

export interface ConsolidationRepository {
  getCapture(runId: string, scope: ConsolidationScope): Promise<CapturedInput | undefined>;
  capture(runId: string, input: ConsolidationInput): Promise<CapturedInput>;
  getReport(runId: string, scope: ConsolidationScope): Promise<ConsolidationReport | undefined>;
  append(draft: ReportDraft): Promise<ConsolidationReport>;
}
