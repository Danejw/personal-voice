import { useEffect, useState } from "react";
import { AssistantAnalyticsPanel } from "@/usage/AssistantAnalyticsPanel";
import type { AssistantUsageStore } from "@/usage/AssistantUsageStore";
import { fetchUsageDays } from "@/services/usageService";
import type { DictionaryTerm } from "@/sync/personalData";
import { buildAnalytics, mergeUsageDays, panelRanges } from "@/usage/analytics";
import type { AnalyticsModel } from "@/usage/analytics";
import type { UsageSnapshot } from "@/usage/usageEvents";
import type { RemoteUsageDay } from "@/usage/usageEvents";
import { DeviceSplitBar, HorizontalShareBars, PlatformSplitBar } from "@/usage/HorizontalShareBars";
import { UsageHeatmap } from "@/usage/UsageHeatmap";

interface AnalyticsPanelProps {
  active: boolean;
  signedIn: boolean;
  deviceId: string | null;
  devices: readonly { id: string; name: string; platform: string }[];
  dictionary: readonly DictionaryTerm[];
  usage: UsageSnapshot;
  userId: string | null;
  assistantUsage: AssistantUsageStore;
  assistantUsageEnabled: boolean;
  onClearAnalytics(): Promise<void>;
}

function formatWpm(value: number | null): string {
  return value === null ? "–" : String(Math.round(value));
}

/** Bar length relative to the most-used term, so the top term fills the row. */
function termShare(uses: number, terms: readonly { uses: number }[]): number {
  const max = Math.max(1, ...terms.map((term) => term.uses));
  return Math.round((uses / max) * 100);
}

