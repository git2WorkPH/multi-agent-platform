import { z } from "zod";

const identifier = z.string().min(1).max(128);
const payload = z.union([
  z.object({ data: z.json(), artifactKey: z.undefined().optional() }),
  z.object({ artifactKey: z.string().min(1).max(1024), data: z.undefined().optional() }),
]);

export const agentResultEventV1 = z.object({
  schemaVersion: z.literal(1),
  eventId: z.uuid(),
  eventType: z.literal("agent.result"),
  agentId: identifier,
  agentVersion: identifier,
  projectId: identifier,
  correlationId: identifier,
  topic: z.string().min(1).max(256),
  resultId: identifier,
  revision: z.number().int().positive(),
  occurredAt: z.iso.datetime({ offset: true }),
  status: z.enum(["completed", "partial", "failed"]),
  summary: z.string().max(8192),
  contentType: z.string().min(1).max(128),
  sources: z.array(z.object({
    title: z.string().min(1).max(512),
    uri: z.string().min(1).max(2048).optional(),
  })).max(100),
  metadata: z.record(z.string(), z.json()),
}).and(payload);

export type AgentResultEvent = z.infer<typeof agentResultEventV1>;

export function parseAgentResultEvent(input: unknown): AgentResultEvent {
  const { schemaVersion } = z.object({ schemaVersion: z.number().int() }).parse(input);
  switch (schemaVersion) {
    case 1:
      return agentResultEventV1.parse(input);
    default:
      throw new Error(`Unsupported agent result schema version: ${schemaVersion}`);
  }
}

export * from "./model.ts";
