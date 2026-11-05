import { useCallback, useEffect, useMemo, useState } from "react";
import {
  flightDiagnosis, readComputerTimeline, type FlightEvent, type FlightTimelineResult,
} from "@/services/computerFlightRecorder";

const LABELS: Record<string, string> = {
  queued: "Sent to Windows",
  received: "Received on Windows",
  authorized: "Authorized",
  started: "Started",
  screen: "Screen observed",
  model: "Model decision",
  acted: "Desktop action completed",
  acknowledged: "Acknowledged",
  verified: "Visually verified",
  unverified: "Not verified",
  blocked: "Blocked",
  failed: "Failed",
  stopped: "Stopped",
  timeout: "Timed out",
};
function clock(iso: string): string {
  const time = new Date(iso);
  return Number.isFinite(time.getTime())
    ? time.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })
    : "";
}

type TraceGroup = { id: string; events: FlightEvent[] };

export function CompanionFlightRecorder({ userId, activeTraceId }: {
  userId: string | null;
  activeTraceId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<FlightTimelineResult>({ events: [], synced: true });
  const refresh = useCallback(() => {
    if (!userId) return;
    void readComputerTimeline(userId).then(setTimeline).catch(() => {
      setTimeline(current => ({ ...current, synced: false }));
    });
  }, [userId]);

  useEffect(() => {
    if (!open || !userId) return;
    refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [open, userId, refresh]);

  const traces = useMemo(() => {
    const found = new Map<string, FlightEvent[]>();
    for (const event of timeline.events) {
      const prior = found.get(event.trace_id);
      if (prior) prior.push(event);
      else found.set(event.trace_id, [event]);
    }
    return [...found.entries()].slice(0, 8).map(([id, events]): TraceGroup => ({ id, events }));
  }, [timeline.events]);

  const focusId = selected ?? (activeTraceId && traces.some(t => t.id === activeTraceId)
    ? activeTraceId : traces[0]?.id ?? null);
  const focused = traces.find(group => group.id === focusId) ?? null;

  return (
    <>
      <button type="button" className="companion-flight-toggle" aria-expanded={open}
        aria-controls="companion-flight-sheet" onClick={() => setOpen(value => !value)}>
        Activity
      </button>
      {open && (
        <section className="companion-flight-sheet" id="companion-flight-sheet" aria-label="Computer Use flight recorder">
          <div className="companion-flight-head">
            <strong>Computer activity</strong>
            <button type="button" onClick={refresh} aria-label="Refresh activity">Refresh</button>
          </div>
          {!timeline.synced && <p className="companion-flight-warning" role="status">
            Sync unavailable. Showing locally queued events only.
          </p>}
          {!traces.length && <p className="companion-flight-empty">No recorded computer tasks yet.</p>}
          {traces.length > 0 && (
            <>
              <div className="companion-flight-traces" role="group" aria-label="Recent tasks">
                {traces.map(group => (
                  <button type="button" key={group.id}
                    className={group.id === focusId ? "is-active" : ""}
                    aria-pressed={group.id === focusId}
                    onClick={() => setSelected(group.id)}>
                    <span>{clock(group.events[0]?.occurred_at ?? "")}</span>
                    <span>{flightDiagnosis(group.events)}</span>
                  </button>
                ))}
              </div>
              {focused && (
                <ol className="companion-flight-events" aria-label="Task events">
                  {[...focused.events].reverse().map(event => (
                    <li key={event.id}>
                      <time dateTime={event.occurred_at}>{clock(event.occurred_at)}</time>
                      <span>{event.actor === "windows" ? "PC" : "Phone"}</span>
                      <span>{LABELS[event.stage] ?? "Task update"}
                        {event.action_kind ? ` · ${event.action_kind.replaceAll("_", " ")}` : ""}
                        {event.step !== null && event.step > 0 ? ` · step ${event.step}` : ""}
                        {event.failure_code ? ` · ${event.failure_code}` : ""}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </>
          )}
        </section>
      )}
    </>
  );
}