/** Compact personal dashboard. Numbers come from merged usage days, not a second observer. */
export function AnalyticsPanel({ active, signedIn, deviceId, devices, dictionary, usage, userId, assistantUsage, assistantUsageEnabled, onClearAnalytics }: AnalyticsPanelProps) {
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);
  const [mode, setMode] = useState<"dictation" | "assistant">("dictation");
  const [ranges, setRanges] = useState<{ month: RemoteUsageDay[]; recent: RemoteUsageDay[]; weeks: RemoteUsageDay[] } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!active || !signedIn || mode !== "dictation") return;
    let cancelled = false;
    const windows = panelRanges(new Date());
    void Promise.all([
      fetchUsageDays(windows.month),
      fetchUsageDays(windows.recent),
      fetchUsageDays(windows.weeks),
    ]).then(
      ([month, recent, weeks]) => {
        if (!cancelled) {
          setRanges({ month, recent, weeks });
          setProblem(null);
        }
      },
      (reason: unknown) => {
        if (!cancelled) setProblem(reason instanceof Error ? reason.message : "Usage could not be loaded.");
      },
    );
    return () => { cancelled = true; };
  }, [active, signedIn, mode, usage.days, usage.remote, usage.epoch]);

  if (!signedIn) return <p className="hint">Sign in to see analytics across your devices.</p>;
  const selector = (
    <div className="insights-tabs" role="tablist" aria-label="Analytics source">
      <button type="button" role="tab" aria-selected={mode === "dictation"} className={mode === "dictation" ? "insights-tab is-active" : "insights-tab"} onClick={() => setMode("dictation")}>Dictation</button>
      <button type="button" role="tab" aria-selected={mode === "assistant"} className={mode === "assistant" ? "insights-tab is-active" : "insights-tab"} onClick={() => setMode("assistant")}>Assistant</button>
    </div>
  );
  const clearControl = (
    <div>
      {clearError && <p className="error" role="alert">{clearError}</p>}
      {!confirmClear ? (
        <button type="button" className="secondary" onClick={() => setConfirmClear(true)}>Clear Analytics</button>
      ) : (
        <div role="group" aria-label="Confirm deleting Analytics">
          <p className="hint">Delete all synced Dictation and Assistant usage analytics across devices? This cannot be undone. Saved conversations and notes are not deleted.</p>
          <button type="button" disabled={clearing} onClick={() => {
            setClearing(true);
            void onClearAnalytics().then(() => {
              setConfirmClear(false);
              setClearError(null);
            }, (error: unknown) => {
              setClearError(error instanceof Error ? error.message : "Could not clear Analytics.");
            }).finally(() => setClearing(false));
          }}> {clearing ? "Clearing…" : "Confirm clear"} </button>
          <button type="button" className="secondary" disabled={clearing} onClick={() => setConfirmClear(false)}>Cancel</button>
        </div>
      )}
    </div>
  );
  if (mode === "assistant") return <div className="analytics">{selector}{clearControl}<AssistantAnalyticsPanel
    active={active} userId={userId} epoch={usage.epoch} enabled={assistantUsageEnabled}
    devices={devices} store={assistantUsage}
  /></div>;

  const id = deviceId ?? "";
  const windows = panelRanges(new Date());
  const remoteNow = usage.remote.filter((row) => row.epoch === usage.epoch);
  const model: AnalyticsModel | null = ranges
    ? buildAnalytics({
      lifetime: mergeUsageDays(remoteNow, usage.days, id),
      month: mergeUsageDays(ranges.month.filter((row) => row.epoch === usage.epoch), usage.days.filter((day) => day.day >= windows.month.from), id),
      recent: mergeUsageDays(ranges.recent.filter((row) => row.epoch === usage.epoch), usage.days.filter((day) => day.day >= windows.recent.from), id),
      weeks: mergeUsageDays(ranges.weeks.filter((row) => row.epoch === usage.epoch), usage.days.filter((day) => day.day >= windows.weeks.from), id),
      devices,
      dictionary,
      today: panelRanges(new Date()).today,
    })
    : null;

  return (
    <div className="analytics">
      {selector}
      {clearControl}
      {problem && <p className="error" role="alert">{problem}</p>}
      {usage.error && <p className="error" role="alert">{usage.error}</p>}
      {!model && <p className="hint">Loading analytics…</p>}
      {model && model.monthDictations === 0 && model.activeDays === 0 && (
        <p className="hint">Dictate a few times and this page will start to fill in.</p>
      )}
      {model && (
        <>
          <div className="stat-row">
            <div className="stat-cell">
              <p className="stat-value">{model.lifetimeWords.toLocaleString()}</p>
              <p className="stat-label">All-time words</p>
            </div>
            <div className="stat-cell">
              <p className="stat-value">{model.monthWords.toLocaleString()}</p>
              <p className="stat-label">Words this month</p>
            </div>
            <div className="stat-cell">
              <p className="stat-value">{model.monthDictations.toLocaleString()}</p>
              <p className="stat-label">Dictations</p>
            </div>
            <div className="stat-cell">
              <p className="stat-value">{formatWpm(model.monthWpm)}</p>
              <p className="stat-label">Words / minute</p>
            </div>
            <div className="stat-cell">
              <p className="stat-value">{model.mostUsedDevice ? `${model.mostUsedDevice.share}%` : "–"}</p>
              <p className="stat-label">{model.mostUsedDevice?.label ?? "Top device"}</p>
            </div>
          </div>

          <UsageHeatmap
            days={model.heatDays}
            streak={model.streak}
            longestStreak={model.longestStreak}
            today={windows.today}
          />

          <div className="analytics-visual-row">
            <HorizontalShareBars
              headingId="apps-heading"
              title="Apps"
              items={model.apps.slice(0, 6).map((app) => ({
                id: app.id,
                label: app.label,
                share: app.share,
                detail: app.words.toLocaleString(),
              }))}
            />
            <div className="analytics-split-stack">
              <PlatformSplitBar platforms={model.platforms} />
              <DeviceSplitBar devices={model.devices} />
            </div>
          </div>

          <div className="analytics-visual-row">
            <HorizontalShareBars
              headingId="where-heading"
              title="Where it goes"
              items={model.destinations.filter((item) => item.count > 0).map((item) => ({
                id: item.id,
                label: item.label,
                share: item.share,
                detail: String(item.count),
              }))}
            />
            <HorizontalShareBars
              headingId="start-heading"
              title="How you start"
              items={model.triggers.filter((item) => item.count > 0).map((item) => ({
                id: item.id,
                label: item.label,
                share: item.share,
                detail: String(item.count),
              }))}
            />
          </div>

          <HorizontalShareBars
            headingId="terms-heading"
            title="Dictionary"
            items={model.terms.slice(0, 6).map((term) => ({
              id: term.term,
              label: term.term,
              share: termShare(term.uses, model.terms),
              detail: String(term.uses),
            }))}
          />
        </>
      )}
    </div>
  );
}
