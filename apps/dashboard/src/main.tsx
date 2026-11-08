import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { createApi } from "./api.ts";
import type { AgentResultEvent, ConsolidationReport, DashboardApi, ReportSummary } from "./api.ts";
import { errorMessage, useLive, usePages, useRequest } from "./state.ts";
import "./styles.css";
import { urgentEmailDigest } from "../../../packages/contracts/src/urgent-email.ts";
import { machineReviewDigest } from "../../../packages/contracts/src/machine-review.ts";

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const date = (value: string | number) => dateFormat.format(new Date(value));
const shortId = (id: string) => id.slice(0, 8);
const issueLabels = {
  stale: "Stale result",
  partial: "Partial result",
  failed: "Failed result",
  missing_publisher: "Missing publisher",
};
const tabNames = ["Results", "Reports", "Jobs", "Publishers"] as const;
type Tab = (typeof tabNames)[number];

function Mark() {
  return (
    <span className="mark" aria-hidden="true">
      <svg viewBox="0 0 32 32" fill="none">
        <path
          d="M8 24V8h10a5 5 0 0 1 0 10H8m10 0 6 6"
          stroke="currentColor"
          strokeWidth="3.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="25" cy="8" r="2" fill="currentColor" />
      </svg>
    </span>
  );
}

function Badge({ value }: { value: string }) {
  return <span className={`badge badge-${value.toLowerCase().replaceAll(" ", "-")}`}>{value}</span>;
}
function Notice({ children }: { children: ReactNode }) {
  return (
    <p className="notice" role="alert">
      {children}
    </p>
  );
}
function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}
function More({
  next,
  pending,
  more,
}: {
  next?: string | null;
  pending: boolean;
  more: () => void;
}) {
  return next ? (
    <button type="button" className="secondary more" onClick={more} disabled={pending}>
      Load more
    </button>
  ) : null;
}
function ProviderLabel({ provider, model }: { provider: string; model?: string | null }) {
  return (
    <span className="provider-label">
      <Badge
        value={
          provider === "mock"
            ? "Mock · simulated"
            : provider === "ollama"
              ? "Ollama · local"
              : provider
        }
      />
      {model && <code>{model}</code>}
    </span>
  );
}

