import { useMemo, useState } from "react";
import type { InsightCandidate } from "@/insights/insights";
import { formatHour, INSIGHTS_KEEP_RECENT } from "@/insights/insights";
import type {
  InsightsKnowledgeInput,
  InsightsSnapshot,
  InsightsStatus,
  InsightsStore,
} from "@/insights/InsightsStore";
import { mergeUsageDays, sumCounters, targetAppUsage } from "@/usage/analytics";
import type { UsageSnapshot } from "@/usage/usageEvents";

type InsightsTab = "voice" | "suggestions" | "compaction";

interface InsightsPanelProps {
  store: InsightsStore;
  snapshot: InsightsSnapshot;
  knowledge: InsightsKnowledgeInput;
  cloudHistoryEnabled: boolean;
  onEnableCloudHistory(): void;
  devices: readonly { id: string; name: string; platform: string }[];
  usage: UsageSnapshot;
  currentDeviceId: string | null;
  onAccept(candidate: InsightCandidate): Promise<void>;
}

function statusLabel(status: InsightsStatus): string {
  switch (status) {
    case "signed-out": return "Sign in";
    case "loading": return "Loading…";
    case "ready": return "Ready";
    case "analyzing": return "Analyzing…";
    case "compacting": return "Compacting…";
    case "error": return "Needs attention";
    default: {
      const unhandled: never = status;
      throw new Error(`Unhandled Insights status: ${String(unhandled)}`);
    }
  }
}

export function InsightsToolbar({ store, snapshot }: Pick<InsightsPanelProps, "store" | "snapshot">) {
  return (
    <div className="page-header-actions">
      <p role="status">{statusLabel(snapshot.status)}</p>
      {snapshot.status !== "signed-out" && (
        <button
          type="button"
          className="secondary"
          disabled={snapshot.status === "loading" || snapshot.status === "analyzing" || snapshot.status === "compacting"}
          onClick={() => void store.reload()}
        >
          Refresh
        </button>
      )}
    </div>
  );
}

function deviceName(id: string | null, devices: readonly { id: string; name: string }[]): string {
  if (!id) return "–";
  return devices.find((device) => device.id === id)?.name ?? "Removed device";
}

function candidateAction(candidate: InsightCandidate): string {
  switch (candidate.kind) {
    case "dictionary": return "Add to Dictionary";
    case "snippet": return "Create Snippet";
    case "transform": return "Create Transform";
    case "memory": return "Remember";
    default: {
      const unhandled: never = candidate.kind;
      return unhandled;
    }
  }
}

function payloadLine(candidate: InsightCandidate): string {
  const value = (key: string) => typeof candidate.payload[key] === "string" ? String(candidate.payload[key]).trim() : "";
  switch (candidate.kind) {
    case "dictionary": return value("term");
    case "snippet": return `“${value("trigger")}” → ${value("content")}`;
    case "transform": return `${value("name")}: ${value("instruction")}`;
    case "memory": return `${value("key")}: ${value("value")}`;
    default: {
      const unhandled: never = candidate.kind;
      return unhandled;
    }
  }
}

