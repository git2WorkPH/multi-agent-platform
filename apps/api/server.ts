import { setTimeout as delay } from "node:timers/promises";
import swagger from "@fastify/swagger";
import Fastify from "fastify";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import {
  agentsQuery, apiAgentsPage, apiConsolidationPage, apiError, apiHealth, apiJobAccepted, apiJobDetail,
  apiResultPage, consolidationsQuery, createJobBody, detailParams, eventsQuery, projectParams, resultsQuery,
} from "../../packages/contracts/src/api.ts";
import type { ModelProvider } from "../../packages/ai/provider.ts";
import { InvalidCursor } from "../../packages/aws-adapters/api-queries.ts";
import type { AwsApiQueries } from "../../packages/aws-adapters/api-queries.ts";
import { JobConflict } from "../../packages/aws-adapters/jobs.ts";
import type { AwsConsolidationJobs } from "../../packages/aws-adapters/jobs.ts";
import type { AwsConsolidationRepository } from "../../packages/aws-adapters/consolidations.ts";
import type { ConsolidationResultReader } from "../../packages/core/consolidation.ts";
import { digest } from "../../packages/core/results.ts";
import { parseAgentResultEvent } from "../../packages/contracts/src/index.ts";
import type { apiAuth } from "./auth.ts";

class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const jsonSchema = (schema: z.ZodType) => z.toJSONSchema(schema, { target: "openapi-3.0", unrepresentable: "any" });
const missing = () => new HttpError(404, "not_found", "Consolidation not found");
const requestPage = (query: { limit?: string; cursor?: string }) => ({ limit: Number(query.limit ?? 20), cursor: query.cursor });
const localHost = (host: string) => ["localhost", "127.0.0.1", "[::1]"].includes(host);

