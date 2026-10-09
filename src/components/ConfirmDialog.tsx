import { useCallback, useEffect, useId, useRef, useState } from "react";

/** Only a deliberate confirmation can execute this callback. */
export interface DestructiveAction {
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm(): void | Promise<void>;
}

export function useConfirmAction() {
  const [request, setRequest] = useState<DestructiveAction | null>(null);
  const ask = useCallback((action: DestructiveAction) => setRequest(action), []);
  const dismiss = useCallback(() => setRequest(null), []);
  return { request, ask, dismiss };
}

/**
 * One accessible, branded native modal shared by destructive operations.
 * showModal() supplies a true top-layer, focus trap and Escape behavior on
 * Windows and Android, without a second Tauri window or popup tray.
 */
export function ConfirmDialog({ request, onClose }: {
  request: DestructiveAction | null;
  onClose(): void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (request && !dialog.open) dialog.showModal();
    if (!request && dialog.open) dialog.close();
    busyRef.current = false;
    setBusy(false);
    setError(null);
  }, [request]);

  async function confirm() {
    if (!request || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await request.onConfirm();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function cancel() {
    if (busyRef.current) return;
    onClose();
  }

  return (
    <dialog
      ref={ref}
      className="confirm-dialog"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault();
        cancel();
      }}
      onClose={cancel}
    >
      <div className="confirm-dialog-icon" aria-hidden="true">!</div>
      <h2 id={titleId}>{request?.title ?? "Confirm action"}</h2>
      <p id={descriptionId}>{request?.description}</p>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="confirm-dialog-actions">
        <button type="button" className="secondary" autoFocus disabled={busy} onClick={cancel}>Cancel</button>
        <button type="button" className="confirm-dialog-danger" disabled={busy || !request}
          onClick={() => { void confirm(); }}>
          {busy ? "Working…" : (request?.confirmLabel ?? "Delete")}
        </button>
      </div>
    </dialog>
  );
}
