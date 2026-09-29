import { useEffect, useRef } from "react";
import { classifyHandoffText } from "@/assistant/continuation";
import { initialArrivalState, nextArrivals } from "@/handoffs/handoffAlert";
import type { HandoffStore } from "@/handoffs/HandoffStore";
import { onHandoffAlertClick, showHandoffAlert } from "@/platform/windows/handoffNotification";

/** Windows: toast each new received handoff, and insert it when the toast is clicked. */
export function useHandoffAlerts(
  store: HandoffStore,
  userId: string | null,
  enabled: boolean,
  insert: (text: string) => Promise<void>,
  onContinuation?: () => void,
  onRemoteRead?: () => void,
): void {
  const insertRef = useRef(insert);
  const continuationRef = useRef(onContinuation);
  const remoteReadRef = useRef(onRemoteRead);
  insertRef.current = insert;
  continuationRef.current = onContinuation;
  remoteReadRef.current = onRemoteRead;

  useEffect(() => {
    if (!enabled) return;
    let state = initialArrivalState();
    const apply = () => {
      const next = nextArrivals(state, store.getSnapshot());
      state = next.state;
      for (const alert of next.alerts) void showHandoffAlert(alert).catch(() => undefined);
    };
    apply();
    return store.subscribe(apply);
  }, [store, userId, enabled]);

  useEffect(() => {
    if (!enabled) return;
    let stop = () => {};
    let closed = false;
    void onHandoffAlertClick((id) => {
      if (id.startsWith("remote-read:")) {
        remoteReadRef.current?.();
        return;
      }
      const handoff = store.getSnapshot().received.find((item) => item.id === id);
      if (!handoff) return;
      if (classifyHandoffText(handoff.text).kind !== "text") {
        continuationRef.current?.();
        return;
      }
      void insertRef.current(handoff.text);
    }).then((unlisten) => {
      if (closed) unlisten();
      else stop = unlisten;
    });
    return () => {
      closed = true;
      stop();
    };
  }, [store, enabled]);
}
