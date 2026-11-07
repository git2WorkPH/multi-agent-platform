import { z } from "zod";
import { modelGenerationRequest, modelGenerationResult } from "./model.ts";

const identifier = z.string().min(1).max(128);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.iso.datetime();

export const consolidationScope = z.strictObject({
  projectId: identifier,
  topic: z.string().min(1).max(256).optional(),
  correlationId: identifier.optional(),
});

export const consolidationInput = z.strictObject({
  selectionVersion: z.literal(1),
  scope: consolidationScope,
  request: modelGenerationRequest,
  evidence: z.array(z.strictObject({
    eventId: z.uuid(),
    eventDigest: hash,
    artifactDigest: hash.optional(),
    occurredAt: z.iso.datetime({ offset: true }),
    contentType: identifier,
    resultId: identifier,
    revision: z.number().int().positive(),
    sources: z.array(z.object({
      title: z.string().min(1).max(512),
      uri: z.string().min(1).max(2048).optional(),
    })).max(100),
  })).min(1).max(64),
  issues: z.array(z.strictObject({
    kind: z.enum(["stale", "partial", "failed", "missing_publisher"]),
    agentId: identifier,
    eventId: z.uuid().optional(),
  })).max(192),
});

export const consolidationReport = z.strictObject({
  schemaVersion: z.literal(1),
  reportId: hash,
  revision: z.number().int().positive(),
  runId: z.uuid(),
  scope: consolidationScope,
  generatedAt: timestamp,
  inputFingerprint: hash,
  snapshotKey: z.string().min(1),
  sourceEventIds: z.array(z.uuid()).min(1).max(64),
  issues: consolidationInput.shape.issues,
  status: z.literal("completed"),
  generation: modelGenerationResult,
});

export type ConsolidationScope = z.infer<typeof consolidationScope>;
export type ConsolidationInput = z.infer<typeof consolidationInput>;
export type ConsolidationReport = z.infer<typeof consolidationReport>;
