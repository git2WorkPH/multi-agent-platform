import { parseAgentResultEvent } from "../../contracts/src/index.ts";
import { modelGenerationResult } from "../../contracts/src/model.ts";
import type { AgentResultEvent } from "../../contracts/src/index.ts";
import {
  consolidationInput,
  consolidationReport,
  consolidationScope,
} from "../../contracts/src/consolidation.ts";
import type { ConsolidationInput, ConsolidationScope } from "../../contracts/src/consolidation.ts";
import type {
  ConsolidationRepository,
  ConsolidationResultReader,
} from "../../core/consolidation.ts";
import { canonicalJson, digest } from "../../core/results.ts";
import { validateGeneration } from "../provider.ts";
import type { ModelProvider } from "../provider.ts";

interface Dependencies {
  results: ConsolidationResultReader;
  reports: ConsolidationRepository;
  provider: ModelProvider;
  now?: () => Date;
}

interface Options {
  expectedAgentIds?: readonly string[];
  staleAfterMs?: number;
  reuse?: boolean;
}

async function select(results: ConsolidationResultReader, scope: ConsolidationScope) {
  const latest = new Map<string, AgentResultEvent>();
  for await (const raw of results.projectResults(scope.projectId)) {
    const event = parseAgentResultEvent(raw);
    if (event.projectId !== scope.projectId) throw new Error("Result outside requested project");
    const key = canonicalJson([event.agentId, event.resultId]);
    const prior = latest.get(key);
    if (!prior || event.revision > prior.revision) latest.set(key, event);
    else if (event.revision === prior.revision && event.eventId !== prior.eventId) {
      throw new Error("Conflicting stored result revisions");
    }
  }
  return [...latest.values()]
    .filter(
      (event) =>
        event.metadata.includeInConsolidation !== false &&
        (scope.topic === undefined || scope.topic === event.topic) &&
        (scope.correlationId === undefined || scope.correlationId === event.correlationId),
    )
    .sort((a, b) => (a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0));
}

async function prepare(
  results: ConsolidationResultReader,
  scope: ConsolidationScope,
  options: Options,
  now: Date,
): Promise<ConsolidationInput> {
  if (
    options.staleAfterMs !== undefined &&
    (!Number.isFinite(options.staleAfterMs) || options.staleAfterMs < 0)
  ) {
    throw new Error("staleAfterMs must be a finite nonnegative duration");
  }
  const selected = await select(results, scope);
  if (!selected.length) throw new Error("No persisted results match the consolidation scope");
  if (selected.length > 64)
    throw new Error("Consolidation source count exceeds the generation budget");
  const sources: ConsolidationInput["request"]["sources"] = [];
  const evidence: ConsolidationInput["evidence"] = [];
  const issues: ConsolidationInput["issues"] = [];
  const publishers = new Set(selected.map((event) => event.agentId));
  for (const agentId of [...new Set(options.expectedAgentIds)].sort()) {
    if (!publishers.has(agentId)) issues.push({ kind: "missing_publisher", agentId });
  }
  for (const event of selected) {
    const { agentId, eventId, status, occurredAt, summary, contentType, resultId, revision } =
      event;
    if (status !== "completed") issues.push({ kind: status, eventId, agentId });
    if (
      options.staleAfterMs !== undefined &&
      now.getTime() - Date.parse(occurredAt) > options.staleAfterMs
    ) {
      issues.push({ kind: "stale", eventId, agentId });
    }
    let content: string;
    let artifactDigest: string | undefined;
    if (event.artifactKey === undefined) {
      content = canonicalJson(event.data);
    } else {
      const bytes = await results.readArtifact({ ...event, artifactKey: event.artifactKey });
      artifactDigest = digest(bytes);
      if (!/^(application\/(?:[^;]+\+)?json|text\/[^;]+)(?:;|$)/i.test(contentType)) {
        throw new Error(`Unsupported artifact content type for event ${eventId}`);
      }
      content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (/^application\//i.test(contentType)) content = canonicalJson(JSON.parse(content));
    }
    sources.push({ eventId, agentId, status, summary, content });
    evidence.push({
      eventId,
      eventDigest: digest(canonicalJson(event)),
      artifactDigest,
      occurredAt,
      contentType,
      resultId,
      revision,
      sources: event.sources,
    });
  }
  return consolidationInput.parse({
    selectionVersion: 1,
    scope,
    request: { schemaVersion: 1, projectId: scope.projectId, topic: scope.topic, sources },
    evidence,
    issues,
  });
}

export async function consolidate(
  dependencies: Dependencies,
  runId: string,
  rawScope: ConsolidationScope,
  options: Options = {},
) {
  const { results, reports, provider, now = () => new Date() } = dependencies;
  const scope = consolidationScope.parse(rawScope);
  consolidationReport.shape.runId.parse(runId);
  const existing = await reports.getReport(runId, scope);
  if (existing) return existing;
  const captured =
    (await reports.getCapture(runId, scope)) ??
    (await reports.capture(runId, await prepare(results, scope, options, now())));
  const { input, inputFingerprint, snapshotKey } = captured;
  if (options.reuse && provider.model) {
    const reusable = await reports.findReusable?.(
      scope,
      inputFingerprint,
      provider.name,
      provider.model,
    );
    if (reusable) return reusable;
  }
  const generated = modelGenerationResult.parse(
    await provider.generate(structuredClone(input.request)),
  );
  if (generated.provider !== provider.name)
    throw new Error("Report provenance does not match provider");
  const generation = validateGeneration(
    input.request,
    JSON.stringify(generated.report),
    generated.provider,
    generated.model,
  );
  return reports.append({
    schemaVersion: 1,
    reportId: digest(canonicalJson(scope)),
    runId,
    scope,
    generatedAt: now().toISOString(),
    inputFingerprint,
    snapshotKey,
    sourceEventIds: input.evidence.map((source) => source.eventId),
    issues: input.issues,
    status: "completed",
    generation,
  });
}
