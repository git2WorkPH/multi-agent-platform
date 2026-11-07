import type { ModelProvider } from "../../packages/ai/provider.ts";
import { consolidate } from "../../packages/ai/consolidation/index.ts";
import { ModelProviderError } from "../../packages/ai/provider.ts";
import type {
  ConsolidationRepository,
  ConsolidationResultReader,
} from "../../packages/core/consolidation.ts";
import type { ConsolidationJob } from "../../packages/contracts/src/jobs.ts";
import type { AwsConsolidationJobs, Lease } from "../../packages/aws-adapters/jobs.ts";

export async function workOnce(deps: {
  jobs: AwsConsolidationJobs;
  reports: (lease: Lease) => ConsolidationRepository;
  results: ConsolidationResultReader;
  provider: ModelProvider;
  now?: () => number;
  leaseMs: number;
  maxAttempts?: number;
  options?: { expectedAgentIds?: readonly string[]; staleAfterMs?: number };
  onError?: (job: ConsolidationJob, error: unknown) => void;
}) {
  const { jobs, results, provider, now = Date.now, leaseMs, maxAttempts = 4 } = deps;
  await jobs.schedule(now());
  for await (const candidate of jobs.due(now())) {
    const lease = await jobs.claim(candidate, now(), leaseMs);
    if (!lease) continue;
    const { job } = lease;
    const reports = deps.reports(lease);
    let report;
    try {
      report = await reports.getReport(job.id, job.scope);
      if (!report && job.attempts > maxAttempts) {
        await jobs.finish(lease, now(), { status: "failed", error: "retry_exhausted" });
        return true;
      }
      report ??= await consolidate(
        { results, reports, provider, now: () => new Date(now()) },
        job.id,
        job.scope,
        { ...deps.options, reuse: job.trigger === "manual" && !job.force },
      );
    } catch (error) {
      deps.onError?.(job, error);
      const retry =
        job.attempts < maxAttempts &&
        (!(error instanceof ModelProviderError) ||
          ["rate_limit", "unavailable", "timeout"].includes(error.code));
      await jobs.finish(lease, now(), {
        status: retry ? "retry" : "failed",
        error: error instanceof ModelProviderError ? error.code : "consolidation_failed",
        dueAt: retry ? now() + Math.min(60_000, 1000 * 2 ** (job.attempts - 1)) : undefined,
      });
      return true;
    }
    await jobs.finish(lease, now(), {
      status: "completed",
      reportRunId: report.runId,
      error: undefined,
    });
    return true;
  }
  return false;
}
