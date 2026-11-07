import { z } from "zod";
import { consolidationScope } from "./consolidation.ts";

export const consolidationJob = z.strictObject({
  id: z.uuid(),
  scope: consolidationScope,
  trigger: z.enum(["automatic", "manual"]),
  force: z.boolean(),
  status: z.enum(["queued", "running", "retry", "completed", "failed"]),
  attempts: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  dueAt: z.number().int().nonnegative(),
  reportRunId: z.uuid().optional(),
  error: z.string().optional(),
});
export type ConsolidationJob = z.infer<typeof consolidationJob>;