export function InsightsPanel({
  store,
  snapshot,
  knowledge,
  cloudHistoryEnabled,
  onEnableCloudHistory,
  devices,
  usage,
  currentDeviceId,
  onAccept,
}: InsightsPanelProps) {
  const [tab, setTab] = useState<InsightsTab>("voice");
  const [busyCandidate, setBusyCandidate] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmCompact, setConfirmCompact] = useState(false);
  const latest = snapshot.runs[0] ?? null;
  const pending = snapshot.candidates.filter((candidate) => candidate.status === "pending");
  const accepted = snapshot.candidates.filter((candidate) => candidate.status === "accepted").length;
  const dismissed = snapshot.candidates.filter((candidate) => candidate.status === "dismissed").length;

  const topApp = useMemo(() => {
    const remote = usage.remote.filter((row) => row.epoch === usage.epoch);
    const merged = mergeUsageDays(remote, usage.days, currentDeviceId ?? "");
    return targetAppUsage(sumCounters(merged))[0] ?? null;
  }, [usage.remote, usage.days, usage.epoch, currentDeviceId]);

  async function analyze() {
    setProblem(null);
    setNotice(null);
    try {
      await store.analyze(knowledge);
      setNotice("Insights updated.");
      setTab("voice");
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function accept(candidate: InsightCandidate) {
    setBusyCandidate(candidate.id);
    setProblem(null);
    setNotice(null);
    try {
      await onAccept(candidate);
      await store.setCandidateStatus(candidate.id, "accepted");
      setNotice(`${candidate.title} added.`);
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusyCandidate(null);
    }
  }

  async function dismiss(candidate: InsightCandidate) {
    setBusyCandidate(candidate.id);
    setProblem(null);
    try {
      await store.setCandidateStatus(candidate.id, "dismissed");
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusyCandidate(null);
    }
  }

  async function compact() {
    if (!latest) return;
    setProblem(null);
    setNotice(null);
    try {
      const removed = await store.compact(latest.id);
      setConfirmCompact(false);
      setNotice(`${removed.toLocaleString()} analyzed dictations compacted. The newest ${INSIGHTS_KEEP_RECENT} were preserved.`);
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : String(reason));
    }
  }

  const canAnalyze = snapshot.status === "ready" && snapshot.readiness.ready;

  return (
    <div className="insights-page">
      {!cloudHistoryEnabled && (
        <div className="insights-callout">
          <div>
            <p className="insights-callout-title">Cloud dictation history is off</p>
            <p className="hint">Insights can analyze rows already saved, but new dictations will not accumulate for future profiles.</p>
          </div>
          <button type="button" className="secondary" onClick={onEnableCloudHistory}>Enable history</button>
        </div>
      )}

      <div className="insights-tabs" role="tablist" aria-label="Insights">
        {([
          ["voice", "Your Voice"],
          ["suggestions", `Suggestions${pending.length ? ` (${pending.length})` : ""}`],
          ["compaction", "Compaction"],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? "insights-tab is-active" : "insights-tab"}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {(problem ?? snapshot.error) && <p className="error" role="alert">{problem ?? snapshot.error}</p>}
      {notice && <p role="status">{notice}</p>}
      {snapshot.progress && <p className="hint" role="status">{snapshot.progress}</p>}

      {tab === "voice" && (
        <div className="insights-stack">
          <section className="insights-card">
            <div className="insights-heading-row">
              <div>
                <h3>Your voice profile</h3>
                <p className="hint">
                  {latest
                    ? `Updated from ${latest.dictationCount.toLocaleString()} analyzed dictations.`
                    : "A free-form profile appears after enough synced dictations accumulate."}
                </p>
              </div>
              <button
                type="button"
                className="record"
                disabled={!canAnalyze}
                onClick={() => void analyze()}
              >
                {latest ? "Refresh insights" : "Analyze my voice"}
              </button>
            </div>
            {!snapshot.readiness.ready && snapshot.status !== "analyzing" && (
              <p className="hint">{snapshot.readiness.reason}</p>
            )}
            {latest ? (
              <p className="voice-profile">{latest.voiceProfile}</p>
            ) : (
              <p className="placeholder">
                {snapshot.dictationCount.toLocaleString()} synced dictations available. {snapshot.readiness.reason}
              </p>
            )}
          </section>

          {latest && (
            <>
              <section className="insights-stat-grid" aria-label="Voice usage facts">
                <div className="insights-stat">
                  <p className="stat-value">{latest.usageFacts.peakDay ?? "–"}</p>
                  <p className="stat-label">Peak day</p>
                </div>
                <div className="insights-stat">
                  <p className="stat-value">
                    {latest.usageFacts.peakHourStart === null
                      ? "–"
                      : `${formatHour(latest.usageFacts.peakHourStart)}–${formatHour(latest.usageFacts.peakHourEnd)}`}
                  </p>
                  <p className="stat-label">Peak time</p>
                </div>
                <div className="insights-stat">
                  <p className="stat-value">{deviceName(latest.usageFacts.peakDeviceId, devices)}</p>
                  <p className="stat-label">
                    {latest.usageFacts.peakDeviceShare === null ? "Peak device" : `${latest.usageFacts.peakDeviceShare}% of analyzed dictations`}
                  </p>
                </div>
                <div className="insights-stat">
                  <p className="stat-value">{latest.usageFacts.averageWords}</p>
                  <p className="stat-label">Average words / dictation</p>
                </div>
                <div className="insights-stat">
                  <p className="stat-value">{topApp?.label ?? "–"}</p>
                  <p className="stat-label">{topApp ? `${topApp.share}% of recorded app pastes` : "Top application"}</p>
                </div>
              </section>

              <section className="insights-card">
                <h3>Recurring phrases</h3>
                {latest.catchphrases.length ? (
                  <div className="phrase-cloud">
                    {latest.catchphrases.map((phrase) => (
                      <span key={phrase.text} className="phrase-pill">“{phrase.text}” · {phrase.count}</span>
                    ))}
                  </div>
                ) : (
                  <p className="placeholder">No recurring phrase cleared the evidence threshold in this run.</p>
                )}
              </section>
            </>
          )}
        </div>
      )}

      {tab === "suggestions" && (
        <div className="insights-stack">
          <section className="insights-card">
            <div className="insights-heading-row">
              <div>
                <h3>Improve Personal Voice</h3>
                <p className="hint">Suggestions are filtered against what already exists and against suggestions you have already seen.</p>
              </div>
              {(accepted > 0 || dismissed > 0) && (
                <p className="hint">{accepted} accepted · {dismissed} dismissed</p>
              )}
            </div>
          </section>

          {pending.length ? (
            <div className="insight-candidate-list">
              {pending.map((candidate) => (
                <section key={candidate.id} className="insights-card insight-candidate">
                  <div className="insights-heading-row">
                    <div>
                      <p className="candidate-kind">{candidate.kind}</p>
                      <h3>{candidate.title}</h3>
                    </div>
                    <span className="candidate-confidence">{candidate.confidence} confidence</span>
                  </div>
                  <p className="candidate-payload">{payloadLine(candidate)}</p>
                  <p className="hint">{candidate.reason} · Evidence in {candidate.evidenceCount} dictations</p>
                  <div className="candidate-actions">
                    <button
                      type="button"
                      className="record"
                      disabled={busyCandidate !== null}
                      onClick={() => void accept(candidate)}
                    >
                      {busyCandidate === candidate.id ? "Saving…" : candidateAction(candidate)}
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      disabled={busyCandidate !== null}
                      onClick={() => void dismiss(candidate)}
                    >
                      Dismiss
                    </button>
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <p className="placeholder">No new suggestions. Analyze more dictations when the next refresh becomes ready.</p>
          )}
        </div>
      )}

      {tab === "compaction" && (
        <div className="insights-stack">
          <section className="insights-card">
            <h3>Analysis lifecycle</h3>
            <div className="compaction-stats">
              <p><strong>{snapshot.dictationCount.toLocaleString()}</strong> synced dictations currently stored</p>
              <p><strong>{snapshot.readiness.newSinceLastRun.toLocaleString()}</strong> newer than the last analysis watermark</p>
              <p><strong>{snapshot.readiness.eligibleForAnalysis.toLocaleString()}</strong> currently old enough to analyze</p>
              <p><strong>{INSIGHTS_KEEP_RECENT}</strong> newest dictations are always protected</p>
            </div>
            <p className="hint">{snapshot.readiness.reason}</p>
          </section>

          {latest && (
            <section className="insights-card">
              <h3>Latest analyzed batch</h3>
              <p className="candidate-payload">
                {latest.dictationCount.toLocaleString()} dictations · {latest.wordCount.toLocaleString()} words · {latest.activeDays} active days
              </p>
              <p className="hint">
                {new Date(latest.sourceFromCreatedAt).toLocaleString()} through {new Date(latest.sourceThroughCreatedAt).toLocaleString()}
              </p>
              {latest.compactedAt ? (
                <p className="hint">
                  Compacted {latest.compactedCount.toLocaleString()} rows on {new Date(latest.compactedAt).toLocaleString()}.
                </p>
              ) : confirmCompact ? (
                <div className="compact-confirm">
                  <p>
                    This deletes raw dictation rows covered by the saved analysis while still preserving the newest {INSIGHTS_KEEP_RECENT} dictations.
                    The voice profile and suggestions remain.
                  </p>
                  <div className="candidate-actions">
                    <button type="button" className="record" disabled={snapshot.status === "compacting"} onClick={() => void compact()}>
                      {snapshot.status === "compacting" ? "Compacting…" : "Confirm compaction"}
                    </button>
                    <button type="button" className="secondary" disabled={snapshot.status === "compacting"} onClick={() => setConfirmCompact(false)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="secondary"
                  disabled={snapshot.status !== "ready"}
                  onClick={() => setConfirmCompact(true)}
                >
                  Compact analyzed dictations
                </button>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
