import type { AvailableUpdate } from "@/platform/PlatformAdapter";
import type { UpdateState } from "@/updates/updateState";
import type { Updates } from "@/updates/useUpdates";

interface UpdatePanelProps {
  updates: Updates;
  /** Installing on Windows closes the app, so it waits for dictation to finish. */
  busy: boolean;
}

function installLabel(update: AvailableUpdate): string {
  switch (update.action) {
    case "restart": return "Install and restart";
    case "download": return "Download update";
    default: {
      const unhandled: never = update.action;
      throw new Error(`Unhandled update action: ${String(unhandled)}`);
    }
  }
}

function installHint(update: AvailableUpdate): string {
  switch (update.action) {
    case "restart":
      return "Personal Voice closes, installs the signed update, and reopens. Your sign-in and settings are kept.";
    case "download":
      return "Your browser downloads the APK. Open it and tap Update. The first time, Android asks you to allow installs from your browser. Your sign-in and settings are kept.";
    default: {
      const unhandled: never = update.action;
      throw new Error(`Unhandled update action: ${String(unhandled)}`);
    }
  }
}

function statusText(state: UpdateState, version: string | null): string {
  const current = version ? `Version ${version}` : "This version";
  switch (state.kind) {
    case "idle": return current;
    case "checking": return "Checking for updates…";
    case "upToDate": return `${current} is the latest.`;
    case "available": return `Version ${state.update.version} is available.`;
    case "installing":
      return state.update.action === "restart"
        ? `Downloading and verifying version ${state.update.version}…`
        : "Opening the download…";
    case "handedOff": return "Finish in your browser: open the downloaded APK and tap Update.";
    case "error": return current;
    default: {
      const unhandled: never = state;
      throw new Error(`Unhandled update state: ${String(unhandled)}`);
    }
  }
}

/** Current version, the latest release, and the one-tap install or download. */
export function UpdatePanel({ updates, busy }: UpdatePanelProps) {
  const { state, version } = updates;
  const update = state.kind === "available" || state.kind === "handedOff" || state.kind === "error" ? state.update : null;
  const checking = state.kind === "checking" || state.kind === "installing";

  return (
    <>
      <div className="sync-status">
        <p role="status">{statusText(state, version)}</p>
        {!update && (
          <button type="button" className="secondary" disabled={checking} onClick={updates.check}>Check for updates</button>
        )}
      </div>
      {state.kind === "available" && state.update.notes && <p className="release-notes hide-scrollbar">{state.update.notes}</p>}
      {update && (
        <>
          <p className="hint">{installHint(update)}</p>
          <div className="actions">
            <button type="button" className="record" disabled={busy} onClick={updates.install}>
              {state.kind === "handedOff" ? "Download again" : installLabel(update)}
            </button>
            <button type="button" className="secondary" onClick={updates.check}>Check again</button>
          </div>
          {busy && <p className="hint">Finish dictating first.</p>}
        </>
      )}
      {state.kind === "error" && <p className="error" role="alert">{state.message}</p>}
    </>
  );
}
