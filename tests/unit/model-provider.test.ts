import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, expect, it, vi } from "vitest";
import { createModelProvider } from "../../packages/ai/index.ts";
import { MockModelProvider } from "../../packages/ai/providers/mock/index.ts";
import { OllamaModelProvider } from "../../packages/ai/providers/ollama/index.ts";
import { request, report } from "../fixtures/model-request.ts";

let closeServer: (() => Promise<void>) | undefined;
afterEach(async () => {
  vi.useRealTimers();
  await closeServer?.();
  closeServer = undefined;
});

async function serve(handler: (req: IncomingMessage, res: ServerResponse) => void, timeoutMs = 3000) {
  const server = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/api/tags") res.end(JSON.stringify({ models: [{ name: "fixture:latest" }] }));
    else handler(req, res);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  closeServer = () => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test server address");
  return new OllamaModelProvider({
    baseUrl: `http://127.0.0.1:${address.port}`, model: "fixture", timeoutMs, retries: 1,
  });
}

it("selects a provider through configuration only", () => {
  expect(createModelProvider({}).name).toBe("mock");
  expect(createModelProvider({ AI_PROVIDER: "ollama" }).name).toBe("ollama");
  expect(() => createModelProvider({ AI_PROVIDER: "other" })).toThrow(/AI_PROVIDER/);
  expect(() => createModelProvider({ AI_PROVIDER: "ollama", OLLAMA_RETRIES: "5" })).toThrow();
});

it("builds deterministic simulated fixtures and records isolated inputs", async () => {
  const assertInput = vi.fn();
  const mock = new MockModelProvider({ assertInput });
  const first = await mock.generate(request);
  expect(await mock.generate(request)).toEqual(first);
  expect(first).toMatchObject({ provider: "mock", simulated: true });
  expect(first.report.findings[0].sourceEventIds).toEqual([request.sources[0].eventId]);
  expect(assertInput).toHaveBeenCalledWith(request);
  expect(mock.invocations).toEqual([request, request]);
  expect((await new MockModelProvider({ response: report }).generate(request)).report).toEqual(report);
});

it("delays mock responses using deterministic fake timers", async () => {
  vi.useFakeTimers();
  const done = vi.fn();
  const pending = new MockModelProvider({ delayMs: 100 }).generate(request).then(done);
  await vi.advanceTimersByTimeAsync(99);
  expect(done).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  await pending;
  expect(done).toHaveBeenCalledOnce();
});

it.each([
  ["invalid_json", "invalid_output"], ["timeout", "timeout"],
  ["provider_error", "provider_error"], ["rate_limit", "rate_limit"],
] as const)("simulates %s", async (failure, code) => {
  await expect(new MockModelProvider({ failure }).generate(request)).rejects.toMatchObject({ code });
});

const foreignReport = {
  ...report,
  findings: [{ text: "Foreign", sourceEventIds: ["00000000-0000-4000-8000-000000000002"] }],
};
const reply = (response: ServerResponse, value: unknown) => response.end(JSON.stringify({
  done: true, model: "fixture:latest", message: { content: JSON.stringify(value) },
}));

it("sends structured chat without tools and retries a transient rate limit", async () => {
  let calls = 0;
  let body = "";
  const provider = await serve((req, res) => {
    calls++;
    if (calls === 1) { res.writeHead(429); res.end(); return; }
    req.setEncoding("utf8");
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => { reply(res, report); });
  });
  await expect(provider.generate(request)).resolves.toEqual({
    provider: "ollama", model: "fixture:latest", simulated: false, report,
  });
  expect(calls).toBe(2);
  const payload = JSON.parse(body);
  expect(payload).toMatchObject({ model: "fixture", stream: false, format: { type: "object" } });
  expect(payload.tools).toBeUndefined();
  expect(JSON.parse(payload.messages[1].content)).toEqual(request);
});

it("enforces the same reference membership rule on both providers", async () => {
  const provider = await serve((_req, res) => reply(res, foreignReport));
  for (const instance of [provider, new MockModelProvider({ response: foreignReport })]) {
    await expect(instance.generate(request)).rejects.toMatchObject({ code: "invalid_output" });
  }
});

it("rejects invalid reports without retrying", async () => {
  let calls = 0;
  const provider = await serve((_req, res) => { calls++; reply(res, { bogus: true }); });
  await expect(provider.generate(request)).rejects.toMatchObject({ code: "invalid_output" });
  expect(calls).toBe(1);
});

it("rejects oversized input before contacting the model", async () => {
  let calls = 0;
  const provider = await serve((_req, res) => { calls++; reply(res, report); });
  const large = { ...request, sources: [{ ...request.sources[0], content: "界".repeat(4000) }] };
  await expect(provider.generate(large)).rejects.toThrow(/generation budget/);
  expect(calls).toBe(0);
});

it("rejects oversized HTTP responses without retrying", async () => {
  let calls = 0;
  const provider = await serve((_req, res) => {
    calls++;
    res.end(JSON.stringify("x".repeat(1_048_576)));
  });
  await expect(provider.generate(request)).rejects.toMatchObject({ code: "invalid_output" });
  expect(calls).toBe(1);
});

it("times out stalled chat bodies and exhausts bounded retries", async () => {
  let calls = 0;
  const provider = await serve((_req, res) => {
    calls++;
    res.write("{");
  }, 250);
  await expect(provider.generate(request)).rejects.toMatchObject({ code: "timeout" });
  expect(calls).toBe(2);
});

it("reports a missing model before sending chat", async () => {
  const provider = await serve((_req, res) => res.end());
  // Test the missing case through a separate endpoint path.
  const server = createServer((_req, res) => res.end('{"models":[]}'));
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No test server address");
    const missing = createModelProvider({
      AI_PROVIDER: "ollama", OLLAMA_BASE_URL: `http://127.0.0.1:${address.port}`, OLLAMA_MODEL: "missing",
    });
    await expect(missing.generate(request)).rejects.toMatchObject({
      code: "missing_model", message: expect.stringContaining("ollama pull missing"),
    });
    await expect(provider.checkAvailability()).resolves.toBeUndefined();
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
