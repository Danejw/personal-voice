import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Toggle } from "@/components/Toggle";
import { androidSetup, canStartFloatingMic } from "@/platform/android/androidSetup";
import type { AndroidPermission, AndroidSetupStatus } from "@/platform/android/androidSetup";

interface SetupStepProps {
  title: string;
  done: boolean;
  /** Shown instead of "Done" when the step isn't required. */
  optional?: boolean;
  children: ReactNode;
  action?: ReactNode;
}

function SetupStep({ title, done, optional = false, children, action }: SetupStepProps) {
  return (
    <li className={done ? "setup-step setup-done" : "setup-step"}>
      <div>
        <strong>{title}</strong>
        <span className="setup-state">{done ? "Done" : optional ? "Recommended" : "Needed"}</span>
        <div className="setup-copy">{children}</div>
      </div>
      {!done && action}
    </li>
  );
}

/** Permissions and the floating mic. Re-checks whenever the app comes back from Android settings. */
export function AndroidSetupPanel() {
  const [status, setStatus] = useState<AndroidSetupStatus | null>(null);
  const [asked, setAsked] = useState<AndroidPermission[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    androidSetup.status().then(setStatus, (reason: unknown) => setError(String(reason)));
  }, []);

  useEffect(() => {
    refresh();
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void androidSetup.onFloatingMicChanged(refresh).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisible);
      unlisten?.();
    };
  }, [refresh]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
      refresh();
    }
  }

  function request(permission: AndroidPermission) {
    setAsked((current) => [...current, permission]);
    void run(() => androidSetup.requestPermissions([permission]));
  }

  /** After one refusal Android stops showing the prompt, so App info is the only way back. */
  function permissionAction(permission: AndroidPermission) {
    return asked.includes(permission)
      ? <button type="button" className="secondary" disabled={busy} onClick={() => void run(androidSetup.openAppSettings)}>App info</button>
      : <button type="button" className="secondary" disabled={busy} onClick={() => request(permission)}>Allow</button>;
  }

  function onStartOnBoot(enabled: boolean) {
    void run(async () => {
      await androidSetup.setStartOnBoot(enabled);
      setStatus((current) => current ? { ...current, startOnBoot: enabled } : current);
    });
  }

  if (!status) return <p className="placeholder">Checking permissions…</p>;

  return (
    <>
      <ol className="setup-steps">
        <SetupStep title="Microphone" done={status.microphone} action={permissionAction("microphone")}>
          Used only while you hold the mic.
        </SetupStep>
        <SetupStep
          title="Display over other apps" done={status.overlay}
          action={<button type="button" className="secondary" disabled={busy} onClick={() => void run(androidSetup.openOverlaySettings)}>Open settings</button>}
        >
          Lets the floating mic sit on top of other apps.
        </SetupStep>
        <SetupStep
          title="Accessibility" done={status.accessibility} optional
          action={(
            <div className="actions">
              <button type="button" className="secondary" disabled={busy} onClick={() => void run(androidSetup.openAccessibilitySettings)}>Open settings</button>
              <button type="button" className="secondary" disabled={busy} onClick={() => void run(androidSetup.openAppSettings)}>App info</button>
            </div>
          )}
        >
          Types into the focused field. Without it, text is copied.
          <details className="fold">
            <summary>If Android blocks it</summary>
            <p>Open App info, tap ⋮, and choose Allow restricted settings.</p>
          </details>
        </SetupStep>
        <SetupStep title="Notifications" done={status.notifications} optional action={permissionAction("notifications")}>
          Shown while the floating mic is on.
        </SetupStep>
        <SetupStep
          title="Unrestricted battery" done={status.batteryUnrestricted} optional
          action={<button type="button" className="secondary" disabled={busy} onClick={() => void run(androidSetup.openBatterySettings)}>Allow</button>}
        >
          Helps the floating mic stay on. On Samsung, also set this app to Never sleeping if prompted.
        </SetupStep>
      </ol>
      <Toggle
        label="Start with phone"
        description="After reboot, briefly opens Personal Voice, turns the floating mic back on, then returns to your home screen."
        checked={status.startOnBoot}
        disabled={busy}
        onChange={onStartOnBoot}
      />
      <div className="actions">
        {status.floatingMic ? (
          <button type="button" className="secondary" disabled={busy} onClick={() => void run(androidSetup.stopFloatingMic)}>
            Turn off floating mic
          </button>
        ) : (
          <button type="button" className="record" disabled={busy || !canStartFloatingMic(status)} onClick={() => void run(androidSetup.startFloatingMic)}>
            Turn on floating mic
          </button>
        )}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
    </>
  );
}
