import { useEffect, useState } from "react";
import { fetchUsageDays } from "@/services/usageService";
import type { DictionaryTerm } from "@/sync/personalData";
import { buildAnalytics, mergeUsageDays, panelRanges } from "@/usage/analytics";
import type { AnalyticsModel } from "@/usage/analytics";
import type { UsageSnapshot } from "@/usage/usageEvents";
import type { RemoteUsageDay } from "@/usage/usageEvents";

interface AnalyticsPanelProps {
  active: boolean;
  signedIn: boolean;
  deviceId: string | null;
  devices: readonly { id: string; name: string }[];
  dictionary: readonly DictionaryTerm[];
  usage: UsageSnapshot;
}

function formatWpm(value: number | null): string {
  return value === null ? "–" : String(Math.round(value));
}

function formatCompletion(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** Compact personal dashboard. Numbers come from merged usage days, not a second observer. */
export function AnalyticsPanel({ active, signedIn, deviceId, devices, dictionary, usage }: AnalyticsPanelProps) {
  const [ranges, setRanges] = useState<{ month: RemoteUsageDay[]; recent: RemoteUsageDay[]; weeks: RemoteUsageDay[] } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!active || !signedIn) return;
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
  }, [active, signedIn, usage.days, usage.remote, usage.epoch]);

  if (!signedIn) return <p className="hint">Sign in to see analytics across your devices.</p>;

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
  const maxBar = Math.max(1, ...(model?.bars.map((bar) => bar.words) ?? [1]));

  return (
    <div className="analytics">
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
              <p className="stat-value">{model.monthWords.toLocaleString()}</p>
              <p className="stat-label">Words dictated · this month</p>
            </div>
            <div className="stat-cell">
              <p className="stat-value">{model.monthDictations.toLocaleString()}</p>
              <p className="stat-label">Dictations · this month</p>
            </div>
            <div className="stat-cell">
              <p className="stat-value">{model.mostUsedDevice ? `${model.mostUsedDevice.label} ${model.mostUsedDevice.share}%` : "–"}</p>
              <p className="stat-label">Most used device</p>
            </div>
          </div>

          <section aria-labelledby="trend-heading">
            <h2 id="trend-heading">Usage over time</h2>
            <ul className="bars">
              {model.bars.map((bar) => (
                <li key={bar.day} className="bar-row">
                  <span>{bar.day.slice(5)}</span>
                  <span className="bar-track"><span className="bar-fill" style={{ width: `${Math.round((bar.words / maxBar) * 100)}%` }} /></span>
                  <span>{bar.words}</span>
                </li>
              ))}
            </ul>
          </section>

          <div className="analytics-grid">
            <section aria-labelledby="wpm-heading">
              <h2 id="wpm-heading">Words per minute</h2>
              <p>Today {formatWpm(model.todayWpm)} · Week {formatWpm(model.weekWpm)} · Month {formatWpm(model.monthWpm)}</p>
              {model.fastestWpm !== null && model.slowestWpm !== null && (
                <p className="hint">Fastest {formatWpm(model.fastestWpm)} · Slowest {formatWpm(model.slowestWpm)}</p>
              )}
              <ul className="bars">
                {model.bars.map((bar) => (
                  <li key={`wpm-${bar.day}`} className="bar-row">
                    <span>{bar.day.slice(5)}</span>
                    <span className="bar-track"><span className="bar-fill" style={{ width: `${bar.wpm === null ? 0 : Math.min(100, Math.round(bar.wpm))}%` }} /></span>
                    <span>{formatWpm(bar.wpm)}</span>
                  </li>
                ))}
              </ul>
            </section>
            <section aria-labelledby="completion-heading">
              <h2 id="completion-heading">Completion time</h2>
              {model.monthCompletionMs > 0 ? (
                <p>
                  {formatCompletion(model.monthCompletionMs)} this month
                  {model.monthDictations > 0 ? ` · average ${formatCompletion(Math.round(model.monthCompletionMs / model.monthDictations))}` : ""}
                  {" · press to delivery"}
                </p>
              ) : (
                <p className="hint">No completion time yet.</p>
              )}
              <p className="hint">{model.streak} day streak · {model.activeDays} active days</p>
              {usage.legacy && (
                <p className="hint">Earlier on this device: {usage.legacy.dictationCompleted} completed, not included above.</p>
              )}
            </section>
            <section aria-labelledby="terms-heading">
              <h2 id="terms-heading">Dictionary</h2>
              {model.terms.length === 0 && <p className="hint">No dictionary uses yet.</p>}
              <ul className="metric-list">
                {model.terms.slice(0, 8).map((term) => (
                  <li key={term.term}><span>{term.term}</span><span>{term.uses} uses</span></li>
                ))}
              </ul>
              {model.terms.some((term) => term.lastDay !== null && term.lastDay >= windows.recent.from) && (
                <p className="hint">
                  Used recently: {model.terms.filter((term) => term.lastDay !== null && term.lastDay >= windows.recent.from).slice(0, 6).map((term) => term.term).join(", ")}
                </p>
              )}
              {model.neverUsed.length > 0 && <p className="hint">Never used: {model.neverUsed.slice(0, 6).join(", ")}</p>}
            </section>
            <section aria-labelledby="devices-usage-heading">
              <h2 id="devices-usage-heading">Devices</h2>
              {model.devices.length === 0 && <p className="hint">No device usage yet.</p>}
              <ul className="metric-list">
                {model.devices.map((device) => (
                  <li key={device.id}>
                    <span>{device.label}</span>
                    <span>{device.share}% · {device.words.toLocaleString()} words</span>
                  </li>
                ))}
              </ul>
            </section>
            <section aria-labelledby="apps-heading">
              <h2 id="apps-heading">Apps</h2>
              {model.apps.length === 0 && <p className="hint">Paste a transcript into another app and it will show up here.</p>}
              <ul className="metric-list">
                {model.apps.slice(0, 8).map((app) => (
                  <li key={app.id}>
                    <span>{app.label}</span>
                    <span>{app.share}% · {app.words.toLocaleString()} words</span>
                  </li>
                ))}
              </ul>
            </section>
            <section aria-labelledby="how-heading">
              <h2 id="how-heading">How you use Personal Voice</h2>
              <ul className="metric-list">
                {model.destinations.map((item) => (
                  <li key={item.id}><span>{item.label}</span><span>{item.share}%</span></li>
                ))}
                {model.triggers.map((item) => (
                  <li key={item.id}><span>{item.label}</span><span>{item.share}%</span></li>
                ))}
              </ul>
            </section>
            <section aria-labelledby="features-heading">
              <h2 id="features-heading">Features</h2>
              {model.features.length === 0 && <p className="hint">No feature usage yet.</p>}
              <ul className="metric-list">
                {model.features.map((item) => (
                  <li key={item.id}><span>{item.label}</span><span>{item.count}</span></li>
                ))}
              </ul>
            </section>
          </div>

          <section aria-labelledby="patterns-heading">
            <h2 id="patterns-heading">Patterns</h2>
            {model.insights.length === 0 ? (
              <p className="hint">A few more dictations will make a pattern visible.</p>
            ) : (
              <ul className="metric-list">
                {model.insights.map((line) => <li key={line}>{line}</li>)}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
