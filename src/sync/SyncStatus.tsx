import type { PersonalSyncStore, SyncSnapshot, SyncStatus as Status } from "@/sync/PersonalSyncStore";

interface SyncStatusProps {
  store: PersonalSyncStore;
  sync: SyncSnapshot;
}

function statusLabel(status: Status): string {
  switch (status) {
    case "signed-out": return "Sign in";
    case "loading": return "Syncing…";
    case "synced": return "Synced";
    case "offline": return "Offline";
    default: {
      const unhandled: never = status;
      throw new Error(`Unhandled sync status: ${String(unhandled)}`);
    }
  }
}

/** Why settings can't be edited right now, for the panels that edit synced data. `null` when editable. */
export function readOnlyReason(status: Status): string | null {
  switch (status) {
    case "signed-out": return "Sign in to change these.";
    case "loading": return "Loading your saved copy…";
    case "synced": return null;
    case "offline": return "Read-only while offline.";
    default: {
      const unhandled: never = status;
      throw new Error(`Unhandled sync status: ${String(unhandled)}`);
    }
  }
}

/** Account-wide sync state, including failed saves. Retries itself when the connection returns. */
export function SyncStatus({ store, sync }: SyncStatusProps) {
  return (
    <>
      <div className="sync-status">
        <p role="status">{statusLabel(sync.status)}</p>
        {sync.status === "offline" && (
          <button type="button" className="secondary" onClick={() => void store.reload()}>Retry</button>
        )}
      </div>
      {sync.error && <p className="error" role="alert">{sync.error}</p>}
    </>
  );
}
