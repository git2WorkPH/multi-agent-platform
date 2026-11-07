import { z } from "zod";
import { agentResultEventV1 } from "./index.ts";
import { consolidationReport, consolidationScope } from "./consolidation.ts";
import { consolidationJob } from "./jobs.ts";

export const projectParams = z.strictObject({ id: consolidationScope.shape.projectId });
export const detailParams = z.strictObject({ id: z.union([z.uuid(), consolidationReport.shape.reportId]) });
const pagination = {
  cursor: z.string().min(1).max(4096).optional(),
  limit: z.string().regex(/^(?:[1-9]|[1-4][0-9]|50)$/).optional(),
};
export const agentsQuery = z.strictObject(pagination);
export const resultsQuery = z.strictObject({
  ...pagination, topic: consolidationScope.shape.topic,
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  eventId: z.uuid().optional(),
}).refine(query => !query.from || !query.to || Date.parse(query.from) <= Date.parse(query.to),
  "Result date range is reversed")
  .refine(query => !query.eventId || !(query.topic || query.from || query.to || query.cursor),
    "Event lookup cannot be combined with result filters or a cursor");
export const consolidationsQuery = z.strictObject({ ...pagination, kind: z.enum(["reports", "jobs"]).optional() });
export const eventsQuery = z.strictObject({ projectId: consolidationScope.shape.projectId });
export const createJobBody = z.strictObject({
  topic: consolidationScope.shape.topic, correlationId: consolidationScope.shape.correlationId,
  force: z.boolean().optional(),
});

export const reportSummary = consolidationReport.pick({
  runId: true, reportId: true, revision: true, generatedAt: true, status: true, inputFingerprint: true, scope: true,
}).extend({ provider: z.enum(["mock", "ollama"]), model: z.string() });

export const apiResultPage = z.strictObject({
  items: z.array(agentResultEventV1), nextCursor: z.string().nullable(),
});
export const apiConsolidationPage = z.strictObject({
  items: z.array(z.union([reportSummary, consolidationJob])), nextCursor: z.string().nullable(),
});
export const apiAgentsPage = z.strictObject({
  projects: z.array(z.string()),
  items: z.array(z.strictObject({ agentId: z.string(), agentVersion: z.string(), lastSeenAt: z.string() })),
  nextCursor: z.string().nullable(),
});
export const apiJobDetail = z.strictObject({
  job: consolidationJob.nullable(), report: consolidationReport.nullable(),
});
export const apiJobAccepted = z.strictObject({ job: consolidationJob });
export const apiHealth = z.strictObject({ status: z.literal("ok"), provider: z.string(), model: z.string().nullable() });
export const apiError = z.strictObject({ error: z.strictObject({ code: z.string(), message: z.string() }) });
