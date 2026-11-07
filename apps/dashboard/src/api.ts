import {
  apiAgentsPage,
  apiConsolidationPage,
  apiError,
  apiHealth,
  apiJobAccepted,
  apiJobDetail,
  apiResultPage,
} from "../../../packages/contracts/src/api.ts";
import type { AgentResultEvent } from "../../../packages/contracts/src/index.ts";
import type { ConsolidationReport } from "../../../packages/contracts/src/consolidation.ts";
import type { ConsolidationJob } from "../../../packages/contracts/src/jobs.ts";

type Parser<T> = { parse(value: unknown): T };
type Page<T> = { items: T[]; nextCursor: string | null };
export type Agent = ReturnType<typeof apiAgentsPage.parse>["items"][number];
export type ReportSummary = Exclude<
  ReturnType<typeof apiConsolidationPage.parse>["items"][number],
  ConsolidationJob
>;
export type { AgentResultEvent, ConsolidationJob, ConsolidationReport };

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const endpoint = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}`;
const query = (values: Record<string, string | undefined>) =>
  new URLSearchParams(
    Object.entries(values).flatMap(([key, value]) => (value ? [[key, value]] : [])),
  ).toString();

export function createApi(token: string) {
  const auth = token ? { Authorization: `Bearer ${token}` } : undefined;
  async function request<T>(
    path: string,
    schema: Parser<T>,
    signal?: AbortSignal,
    init?: RequestInit,
  ) {
    const headers = new Headers(init?.headers);
    if (auth) headers.set("Authorization", auth.Authorization);
    const response = await fetch(path, { ...init, headers, signal, cache: "no-store" });
    if (!response.ok) {
      const error = apiError.safeParse(await response.json().catch(() => undefined));
      throw new ApiError(
        response.status,
        error.success ? error.data.error.message : `API returned HTTP ${response.status}`,
      );
    }
    return schema.parse(await response.json());
  }

  return {
    health: (signal: AbortSignal) => request("/health", apiHealth, signal),
    agents: (signal: AbortSignal, cursor?: string) =>
      request(`/api/agents?${query({ cursor })}`, apiAgentsPage, signal),
    results: (id: string, signal: AbortSignal, topic?: string, cursor?: string) =>
      request(`${endpoint(id)}/results?${query({ topic, cursor })}`, apiResultPage, signal),
    async evidence(id: string, eventId: string, signal: AbortSignal) {
      const page = await request(
        `${endpoint(id)}/results?${query({ eventId })}`,
        apiResultPage,
        signal,
      );
      return page.items[0] as AgentResultEvent | undefined;
    },
    async jobs(id: string, signal: AbortSignal, cursor?: string): Promise<Page<ConsolidationJob>> {
      const page = await request(
        `${endpoint(id)}/consolidations?${query({ kind: "jobs", cursor })}`,
        apiConsolidationPage,
        signal,
      );
      return {
        ...page,
        items: page.items.filter((item): item is ConsolidationJob => "trigger" in item),
      };
    },
    async reports(id: string, signal: AbortSignal, cursor?: string): Promise<Page<ReportSummary>> {
      const page = await request(
        `${endpoint(id)}/consolidations?${query({ cursor })}`,
        apiConsolidationPage,
        signal,
      );
      return {
        ...page,
        items: page.items.filter((item): item is ReportSummary => "reportId" in item),
      };
    },
    detail: (runId: string, signal: AbortSignal) =>
      request(`/api/consolidations/${encodeURIComponent(runId)}`, apiJobDetail, signal),
    create: (
      id: string,
      body: { topic?: string; correlationId?: string; force: boolean },
      key: string,
      signal: AbortSignal,
    ) =>
      request(`${endpoint(id)}/consolidations`, apiJobAccepted, signal, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify(body),
      }),
    async stream(
      id: string,
      signal: AbortSignal,
      onOpen: () => void,
      onUpdate: () => void,
      onActivity: () => void,
    ) {
      const response = await fetch(`/api/events?${query({ projectId: id })}`, {
        headers: auth,
        signal,
        cache: "no-store",
      });
      if (
        !response.ok ||
        !response.body ||
        !response.headers.get("content-type")?.startsWith("text/event-stream")
      ) {
        await response.body?.cancel();
        throw new Error("Live update stream unavailable");
      }
      onOpen();
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) throw new Error("Live update stream disconnected");
          onActivity();
          buffer += value;
          let end: number;
          while ((end = buffer.indexOf("\n\n")) >= 0) {
            const frame = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            if (frame.startsWith("event: invalidate\n")) onUpdate();
          }
          if (buffer.length > 16384) throw new Error("Invalid live update frame");
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    },
  };
}

export type DashboardApi = ReturnType<typeof createApi>;
