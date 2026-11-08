import { z } from "zod";

export const machineReviewDigest = z.object({
  inspected: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  truncated: z.boolean(),
  findings: z
    .array(
      z.object({
        category: z.enum(["cleanup", "security"]),
        path: z.string(),
        reason: z.string(),
      }),
    )
    .max(30),
});
