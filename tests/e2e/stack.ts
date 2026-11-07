import { execFile, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { bootstrap, localAws } from "../../infrastructure/bootstrap/resources.ts";

const exec = promisify(execFile);
const node = process.execPath;
const prefix = `dashboard-${randomUUID().slice(0, 12)}`;
const token = "local-e2e-token-0000000000000000000000";
const [vitePort = "5197", apiPort = "3097"] = process.argv.slice(2);
const apiUrl = `http://127.0.0.1:${apiPort}`;
const env = {
  ...process.env, LOCAL_RESOURCE_PREFIX: prefix, API_HOST: "127.0.0.1", API_PORT: apiPort,
  API_AUTH_MODE: process.env.DASHBOARD_PREVIEW === "1" ? "development" : "token",
  API_DEV_PROJECTS: "demo,other", API_AUTH_CONFIG: JSON.stringify([{ token, projects: ["demo", "other"] }]),
  AGENT_PROJECT_ID: "demo", AGENT_TOPIC: "sample", AGENT_CORRELATION_ID: "demo-run",
  AGENT_EVENT_ID: undefined, AGENT_RESULT_ID: undefined, AGENT_OCCURRED_AT: undefined, AGENT_REVISION: undefined,
  AI_PROVIDER: "mock", CONSOLIDATION_DEBOUNCE_MS: "500", CONSOLIDATION_LEASE_MS: "60000",
  CONSOLIDATION_EXPECTED_AGENTS: "research,analysis,review", DASHBOARD_API_URL: apiUrl,
};
const children: ChildProcess[] = [];
const controller = new AbortController();
function stop() {
  controller.abort();
  for (const child of children) if (child.exitCode === null) child.kill("SIGTERM");
}
function start(file: string, args: string[] = []) {
  const child = spawn(node, [file, ...args], { env, stdio: "inherit" });
  children.push(child);
  child.once("exit", () => {
    if (!controller.signal.aborted) { process.exitCode = 1; stop(); }
  });
  return child;
}

for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, stop);
try {
  await bootstrap(localAws(prefix));
  await Promise.all(["research", "analysis"].map(agent =>
    exec(node, [`agents/${agent}-agent/run.ts`], { env }),
  ));
  start("apps/api/run.ts");
  start("apps/result-consumer/run.ts");
  start("apps/consolidation-worker/run.ts");
  let ready = false;
  for (let attempt = 0; attempt < 40 && !controller.signal.aborted; attempt++) {
    try {
      if ((await fetch(apiUrl + "/health", { signal: AbortSignal.timeout(500) })).ok) { ready = true; break; }
    } catch {}
    await delay(250);
  }
  if (!ready) throw new Error("Dashboard API did not start");
  start("apps/dashboard/node_modules/vite/bin/vite.js", ["apps/dashboard", "--port", vitePort]);
} catch (error) {
  stop();
  throw error;
}
