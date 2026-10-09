import { useEffect, useMemo, useState } from "react";
import { assistantUsageApi } from "@/services/assistantUsageService";
import { localUsageDay, summarizeAssistantUsage, type AssistantUsageEvent } from "@/usage/assistantUsage";
import type { AssistantUsageStore } from "@/usage/AssistantUsageStore";

interface Props {
  active: boolean;
  userId: string | null;
  epoch: number;
  enabled: boolean;
  devices: readonly { id: string; name: string }[];
  store: AssistantUsageStore;
}
const DAYS = [14, 30] as const;

function dayBefore(today: Date, days: number): string {
  const value = new Date(today.getFullYear(), today.getMonth(), today.getDate() - days);
  return localUsageDay(value);
}
function formatDuration(ms: number): string {
  return ms >= 60_000 ? `${Math.round(ms / 60_000)} min` : `${Math.round(ms / 1000)} sec`;
}

/** Phase A: measured Assistant activity only, not inferred historical conversations. */
export function AssistantAnalyticsPanel({ active, userId, epoch, enabled, devices, store }: Props) {
  const [days, setDays] = useState<(typeof DAYS)[number]>(14);
  const [remote, setRemote] = useState<AssistantUsageEvent[]>([]);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [pending, setPending] = useState(store.getPending());
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = store.subscribe(() => setPending(store.getPending()));
    return () => { unsubscribe(); };
  }, [store]);
  useEffect(() => {
    if (!active || !userId || !enabled) {
      setRemote([]);
      setLoadedKey(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    store.flush();
    void assistantUsageApi.list(epoch, userId).then((data) => {
      if (cancelled) return;
      setRemote(data);
      setLoadedKey(`${userId}:${epoch}`);
      setError(null);
      setLoading(false);
    }, (cause: unknown) => {
      if (cancelled) return;
      setLoading(false);
      setError(cause instanceof Error ? cause.message : "Couldn't load Assistant Analytics.");
    });
    return () => { cancelled = true; };
  }, [active, userId, enabled, epoch, refresh, store]);

  const scope = store.getScope();
  const sameAccount = scope.userId === userId && scope.epoch === epoch;
  const merged = useMemo(() => {
    const currentRemote = loadedKey === `${userId}:${epoch}` ? remote : [];
    const byId = new Map(currentRemote.filter(e => e.epoch === epoch).map(e => [e.id, e]));
    if (sameAccount) for (const event of pending) if (event.epoch === epoch) byId.set(event.id, event);
    return [...byId.values()];
  }, [remote, pending, epoch, loadedKey, userId, sameAccount]);
  const now = new Date();
  const to = localUsageDay(now);
  const from = dayBefore(now, days - 1);
  const summary = summarizeAssistantUsage(merged, from, to);
  const peak = Math.max(1, ...summary.byDay.map(d => d.turns));
  const deviceNames = new Map(devices.map(d => [d.id, d.name]));
  const unknown = summary.userTurns - summary.voiceTurns - summary.typedTurns;

  if (!userId) return <p className="hint">Sign in to see Assistant usage across your devices.</p>;
  if (!enabled) return <p className="hint">Usage intelligence is turned off in Settings. Assistant activity is not collected.</p>;
  return (
    <div className="analytics">
      <div className="insights-tabs" role="group" aria-label="Assistant Analytics period">
        {DAYS.map(count => <button key={count} type="button" className={days === count ? "insights-tab is-active" : "insights-tab"} onClick={() => setDays(count)}>{count} days</button>)}
        <button type="button" className="secondary" onClick={() => setRefresh(i => i + 1)}>Refresh</button>
      </div>
      <p className="hint">Measured from Assistant activity after Phase A was enabled. Saved history before that date is not counted as measured usage.</p>
      {loading && <p className="hint">Loading Assistant activity…</p>}
      {error && <p className="error" role="alert">{error} Unsynced local activity may still be shown.</p>}
      <div className="stat-row">
        {([
          [summary.sessions.toLocaleString(), "Sessions"],
          [formatDuration(summary.activeMs), "Measured active time"],
          [summary.userTurns.toLocaleString(), "User turns"],
          [summary.assistantTurns.toLocaleString(), "Assistant replies"],
          [String(summary.activeDays), "Active days"],
        ] as const).map(([value, label]) =>
          <div key={label} className="stat-cell"><p className="stat-value">{value}</p><p className="stat-label">{label}</p></div>)}
      </div>
      {summary.userTurns === 0 ? (
        <p className="hint">No Assistant interactions have been recorded in this period. Start a voice or typed conversation to see usage here.</p>
      ) : (
        <>
          <section aria-label="Assistant daily activity">
            <h3>Daily activity</h3>
            <p className="hint">Finalized user turns per day. No streamed partial messages or idle time.</p>
            <div style={{ display: "flex", alignItems: "end", gap: 5, height: 120, overflowX: "auto", padding: "8px 0" }}>
              {Array.from({ length: days }, (_, i) => {
                const day = dayBefore(now, days - 1 - i);
                const count = summary.byDay.find(d => d.day === day)?.turns ?? 0;
                return <div key={day} title={`${day}: ${count} user turns`} aria-label={`${day}: ${count} turns`}
                  style={{ height: `${Math.max(3, 100 * count / peak)}%`, background: "var(--accent, #8294ab)",
                    minWidth: 8, flex: 1, opacity: count ? 0.85 : 0.15, borderRadius: 3 }} />;
              })}
            </div>
          </section>
          <section aria-label="Assistant interaction mode">
            <h3>How you interact</h3>
            <p>Voice: {summary.voiceTurns} · Typed: {summary.typedTurns}{unknown ? ` · Unknown: ${unknown}` : ""}</p>
            <p className="hint">Input modality is recorded per finalized user turn, not assigned to the whole conversation.</p>
          </section>
          <section aria-label="Assistant usage by device">
            <h3>Devices</h3>
            {summary.byDevice.map(d => <p key={d.deviceId}>{deviceNames.get(d.deviceId) ?? "Unknown device"}: {d.turns} user turns</p>)}
          </section>
        </>
      )}
      <p className="hint">Tool performance and reliability will be added in Phase B. Personalized recommendations belong in Insights (Phase C).</p>
    </div>
  );
}