export async function buildApi(deps: {
  auth: ReturnType<typeof apiAuth>;
  queries: Pick<AwsApiQueries, "results" | "consolidations" | "latestReportRun">;
  jobs: Pick<AwsConsolidationJobs, "enqueue" | "get" | "version">;
  reports: Pick<AwsConsolidationRepository, "getReportScope" | "getReport">;
  results: Pick<ConsolidationResultReader, "projectResults">;
  provider: ModelProvider;
  wake?: () => Promise<void>;
  now?: () => number;
  logger?: boolean;
  eventIntervalMs?: number;
}) {
  const app = Fastify({
    logger: deps.logger ?? true, bodyLimit: 16 * 1024, trustProxy: false, forceCloseConnections: true,
  });
  app.addHook("onRequest", async (_request, reply) => { reply.header("Cache-Control", "no-store"); });
  await app.register(swagger, {
    openapi: {
      info: { title: "Multi-agent platform", version: "1.1" },
      components: { securitySchemes: { bearer: { type: "http", scheme: "bearer" } } },
    },
  });
  // Request and response contracts are enforced by Zod at the route boundary.
  // Fastify uses these JSON Schemas to generate the OpenAPI document.
  app.setValidatorCompiler(() => () => true);
  app.setSerializerCompiler(() => value => JSON.stringify(value));
  const errorSchema = jsonSchema(apiError);
  const errors = { 400: errorSchema, 401: errorSchema, 403: errorSchema, 404: errorSchema, 409: errorSchema, 500: errorSchema, 503: errorSchema };
  const secured = deps.auth.localOnly ? {} : { security: [{ bearer: [] }] };

  function projects(request: FastifyRequest) {
    if (deps.auth.localOnly) {
      const origin = request.headers.origin;
      let permitted = localHost(request.hostname);
      if (origin) {
        try { permitted &&= localHost(new URL(origin).hostname); } catch { permitted = false; }
      }
      if (!permitted) throw new HttpError(403, "forbidden", "Development API requires a loopback host and origin");
    }
    const allowed = deps.auth.authenticate(request.headers.authorization, request.ip);
    if (!allowed) throw new HttpError(401, "unauthorized", "Valid API credentials are required");
    return allowed;
  }

  function project(request: FastifyRequest, id: string) {
    if (!projects(request).includes(id)) throw new HttpError(403, "forbidden", "Project access denied");
  }

  app.setErrorHandler((error, request, reply) => {
    let mapped: HttpError;
    if (error instanceof HttpError) mapped = error;
    else if (error instanceof InvalidCursor) mapped = new HttpError(400, "invalid_cursor", error.message);
    else if (error instanceof JobConflict) mapped = new HttpError(409, "idempotency_conflict", error.message);
    else if (error instanceof z.ZodError) mapped = new HttpError(400, "invalid_request", "Request does not match the API contract");
    else if (error instanceof Error && "statusCode" in error && typeof error.statusCode === "number" &&
      error.statusCode >= 400 && error.statusCode < 500) {
      mapped = new HttpError(error.statusCode, "invalid_request", "HTTP request rejected");
    } else {
      request.log.error({ errorType: error instanceof Error ? error.name : "unknown" }, "API operation failed");
      mapped = new HttpError(500, "internal_error", "The operation could not be completed");
    }
    if (mapped.status === 401) reply.header("WWW-Authenticate", "Bearer");
    return reply.code(mapped.status).send(apiError.parse({ error: { code: mapped.code, message: mapped.message } }));
  });
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: { code: "not_found", message: "Route not found" } }));

  function output<T>(schema: z.ZodType<T>, data: unknown): T {
    const parsed = schema.safeParse(data);
    if (!parsed.success) throw new Error("API response does not match its contract");
    return parsed.data;
  }

  app.get("/health", { schema: { response: { 200: jsonSchema(apiHealth), ...errors } } }, async () =>
    output(apiHealth, { status: "ok", provider: deps.provider.name, model: deps.provider.model ?? null }));
  app.get("/openapi.json", { schema: { hide: true } }, async () => app.swagger());

  app.get("/api/agents", { schema: {
    ...secured, querystring: jsonSchema(agentsQuery), response: { 200: jsonSchema(apiAgentsPage), ...errors },
  } }, async request => {
    const allowed = [...projects(request)].sort();
    const { cursor, limit } = requestPage(agentsQuery.parse(request.query));
    const prefix = digest(JSON.stringify(allowed));
    const seen = new Map<string, { agentId: string; agentVersion: string; lastSeenAt: string }>();
    for (const projectId of allowed) {
      for await (const raw of deps.results.projectResults(projectId)) {
        const { agentId, agentVersion, occurredAt } = parseAgentResultEvent(raw);
        const timestamp = new Date(occurredAt).toISOString();
        const prior = seen.get(agentId);
        if (!prior || prior.lastSeenAt < timestamp || (prior.lastSeenAt === timestamp && prior.agentVersion < agentVersion)) {
          seen.set(agentId, { agentId, agentVersion, lastSeenAt: timestamp });
        }
      }
    }
    let after = "";
    if (cursor) {
      if (!cursor.startsWith(prefix + ".") || !cursor.slice(prefix.length + 1)) throw new InvalidCursor("Invalid agent cursor");
      after = Buffer.from(cursor.slice(prefix.length + 1), "base64url").toString();
      if (!after || after.length > 128) throw new InvalidCursor("Invalid agent cursor");
    }
    const ids = [...seen.keys()].sort().filter(id => id > after);
    const items = ids.slice(0, limit).map(id => seen.get(id));
    return output(apiAgentsPage, {
      projects: allowed, items,
      nextCursor: ids.length > limit ? prefix + "." + Buffer.from(ids[limit - 1]).toString("base64url") : null,
    });
  });

  app.get("/api/projects/:id/results", { schema: {
    ...secured, params: jsonSchema(projectParams), querystring: jsonSchema(resultsQuery),
    response: { 200: jsonSchema(apiResultPage), ...errors },
  } }, async request => {
    const { id } = projectParams.parse(request.params);
    project(request, id);
    const query = resultsQuery.parse(request.query);
    return output(apiResultPage, await deps.queries.results(id, query.topic, {
      ...requestPage(query), from: query.from, to: query.to, eventId: query.eventId,
    }));
  });

  app.get("/api/projects/:id/consolidations", { schema: {
    ...secured, params: jsonSchema(projectParams), querystring: jsonSchema(consolidationsQuery),
    response: { 200: jsonSchema(apiConsolidationPage), ...errors },
  } }, async request => {
    const { id } = projectParams.parse(request.params);
    project(request, id);
    const query = consolidationsQuery.parse(request.query);
    return output(apiConsolidationPage, await deps.queries.consolidations(id, query.kind ?? "reports", requestPage(query)));
  });

  app.post("/api/projects/:id/consolidations", { schema: {
    ...secured, params: jsonSchema(projectParams), body: jsonSchema(createJobBody),
    response: { 202: jsonSchema(apiJobAccepted), ...errors },
  } }, async (request, reply) => {
    const { id } = projectParams.parse(request.params);
    project(request, id);
    const { topic, correlationId, force } = createJobBody.parse(request.body ?? {});
    const idempotencyKey = z.string().min(1).max(128).optional().parse(request.headers["idempotency-key"]);
    const job = await deps.jobs.enqueue({ projectId: id, topic, correlationId }, force ?? false, idempotencyKey, (deps.now ?? Date.now)());
    await deps.wake?.().catch(() => request.log.warn("Consolidation wake-up unavailable"));
    return reply.code(202).header("Location", `/api/consolidations/${job.id}`).send(output(apiJobAccepted, { job }));
  });

  app.get("/api/consolidations/:id", { schema: {
    ...secured, params: jsonSchema(detailParams), response: { 200: jsonSchema(apiJobDetail), ...errors },
  } }, async request => {
    const allowed = projects(request);
    const { id } = detailParams.parse(request.params);
    const job = id.length === 36 ? await deps.jobs.get(id) : undefined;
    if (job) {
      if (!allowed.includes(job.scope.projectId)) throw missing();
      const report = job.reportRunId ? await deps.reports.getReport(job.reportRunId, job.scope) : undefined;
      return output(apiJobDetail, { job, report: report ?? null });
    }
    const runId = id.length === 36 ? id : await deps.queries.latestReportRun(id);
    const scope = runId && await deps.reports.getReportScope(runId);
    if (!runId || !scope || !allowed.includes(scope.projectId)) throw missing();
    const report = await deps.reports.getReport(runId, scope);
    if (!report) throw missing();
    return output(apiJobDetail, { job: null, report });
  });

  const streams = new Set<AbortController>();
  app.addHook("preClose", async () => { for (const stream of streams) stream.abort(); });
  app.get("/api/events", { schema: {
    ...secured, querystring: jsonSchema(eventsQuery), description: "Project-scoped SSE invalidation stream",
    response: { 200: { content: { "text/event-stream": { schema: { type: "string" } } } }, ...errors },
  } }, async (request, reply) => {
    const { projectId } = eventsQuery.parse(request.query);
    project(request, projectId);
    if (streams.size >= 32) throw new HttpError(503, "stream_limit", "Too many event streams");
    const controller = new AbortController();
    streams.add(controller);
    reply.raw.once("close", () => controller.abort());
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no",
    });
    try {
      let version: string | undefined;
      while (!controller.signal.aborted) {
        const current = await deps.jobs.version(projectId);
        if (controller.signal.aborted) break;
        const frame = current === version ? ": heartbeat\n\n" :
          `event: invalidate\ndata: ${JSON.stringify({ projectId, version: current })}\n\n`;
        if (!reply.raw.write(frame)) break;
        version = current;
        await delay(deps.eventIntervalMs ?? 2500, undefined, { signal: controller.signal });
      }
    } catch (error) {
      if (!controller.signal.aborted) request.log.warn({ errorType: error instanceof Error ? error.name : "unknown" }, "Event stream failed");
    } finally {
      streams.delete(controller);
      reply.raw.end();
    }
  });
  return app;
}
