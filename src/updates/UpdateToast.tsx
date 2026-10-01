import type { AvailableUpdate } from "@/platform/PlatformAdapter";

interface UpdateToastProps {
  update: AvailableUpdate;
  busy: boolean;
  onUpdate(): void;
  onDismiss(): void;
}

/** In-app notice when auto-update is off and a newer version is ready. */
export function UpdateToast({ update, busy, onUpdate, onDismiss }: UpdateToastProps) {
  return (
    <div className="update-toast" role="status" aria-live="polite">
      <p>Version {update.version} is available.</p>
      <div className="update-toast-actions">
        <button type="button" className="record" disabled={busy} onClick={onUpdate}>
          Update
        </button>
        <button type="button" className="secondary" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
      {busy && <p className="hint">Finish dictating first.</p>}
    </div>
  );
}