function App() {
  const [token, setToken] = useState("");
  const [credentialVersion, setCredentialVersion] = useState(0);
  const [draft, setDraft] = useState("");
  const [project, setProject] = useState("");
  const [version, setVersion] = useState(0);
  const api = useMemo(() => createApi(token), [token]);
  const refreshAgents = useCallback(() => setVersion((previous) => previous + 1), []);
  const loadAgents = useCallback((signal: AbortSignal) => api.agents(signal), [api]);
  const health = useRequest(api.health, version);
  const grants = useRequest(loadAgents, version);
  const projects = grants.error ? [] : (grants.value?.projects ?? []);
  const active = projects.includes(project) ? project : projects[0];
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <Mark />
          <div>
            <strong>Relay</strong>
            <span>AGENT WORKSPACE</span>
          </div>
        </div>
        <div className="workspace">
          <p className="eyebrow">Workspace</p>
          <label htmlFor="project">Project</label>
          <select
            id="project"
            value={active ?? ""}
            onChange={(event) => setProject(event.target.value)}
            disabled={!projects.length}
          >
            {!projects.length && <option value="">No project available</option>}
            {projects.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </div>
        <div className="sidebar-bottom">
          <p className="eyebrow">Inference engine</p>
          {health.value ? (
            <ProviderLabel provider={health.value.provider} model={health.value.model} />
          ) : (
            <span className="muted">Unavailable</span>
          )}
          <details className="credentials" open={grants.error ? true : undefined}>
            <summary>API access</summary>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                setToken(draft.trim());
                setCredentialVersion((current) => current + 1);
                setProject("");
                refreshAgents();
              }}
            >
              <label htmlFor="token">Bearer token</label>
              <input
                id="token"
                type="password"
                autoComplete="off"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
              />
              <button type="submit" className="secondary">
                Apply credentials
              </button>
              <small>Leave blank for local development access.</small>
            </form>
          </details>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <span>
            Workspace <b>/</b> Agent operations
          </span>
          <span className="local-label">LOCAL-FIRST</span>
        </header>
        {active ? (
          <Project key={`${credentialVersion}:${active}`} api={api} project={active} />
        ) : (
          <div className="content">
            <p className="eyebrow">Agent operations</p>
            <h1>Consolidation workspace</h1>
            {grants.error ? (
              <Notice>{grants.error} Configure API access to continue.</Notice>
            ) : (
              <Empty>
                {grants.pending
                  ? "Connecting to the API…"
                  : "No projects are available to these credentials."}
              </Empty>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function Project({ api, project }: { api: DashboardApi; project: string }) {
  const [tab, setTab] = useState<Tab>("Results");
  const [topic, setTopic] = useState("");
  const [version, setVersion] = useState(0);
  const [selected, setSelected] = useState<string>();
  const [result, setResult] = useState<AgentResultEvent>();
  const refresh = useCallback(() => setVersion((current) => current + 1), []);
  const live = useLive(api, project, refresh);
  const jobs = usePages(
    useCallback((signal, cursor) => api.jobs(project, signal, cursor), [api, project]),
    version,
  );
  const reports = usePages(
    useCallback((signal, cursor) => api.reports(project, signal, cursor), [api, project]),
    version,
  );
  const agents = usePages(
    useCallback((signal, cursor) => api.agents(signal, cursor), [api]),
    version,
  );
  const topicFilter = topic.trim();
  const reportItems = (reports.page?.items ?? []).filter(
    (item) => !topicFilter || item.scope.topic === topicFilter,
  );
  const jobItems = (jobs.page?.items ?? []).filter(
    (item) => !topicFilter || item.scope.topic === topicFilter,
  );
  const openRun = (id: string) => {
    setResult(undefined);
    setSelected(id);
  };
  return (
    <div className="content">
      <div className="page-heading">
        <div>
          <p className="eyebrow">
            <span className="accent-dot" /> PROJECT / {project}
          </p>
          <h1>Consolidation workspace</h1>
          <p className="subtitle">
            Review agent evidence, monitor jobs, and trace each report to its sources.
          </p>
        </div>
        <div className="live-status" role="status">
          <span className={`signal ${live}`} />
          {live === "live"
            ? "Live updates"
            : live === "polling"
              ? "Polling fallback"
              : "Connecting updates"}
          <button
            className="icon-button"
            type="button"
            title="Refresh workspace"
            aria-label="Refresh workspace"
            onClick={refresh}
          >
            ↻
          </button>
        </div>
      </div>
      <Manual
        api={api}
        project={project}
        topic={topic}
        onQueued={(id) => {
          openRun(id);
          setTab("Jobs");
          refresh();
        }}
      />
      <div className="views">
        <nav aria-label="Workspace views" className="tabs">
          {tabNames.map((name) => (
            <button
              type="button"
              key={name}
              aria-pressed={tab === name}
              onClick={() => setTab(name)}
            >
              {name}
            </button>
          ))}
        </nav>
        <label className="topic-filter">
          Topic filter
          <input
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            placeholder="All topics"
            maxLength={256}
          />
        </label>
      </div>
      <div className={selected || result ? "columns split" : "columns"}>
        <section className="panel listing" aria-label={tab}>
          {tab === "Results" && (
            <Results
              key={topic.trim()}
              api={api}
              project={project}
              topic={topic.trim()}
              version={version}
              onSelect={(item) => {
                setSelected(undefined);
                setResult(item);
              }}
            />
          )}
          {tab === "Reports" && (
            <>
              <PanelTitle
                title="Report history"
                description="Completed revisions, most recent first."
              />
              {reports.error && <Notice>{reports.error}</Notice>}
              {!reportItems.length && (
                <Empty>
                  {reports.pending
                    ? "Loading reports…"
                    : "No reports in the loaded pages match this view."}
                </Empty>
              )}
              <ul className="rows">
                {reportItems.map((report) => (
                  <ReportRow key={report.runId} report={report} open={openRun} />
                ))}
              </ul>
              <More next={reports.page?.nextCursor} pending={reports.pending} more={reports.more} />
            </>
          )}
          {tab === "Jobs" && (
            <>
              <PanelTitle
                title="Consolidation jobs"
                description="Follow automatic and manual requests through completion."
              />
              {jobs.error && <Notice>{jobs.error}</Notice>}
              {!jobItems.length && (
                <Empty>
                  {jobs.pending ? "Loading jobs…" : "No jobs in the loaded pages match this view."}
                </Empty>
              )}
              <ul className="rows">
                {jobItems.map((job) => (
                  <li key={job.id} className="row">
                    <div>
                      <button className="text-button" onClick={() => openRun(job.id)}>
                        {job.trigger === "manual" ? "Manual" : "Automatic"} job{" "}
                        <code>{shortId(job.id)}</code>
                      </button>
                      <p>
                        {job.scope.topic ?? "All topics"} · {job.attempts} attempt
                        {job.attempts === 1 ? "" : "s"} · {date(job.updatedAt)}
                      </p>
                    </div>
                    <Badge value={job.status} />
                  </li>
                ))}
              </ul>
              <More next={jobs.page?.nextCursor} pending={jobs.pending} more={jobs.more} />
            </>
          )}
          {tab === "Publishers" && (
            <>
              <PanelTitle
                title="Observed publishers"
                description="Agents seen across your authorized projects."
              />
              {agents.error && <Notice>{agents.error}</Notice>}
              {!agents.page?.items.length && (
                <Empty>
                  {agents.pending ? "Loading publishers…" : "No publishers observed yet."}
                </Empty>
              )}
              <ul className="rows">
                {agents.page?.items.map((agent) => (
                  <li key={agent.agentId} className="row">
                    <div>
                      <strong>{agent.agentId}</strong>
                      <p>Last seen {date(agent.lastSeenAt)}</p>
                    </div>
                    <Badge value={`v${agent.agentVersion}`} />
                  </li>
                ))}
              </ul>
              <More next={agents.page?.nextCursor} pending={agents.pending} more={agents.more} />
            </>
          )}
        </section>
        {selected && (
          <RunDetail
            key={selected}
            api={api}
            id={selected}
            version={version}
            close={() => setSelected(undefined)}
          />
        )}
        {result && (
          <section className="panel details">
            <DetailHeading title="Agent result" close={() => setResult(undefined)} />
            <Evidence event={result} />
          </section>
        )}
      </div>
    </div>
  );
}

function PanelTitle({ title, description }: { title: string; description: string }) {
  return (
    <div className="panel-title">
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  );
}
function DetailHeading({ title, close }: { title: string; close: () => void }) {
  return (
    <div className="detail-heading">
      <h2>{title}</h2>
      <button type="button" className="icon-button" onClick={close} aria-label="Close details">
        ×
      </button>
    </div>
  );
}

function Manual({
  api,
  project,
  topic,
  onQueued,
}: {
  api: DashboardApi;
  project: string;
  topic: string;
  onQueued: (id: string) => void;
}) {
  const [correlationId, setCorrelationId] = useState("");
  const [force, setForce] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const request = useRef<{ fingerprint: string; key: string }>(undefined);
  const active = useRef<AbortController>(undefined);
  useEffect(() => () => active.current?.abort(), []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (active.current) return;
    const body = {
      topic: topic.trim() || undefined,
      correlationId: correlationId.trim() || undefined,
      force,
    };
    const fingerprint = JSON.stringify(body);
    if (request.current?.fingerprint !== fingerprint)
      request.current = { fingerprint, key: crypto.randomUUID() };
    const controller = new AbortController();
    active.current = controller;
    setPending(true);
    setError(undefined);
    try {
      const { job } = await api.create(project, body, request.current.key, controller.signal);
      if (controller.signal.aborted) return;
      request.current = undefined;
      onQueued(job.id);
    } catch (reason) {
      if (!controller.signal.aborted) setError(errorMessage(reason));
    } finally {
      if (!controller.signal.aborted) {
        active.current = undefined;
        setPending(false);
      }
    }
  }
  return (
    <section className="manual panel" aria-label="Manual consolidation">
      <div>
        <p className="eyebrow">On-demand run</p>
        <h2>Manual consolidation</h2>
        <p>
          Scope: {topic.trim() || "all topics"} in <strong>{project}</strong>
        </p>
      </div>
      <form onSubmit={submit}>
        <label>
          <span>
            Correlation ID <span className="muted">(optional)</span>
          </span>
          <input
            value={correlationId}
            maxLength={128}
            onChange={(event) => setCorrelationId(event.target.value)}
            placeholder="e.g. demo-run"
          />
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={force}
            onChange={(event) => setForce(event.target.checked)}
          />{" "}
          Force new revision
        </label>
        <button className="primary" type="submit" disabled={pending}>
          {pending ? "Queuing…" : "Run consolidation"} <span aria-hidden="true">↗</span>
        </button>
        {error && <Notice>{error}</Notice>}
      </form>
    </section>
  );
}

function Results({
  api,
  project,
  topic,
  version,
  onSelect,
}: {
  api: DashboardApi;
  project: string;
  topic: string;
  version: number;
  onSelect: (event: AgentResultEvent) => void;
}) {
  const results = usePages(
    useCallback(
      (signal, cursor) => api.results(project, signal, topic, cursor),
      [api, project, topic],
    ),
    version,
  );
  return (
    <>
      <PanelTitle
        title="Agent results"
        description="Persisted evidence ordered by observation time."
      />
      {results.error && <Notice>{results.error}</Notice>}
      {!results.page?.items.length && (
        <Empty>
          {results.pending ? "Loading results…" : "No results match this project and topic."}
        </Empty>
      )}
      <ul className="rows">
        {results.page?.items.map((event) => (
          <li key={event.eventId} className="row">
            <div>
              <button type="button" className="text-button" onClick={() => onSelect(event)}>
                {event.agentId} <code>rev {event.revision}</code>
              </button>
              <p>{event.summary}</p>
              <small>
                {event.topic} · {date(event.occurredAt)}
              </small>
            </div>
            <Badge value={event.status} />
          </li>
        ))}
      </ul>
      <More next={results.page?.nextCursor} pending={results.pending} more={results.more} />
    </>
  );
}

function ReportRow({ report, open }: { report: ReportSummary; open: (id: string) => void }) {
  return (
    <li className="row">
      <div>
        <button type="button" className="text-button" onClick={() => open(report.runId)}>
          {report.scope.topic ?? "All topics"} · Revision {report.revision}
        </button>
        <p>
          {date(report.generatedAt)} · <code>{shortId(report.inputFingerprint)}</code>
        </p>
      </div>
      <ProviderLabel provider={report.provider} model={report.model} />
    </li>
  );
}

function RunDetail({
  api,
  id,
  version,
  close,
}: {
  api: DashboardApi;
  id: string;
  version: number;
  close: () => void;
}) {
  const detail = useRequest(
    useCallback((signal) => api.detail(id, signal), [api, id]),
    version,
  );
  const job = detail.value?.job;
  const report = detail.value?.report;
  return (
    <section className="panel details" aria-label="Consolidation details">
      <DetailHeading
        title={report ? `Report revision ${report.revision}` : "Job progress"}
        close={close}
      />
      {detail.error && <Notice>{detail.error}</Notice>}
      {!detail.value && detail.pending && <Empty>Loading details…</Empty>}
      {job && (
        <div className="job-detail">
          <Badge value={job.status} />
          <span>
            {job.trigger} · {job.attempts} attempt{job.attempts === 1 ? "" : "s"}
          </span>
          {job.error && <p className="muted">Last error: {job.error.replaceAll("_", " ")}</p>}
          {job.status === "retry" && <p className="muted">Next retry {date(job.dueAt)}</p>}
        </div>
      )}
      {report && <Report api={api} report={report} />}
    </section>
  );
}

function Report({ api, report }: { api: DashboardApi; report: ConsolidationReport }) {
  const [source, setSource] = useState<string>();
  const { generation, sourceEventIds, scope } = report;
  const findings = generation.report;
  function evidenceLinks(ids: string[]) {
    return ids.map((id, index) => (
      <button
        type="button"
        className="source-button"
        key={`${id}:${index}`}
        onClick={() => setSource(id)}
      >
        Source {shortId(id)}
      </button>
    ));
  }
  return (
    <div className="report">
      <ProviderLabel provider={generation.provider} model={generation.model} />
      {generation.simulated && (
        <p className="simulation">Simulated report generated from deterministic mock fixtures.</p>
      )}
      <p className="muted">
        {scope.topic ?? "All topics"} · {date(report.generatedAt)}
      </p>
      {scope.correlationId && <p className="muted">Correlation {scope.correlationId}</p>}
      <h3>Executive summary</h3>
      <p>{findings.executiveSummary}</p>
      <h3>Findings</h3>
      {findings.findings.length ? (
        <ul className="findings">
          {findings.findings.map((item, index) => (
            <li key={index}>
              <p>{item.text}</p>
              <div className="sources">{evidenceLinks(item.sourceEventIds)}</div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No findings reported.</p>
      )}
      <h3>Contradictions</h3>
      {findings.conflicts.length ? (
        <ul className="findings">
          {findings.conflicts.map((item, index) => (
            <li key={index}>
              <p>{item.text}</p>
              <div className="sources">{evidenceLinks(item.sourceEventIds)}</div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No contradictions reported.</p>
      )}
      <h3>Missing information</h3>
      {findings.missingInformation.length ? (
        <ul>
          {findings.missingInformation.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="muted">No gaps reported by the provider.</p>
      )}
      {report.issues.length > 0 && (
        <ul className="issues">
          {report.issues.map((issue, index) => (
            <li key={index}>
              {issueLabels[issue.kind]} · {issue.agentId}{" "}
              {issue.eventId && evidenceLinks([issue.eventId])}
            </li>
          ))}
        </ul>
      )}
      <h3>Recommendations</h3>
      {findings.recommendations.length ? (
        <ul>
          {findings.recommendations.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="muted">No recommendations reported.</p>
      )}
      <h3>Source traceability</h3>
      <div className="sources">{evidenceLinks(sourceEventIds)}</div>
      {source && <Source key={source} api={api} project={scope.projectId} id={source} />}
      <details className="fingerprint">
        <summary>Input fingerprint</summary>
        <code>{report.inputFingerprint}</code>
      </details>
    </div>
  );
}

function Source({ api, project, id }: { api: DashboardApi; project: string; id: string }) {
  const result = useRequest(
    useCallback((signal) => api.evidence(project, id, signal), [api, project, id]),
  );
  return (
    <div className="source-detail" aria-live="polite">
      {result.error ? (
        <Notice>{result.error}</Notice>
      ) : result.value ? (
        <Evidence event={result.value} />
      ) : (
        <Empty>
          {result.pending ? "Loading source evidence…" : "The referenced event is unavailable."}
        </Empty>
      )}
    </div>
  );
}

function Evidence({ event }: { event: AgentResultEvent }) {
  const digest =
    event.agentId === "gmail-urgency" ? urgentEmailDigest.safeParse(event.data) : undefined;
  const machine =
    event.agentId === "machine-review" ? machineReviewDigest.safeParse(event.data) : undefined;
  return (
    <div className="evidence">
      <div className="evidence-header">
        <strong>
          {event.agentId} · revision {event.revision}
        </strong>
        <Badge value={event.status} />
      </div>
      <p className="muted">
        {event.topic} · {date(event.occurredAt)}
      </p>
      <p>{event.summary}</p>
      <dl>
        <dt>Event ID</dt>
        <dd>
          <code>{event.eventId}</code>
        </dd>
        <dt>Correlation</dt>
        <dd>{event.correlationId}</dd>
      </dl>
      {event.artifactKey ? (
        <p className="muted">
          Stored artifact <code>{event.artifactKey}</code>
        </p>
      ) : digest?.success ? (
        <div>
          <h3>Urgent email</h3>
          {digest.data.moreUnread && (
            <p className="muted">Some unread messages were outside this scan.</p>
          )}
          {digest.data.messages.length === 0 && (
            <p>No urgency signals found in the messages checked.</p>
          )}
          <ul className="findings">
            {digest.data.messages.map((message, index) => (
              <li key={index}>
                <strong>{message.subject}</strong>
                <p className="muted">
                  {message.sender} · {date(message.receivedAt)}
                </p>
                <p>{message.reason}</p>
                {message.link && (
                  <a
                    className="source-button"
                    href={message.link}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {message.link.startsWith("message:") ? "Open in Apple Mail" : "Open in Gmail"}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : machine?.success ? (
        <div>
          <h3>Machine review</h3>
          <p>Security flags are clues for review. They do not confirm malware.</p>
          <p className="muted">
            {machine.data.inspected} inspected · {machine.data.skipped} skipped
          </p>
          {machine.data.truncated && (
            <p className="muted">
              The scan reached a limit. Some entries or findings are outside this report.
            </p>
          )}
          {!machine.data.findings.length && <p>No matching signals in the scanned entries.</p>}
          <ul className="findings">
            {machine.data.findings.map((finding, index) => (
              <li key={index}>
                <strong>
                  {finding.category === "security" ? "Security review" : "Cleanup review"}
                </strong>
                <p>
                  <bdi>
                    <code>{finding.path.replace(/[\u202a-\u202e\u2066-\u2069]/g, "�")}</code>
                  </bdi>
                </p>
                <p>{finding.reason}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <pre>{JSON.stringify(event.data, null, 2)}</pre>
      )}
      {event.sources.length > 0 && (
        <ul>
          {event.sources.map((item, index) => (
            <li key={index}>
              {item.title}
              {item.uri && <small className="muted"> {item.uri}</small>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
