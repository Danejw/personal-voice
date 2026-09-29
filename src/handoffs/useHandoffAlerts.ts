import { useEffect, useRef } from "react";
import { initialArrivalState, nextArrivals } from "@/handoffs/handoffAlert";
import type { HandoffStore } from "@/handoffs/HandoffStore";
import { onHandoffAlertClick, showHandoffAlert } from "@/platform/windows/handoffNotification";

/** Windows: toast each new received handoff, and insert it when the toast is clicked. */
export function useHandoffAlerts(
  store: HandoffStore,
  userId: string | null,
  enabled: boolean,
  insert: (text: string) => Promise<void>,
): void {
  const insertRef = useRef(insert);
  insertRef.current = insert;

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
      const handoff = store.getSnapshot().received.find((item) => item.id === id);
      if (!handoff) return;
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
