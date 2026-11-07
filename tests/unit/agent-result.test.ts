import { describe, expect, it } from "vitest";
import { parseAgentResultEvent } from "../../packages/contracts/src/index.ts";

const v1 = {
  schemaVersion: 1,
  eventId: "00000000-0000-4000-8000-000000000001",
  eventType: "agent.result",
  agentId: "research",
  agentVersion: "1.0.0",
  projectId: "demo",
  correlationId: "sample-1",
  topic: "market",
  resultId: "research-1",
  revision: 1,
  occurredAt: "2026-11-07T00:00:00Z",
  status: "completed",
  summary: "A fixture result",
  contentType: "application/json",
  data: { findings: ["fixture"] },
  sources: [{ title: "Fixture" }],
  metadata: {},
};

describe("agent result v1 wire compatibility", () => {
  it("reads the original fixture and tolerates additive envelope fields", () => {
    expect(parseAgentResultEvent(JSON.parse(JSON.stringify(v1)))).toEqual(v1);
    expect(parseAgentResultEvent({ ...v1, optionalFutureField: true })).toEqual(v1);
  });

  it.each(["completed", "partial", "failed"])("supports %s artifact results", (status) => {
    expect(
      parseAgentResultEvent({
        ...v1,
        data: undefined,
        artifactKey: "demo/example.json",
        status,
      }),
    ).toMatchObject({ status, artifactKey: "demo/example.json" });
  });

  it("requires exactly one payload", () => {
    expect(() => parseAgentResultEvent({ ...v1, artifactKey: "duplicate" })).toThrow();
    expect(() => parseAgentResultEvent({ ...v1, data: undefined })).toThrow();
  });

  it("rejects unsupported versions and invalid identity, revision, and timestamp", () => {
    expect(() => parseAgentResultEvent({ ...v1, schemaVersion: 2 })).toThrow(/Unsupported/);
    for (const invalid of [{ eventId: "bad" }, { revision: 0 }, { occurredAt: "bad" }]) {
      expect(() => parseAgentResultEvent({ ...v1, ...invalid })).toThrow();
    }
  });
});
