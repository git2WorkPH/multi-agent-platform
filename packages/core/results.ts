import { createHash } from "node:crypto";
import type { AgentResultEvent } from "../contracts/src/index.ts";

export const inlineLimit = 32 * 1024;
export const artifactLimit = 4 * 1024 * 1024;

export function digest(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
    return Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  });
}

export function artifactNamespace(projectId: string) {
  return `results/${digest(projectId)}/`;
}

export interface ResultStore {
  save(event: AgentResultEvent): Promise<"stored" | "duplicate">;
}

export interface ResultPublisher {
  publish(event: AgentResultEvent): Promise<void>;
}
