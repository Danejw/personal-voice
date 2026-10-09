import { useCallback, useEffect, useMemo, useState } from "react";
import { AssistantInsightsPanel } from "@/insights/AssistantInsightsPanel";
import type { InsightCandidate, InsightCandidateKind, InsightUsageFacts } from "@/insights/insights";
import {
  formatHour,
  INSIGHTS_KEEP_RECENT,
  REFRESH_DAYS,
  REFRESH_MIN_DICTATIONS_AFTER_WEEK,
  REFRESH_NEW_DICTATIONS,
} from "@/insights/insights";
import type {
  InsightsKnowledgeInput,
  InsightsSnapshot,
  InsightsStatus,
  InsightsStore,
} from "@/insights/InsightsStore";
import { DeviceSplitBar, HorizontalShareBars } from "@/usage/HorizontalShareBars";
import { mergeUsageDays, sumCounters, targetAppUsage } from "@/usage/analytics";
import type { UsageSnapshot } from "@/usage/usageEvents";

type InsightsTab = "voice" | "assistant" | "suggestions" | "compaction";

interface InsightsPanelProps {
  active: boolean;
  userId: string | null;
  assistantInsightsRefreshToken: number;
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

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const CANDIDATE_ORDER: readonly InsightCandidateKind[] = ["dictionary", "snippet", "transform", "memory"];
const CANDIDATE_LABELS: Record<InsightCandidateKind, string> = {
  dictionary: "Dictionary",
  snippet: "Snippets",
  transform: "Transforms",
  memory: "Memories",
};

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

export function InsightsToolbar({ store, snapshot, onRefreshAssistant }: Pick<InsightsPanelProps, "store" | "snapshot"> & {onRefreshAssistant: () => void}) {
  return (
    <div className="page-header-actions">
      <p role="status">{statusLabel(snapshot.status)}</p>
      {snapshot.status !== "signed-out" && (
        <button
          type="button"
          className="secondary"
          disabled={snapshot.status === "loading" || snapshot.status === "analyzing" || snapshot.status === "compacting"}
          onClick={() => { void store.reload(); onRefreshAssistant(); }}
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

function distributionTotal(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0);
}

function percent(count: number, total: number): number {
  return total > 0 ? Math.round((count / total) * 100) : 0;
}

function hasPersistedDistributions(facts: InsightUsageFacts): boolean {
  return distributionTotal(facts.dayCounts) > 0
    || distributionTotal(facts.hourCounts) > 0
    || facts.deviceCounts.length > 0;
}

function weekdayItems(facts: InsightUsageFacts) {
  const total = distributionTotal(facts.dayCounts);
  return WEEKDAYS.map((label, index) => ({
    id: label,
    label,
    share: percent(facts.dayCounts[index] ?? 0, total),
    detail: (facts.dayCounts[index] ?? 0).toLocaleString(),
  })).filter((item) => item.share > 0);
}

function timeItems(facts: InsightUsageFacts) {
  const blocks = Array.from({ length: 8 }, (_, index) => {
    const start = index * 3;
    const count = (facts.hourCounts[start] ?? 0)
      + (facts.hourCounts[start + 1] ?? 0)
      + (facts.hourCounts[start + 2] ?? 0);
    return { start, count };
  });
  const total = blocks.reduce((sum, block) => sum + block.count, 0);
  return blocks.map(({ start, count }) => ({
    id: String(start),
    label: `${formatHour(start)}–${formatHour((start + 3) % 24)}`,
    share: percent(count, total),
    detail: count.toLocaleString(),
  })).filter((item) => item.share > 0);
}

function deviceItems(facts: InsightUsageFacts, devices: readonly { id: string; name: string }[]) {
  const total = facts.deviceCounts.reduce((sum, item) => sum + item.count, 0);
  return facts.deviceCounts.map((item) => ({
    id: item.deviceId,
    label: deviceName(item.deviceId, devices),
    share: percent(item.count, total),
    count: item.count,
  })).filter((item) => item.count > 0);
}

function phraseItems(phrases: readonly { text: string; count: number }[]) {
  const max = Math.max(1, ...phrases.map((phrase) => phrase.count));
  return phrases.map((phrase) => ({
    id: phrase.text,
    label: `“${phrase.text}”`,
    share: Math.round((phrase.count / max) * 100),
    detail: `${phrase.count} uses`,
  }));
}

function candidateCount(candidates: readonly InsightCandidate[], kind: InsightCandidateKind): number {
  return candidates.filter((candidate) => candidate.kind === kind).length;
}

function daysSince(iso: string): number {
  const elapsed = Date.now() - new Date(iso).getTime();
  return Number.isFinite(elapsed) ? Math.max(0, Math.floor(elapsed / 86_400_000)) : 0;
}

export function InsightsPanel({
  active,
  userId,
  assistantInsightsRefreshToken,
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
  const [assistantPending, setAssistantPending] = useState<{userId:string;count:number}|null>(null);
  const reportAssistantPending = useCallback((forUser:string,count:number)=>{
    setAssistantPending(previous=>previous?.userId===forUser&&previous.count===count?previous:{userId:forUser,count});
  },[]);
  const assistantCount = assistantPending?.userId===userId?assistantPending.count:0;
  const latest = snapshot.runs[0] ?? null;
  const pending = snapshot.candidates.filter((candidate) => candidate.status === "pending");
  const accepted = snapshot.candidates.filter((candidate) => candidate.status === "accepted").length;
  const dismissed = snapshot.candidates.filter((candidate) => candidate.status === "dismissed").length;

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3_500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const apps = useMemo(() => {
    const remote = usage.remote.filter((row) => row.epoch === usage.epoch);
    const merged = mergeUsageDays(remote, usage.days, currentDeviceId ?? "");
    return targetAppUsage(sumCounters(merged));
  }, [usage.remote, usage.days, usage.epoch, currentDeviceId]);

  const visualFacts = latest && hasPersistedDistributions(latest.usageFacts)
    ? latest.usageFacts
    : snapshot.currentUsageFacts;
  const weekdays = weekdayItems(visualFacts);
  const timeBlocks = timeItems(visualFacts);
  const deviceDistribution = deviceItems(visualFacts, devices);
  const phrases = latest ? phraseItems(latest.catchphrases) : [];
  const topApp = apps[0] ?? null;

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
  const protectedCount = Math.min(INSIGHTS_KEEP_RECENT, snapshot.dictationCount);
  const readyCount = Math.min(snapshot.readiness.eligibleForAnalysis, Math.max(0, snapshot.dictationCount - protectedCount));
  const analyzedStored = Math.max(0, snapshot.dictationCount - protectedCount - readyCount);
  const newProgress = Math.min(100, Math.round((snapshot.readiness.newSinceLastRun / REFRESH_NEW_DICTATIONS) * 100));
  const elapsedDays = latest ? daysSince(latest.createdAt) : 0;
  const dayProgress = Math.min(100, Math.round((elapsedDays / REFRESH_DAYS) * 100));

  return (
    <div className="insights-page analytics">
      {tab !== "assistant" && !cloudHistoryEnabled && (
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
          ["assistant", "Your Assistant"],
          ["suggestions", `Suggestions${pending.length+assistantCount ? ` (${pending.length+assistantCount})` : ""}`],
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
      {notice && <div className="insights-notice" role="status">{notice}</div>}
      {snapshot.progress && <div className="insights-progress-note" role="status">{snapshot.progress}</div>}

      {(tab==="assistant"||tab==="suggestions") && <AssistantInsightsPanel
        active={active} userId={userId} refreshToken={assistantInsightsRefreshToken}
        view={tab==="assistant"?"profile":"suggestions"} onPendingChange={reportAssistantPending}
        onOpenSuggestions={()=>setTab("suggestions")}
      />}

      {tab === "voice" && (
        <div className="insights-stack">
          <section className="insights-voice-hero">
            <div className="insights-heading-row">
              <div>
                <p className="insights-eyebrow">Your voice profile</p>
                <p className="insights-hero-meta">
                  {latest
                    ? `Based on ${latest.dictationCount.toLocaleString()} dictations · ${latest.wordCount.toLocaleString()} words · ${latest.activeDays} active days`
                    : "A free-form profile appears after enough synced dictations accumulate."}
                </p>
              </div>
              <button
                type="button"
                className="secondary insights-refresh"
                disabled={!canAnalyze}
                onClick={() => void analyze()}
              >
                {latest ? "Refresh insights" : "Analyze my voice"}
              </button>
            </div>
            {latest ? (
              <p className="voice-profile">{latest.voiceProfile}</p>
            ) : (
              <p className="placeholder">
                {snapshot.dictationCount.toLocaleString()} synced dictations available. {snapshot.readiness.reason}
              </p>
            )}
            {!snapshot.readiness.ready && latest && snapshot.status !== "analyzing" && (
              <p className="insights-next-refresh">{snapshot.readiness.reason}</p>
            )}
          </section>

          {latest && (
            <>
              <div className="stat-row insights-stat-row" aria-label="Voice usage facts">
                <div className="stat-cell">
                  <p className="stat-value">{latest.usageFacts.peakDay ?? visualFacts.peakDay ?? "–"}</p>
                  <p className="stat-label">Peak day</p>
                </div>
                <div className="stat-cell">
                  <p className="stat-value">
                    {visualFacts.peakHourStart === null
                      ? "–"
                      : `${formatHour(visualFacts.peakHourStart)}–${formatHour(visualFacts.peakHourEnd)}`}
                  </p>
                  <p className="stat-label">Peak time</p>
                </div>
                <div className="stat-cell">
                  <p className="stat-value">{deviceName(visualFacts.peakDeviceId, devices)}</p>
                  <p className="stat-label">
                    {visualFacts.peakDeviceShare === null ? "Peak device" : `${visualFacts.peakDeviceShare}% during peak time`}
                  </p>
                </div>
                <div className="stat-cell">
                  <p className="stat-value">{latest.usageFacts.averageWords || visualFacts.averageWords}</p>
                  <p className="stat-label">Average words / dictation</p>
                </div>
                <div className="stat-cell">
                  <p className="stat-value">{topApp?.label ?? "–"}</p>
                  <p className="stat-label">{topApp ? `${topApp.share}% of recorded app pastes` : "Top application"}</p>
                </div>
              </div>

              <div className="analytics-visual-row insights-visual-row">
                <HorizontalShareBars
                  headingId="insights-days-heading"
                  title="When you speak"
                  items={weekdays}
                  empty="More synced history is needed for a weekday distribution."
                />
                <div className="analytics-split-stack">
                  <DeviceSplitBar devices={deviceDistribution} headingId="insights-device-heading" />
                  <HorizontalShareBars
                    headingId="insights-apps-heading"
                    title="Applications"
                    items={apps.slice(0, 5).map((app) => ({
                      id: app.id,
                      label: app.label,
                      share: app.share,
                      detail: app.count.toLocaleString(),
                    }))}
                    empty="No target applications have been recorded yet."
                  />
                </div>
              </div>

              <div className="analytics-visual-row insights-visual-row">
                <HorizontalShareBars
                  headingId="insights-time-heading"
                  title="Time of day"
                  items={timeBlocks}
                  empty="More synced history is needed for a time distribution."
                />
                <HorizontalShareBars
                  headingId="insights-phrases-heading"
                  title="Recurring phrases"
                  items={phrases}
                  empty="No recurring phrase cleared the evidence threshold in this run."
                />
              </div>
            </>
          )}
        </div>
      )}

      {tab === "suggestions" && (
        <div className="insights-stack">
          <section className="insights-suggestion-summary">
            <div className="insights-heading-row">
              <div>
                <p className="insights-eyebrow">Improve Personal Voice</p>
                <h2>{pending.length+assistantCount} new suggestion{pending.length+assistantCount === 1 ? "" : "s"}</h2>
                <p className="hint">{pending.length} from Dictation · {assistantCount} from Assistant. Review each suggestion before saving.</p>
              </div>
              {(accepted > 0 || dismissed > 0) && (
                <p className="hint">{accepted} accepted · {dismissed} dismissed</p>
              )}
            </div>
            {!!pending.length && <div className="stat-row insights-suggestion-stats">
              {CANDIDATE_ORDER.map((kind) => (
                <div key={kind} className="stat-cell">
                  <p className="stat-value">{candidateCount(pending, kind)}</p>
                  <p className="stat-label">{CANDIDATE_LABELS[kind]}</p>
                </div>
              ))}
            </div>}
          </section>

          {pending.length ? CANDIDATE_ORDER.map((kind) => {
            const group = pending.filter((candidate) => candidate.kind === kind);
            if (!group.length) return null;
            const maxEvidence = Math.max(1, ...group.map((candidate) => candidate.evidenceCount));
            return (
              <section key={kind} className="insight-candidate-group" aria-labelledby={`candidate-${kind}-heading`}>
                <div className="insight-group-heading">
                  <h2 id={`candidate-${kind}-heading`}>{CANDIDATE_LABELS[kind]}</h2>
                  <span>{group.length}</span>
                </div>
                <div className="insight-candidate-grid">
                  {group.map((candidate) => (
                    <article key={candidate.id} className="insight-candidate-card">
                      <div className="insights-heading-row">
                        <div>
                          <p className="candidate-kind">{candidate.kind}</p>
                          <h3>{candidate.title}</h3>
                        </div>
                        <span className={candidate.confidence === "high" ? "candidate-confidence is-high" : "candidate-confidence"}>
                          {candidate.confidence}
                        </span>
                      </div>
                      <div className="candidate-evidence">
                        <div className="candidate-evidence-head">
                          <span>{candidate.evidenceCount} dictations</span>
                          <span>evidence</span>
                        </div>
                        <div className="candidate-evidence-rail" aria-hidden="true">
                          <span style={{ width: `${Math.max(10, Math.round((candidate.evidenceCount / maxEvidence) * 100))}%` }} />
                        </div>
                      </div>
                      <p className="candidate-reason">{candidate.reason}</p>
                      <details className="candidate-details">
                        <summary>Suggested content</summary>
                        <p>{payloadLine(candidate)}</p>
                      </details>
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
                    </article>
                  ))}
                </div>
              </section>
            );
          }) : !assistantCount ? (
            <div className="insights-empty-state">
              <p className="insights-empty-value">0</p>
              <h2>No new suggestions</h2>
              <p className="hint">Analyze new dictation or Assistant activity when its next refresh becomes ready.</p>
            </div>
          )}
        </div>
      )}

      {tab === "compaction" && (
        <div className="insights-stack">
          <section className="insights-compaction-overview">
            <div>
              <p className="insights-eyebrow">Dictation storage</p>
              <h2>{snapshot.dictationCount.toLocaleString()} stored</h2>
              <p className="hint">Raw dictations stay recoverable until you explicitly compact a saved analysis.</p>
            </div>
            <div className="compaction-segment-bar" role="img" aria-label={`${analyzedStored} analyzed, ${readyCount} ready to analyze, ${protectedCount} protected recent dictations`}>
              {analyzedStored > 0 && <span className="is-analyzed" style={{ flexGrow: analyzedStored }} />}
              {readyCount > 0 && <span className="is-ready" style={{ flexGrow: readyCount }} />}
              {protectedCount > 0 && <span className="is-protected" style={{ flexGrow: protectedCount }} />}
            </div>
            <div className="compaction-legend">
              <span><i className="is-analyzed" />Analyzed <strong>{analyzedStored.toLocaleString()}</strong></span>
              <span><i className="is-ready" />Ready <strong>{readyCount.toLocaleString()}</strong></span>
              <span><i className="is-protected" />Protected <strong>{protectedCount.toLocaleString()}</strong></span>
            </div>
          </section>

          <div className="analytics-visual-row insights-visual-row">
            <section className="insights-progress-card">
              <div className="insights-heading-row">
                <div>
                  <p className="insights-eyebrow">Next Insights refresh</p>
                  <h2>{snapshot.readiness.newSinceLastRun.toLocaleString()} / {REFRESH_NEW_DICTATIONS}</h2>
                </div>
                <span className="progress-percent">{newProgress}%</span>
              </div>
              <div className="insights-progress-rail" aria-hidden="true">
                <span style={{ width: `${newProgress}%` }} />
              </div>
              <p className="hint">Power-user path: refresh after {REFRESH_NEW_DICTATIONS} new dictations.</p>
            </section>

            <section className="insights-progress-card">
              <div className="insights-heading-row">
                <div>
                  <p className="insights-eyebrow">Time-based refresh</p>
                  <h2>{Math.min(elapsedDays, REFRESH_DAYS)} / {REFRESH_DAYS} days</h2>
                </div>
                <span className="progress-percent">{dayProgress}%</span>
              </div>
              <div className="insights-progress-rail is-secondary" aria-hidden="true">
                <span style={{ width: `${dayProgress}%` }} />
              </div>
              <p className="hint">Available after {REFRESH_DAYS} days when at least {REFRESH_MIN_DICTATIONS_AFTER_WEEK} new dictations exist.</p>
            </section>
          </div>

          {latest && (
            <>
              <section className="insights-latest-run">
                <div className="insights-heading-row">
                  <div>
                    <p className="insights-eyebrow">Latest analysis</p>
                    <h2>{new Date(latest.sourceFromCreatedAt).toLocaleDateString()} → {new Date(latest.sourceThroughCreatedAt).toLocaleDateString()}</h2>
                  </div>
                  {latest.compactedAt && <span className="candidate-confidence is-high">compacted</span>}
                </div>
                <div className="stat-row">
                  <div className="stat-cell">
                    <p className="stat-value">{latest.dictationCount.toLocaleString()}</p>
                    <p className="stat-label">Dictations analyzed</p>
                  </div>
                  <div className="stat-cell">
                    <p className="stat-value">{latest.wordCount.toLocaleString()}</p>
                    <p className="stat-label">Words preserved in insight</p>
                  </div>
                  <div className="stat-cell">
                    <p className="stat-value">{latest.activeDays}</p>
                    <p className="stat-label">Active days</p>
                  </div>
                  <div className="stat-cell">
                    <p className="stat-value">{snapshot.candidates.filter((candidate) => candidate.runId === latest.id).length}</p>
                    <p className="stat-label">Suggestions found</p>
                  </div>
                </div>
              </section>

              <section className="insights-danger-zone">
                <div>
                  <p className="insights-eyebrow">Compaction</p>
                  <h2>{latest.compactedAt ? "This analysis is compacted" : "Ready when you are"}</h2>
                  <p className="hint">
                    {latest.compactedAt
                      ? `${latest.compactedCount.toLocaleString()} raw rows were removed. Your profile, usage facts, and suggestion history remain.`
                      : `Delete analyzed raw dictations from this saved run while always preserving the newest ${INSIGHTS_KEEP_RECENT}.`}
                  </p>
                </div>
                {!latest.compactedAt && (confirmCompact ? (
                  <div className="compact-confirm">
                    <p>This is the destructive step. The saved Insights run remains, but eligible raw Dictation rows will be deleted.</p>
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
                ))}
              </section>
            </>
          )}
        </div>
      )}
    </div>
  );
}
