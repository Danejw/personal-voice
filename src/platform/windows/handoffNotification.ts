import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { HandoffAlert } from "@/handoffs/handoffAlert";

/** Shows a Windows toast. The click is delivered as `handoff-alert-click` with the handoff id. */
export function showHandoffAlert(alert: HandoffAlert): Promise<void> {
  return invoke("show_handoff_alert", { id: alert.id, title: alert.title, body: alert.body });
}

export function onHandoffAlertClick(handler: (id: string) => void): Promise<() => void> {
  return listen<string>("handoff-alert-click", (event) => {
    if (event.payload) handler(event.payload);
  });
}
