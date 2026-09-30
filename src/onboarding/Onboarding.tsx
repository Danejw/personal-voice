import { useEffect, useMemo, useRef, useState } from "react";
import { GateBrand, GateFrame } from "@/auth/AuthGate";
import { androidSetup, canStartFloatingMic } from "@/platform/android/androidSetup";
import type { AndroidPermission } from "@/platform/android/androidSetup";
import { requestMicrophoneAccess } from "@/platform/windows/microphonePermission";
import {
  nextStepIndex,
  stepDone,
  stepIndex,
  firstIncompleteStep,
  setupSteps,
  type DeviceReadiness,
  type SetupStepId,
} from "@/onboarding/setupReady";

interface OnboardingProps {
  readiness: DeviceReadiness;
  onEnter(): void;
  onDismiss(): void;
  onShowFloatingControl(show: boolean): void;
  onMicrophoneGranted(): void;
  refresh(): void;
}

/** One permission at a time, until the floating control is on. */
export function Onboarding({
  readiness,
  onEnter,
  onDismiss,
  onShowFloatingControl,
  onMicrophoneGranted,
  refresh,
}: OnboardingProps) {
  const steps = useMemo(() => setupSteps(readiness.platform), [readiness.platform]);
  const [index, setIndex] = useState(() => stepIndex(firstIncompleteStep(readiness), readiness.platform));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asked, setAsked] = useState<AndroidPermission[]>([]);
  const seen = useRef<{ index: number; done: boolean } | null>(null);
  const step = steps[index] ?? steps[0];
  const stepId = step?.id;
  const doneNow = !!stepId && advancesWhenDone(stepId) && stepDone(stepId, readiness);

  useEffect(() => {
    if (!stepId) return;
    const previous = seen.current;
    seen.current = { index, done: doneNow };
    if (!previous || previous.index !== index) return;
    if (!previous.done && doneNow) setIndex(nextStepIndex(index, readiness));
  }, [doneNow, index, readiness, stepId]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  function continueNext() {
    setError(null);
    const current = steps[index];
    if (current?.id === "ready") {
      onEnter();
      return;
    }
    setIndex(nextStepIndex(index, readiness));
  }

  function request(permission: AndroidPermission) {
    setAsked((current) => current.includes(permission) ? current : [...current, permission]);
    void run(() => androidSetup.requestPermissions([permission]));
  }

  if (!step) return null;

  return (
    <GateFrame>
      <GateBrand />
      <ol className="onboarding-dots" aria-label="Setup progress">
        {steps.map((item, dot) => (
          <li
            key={item.id}
            className={dot === index ? "is-current" : dot < index ? "is-done" : undefined}
            aria-current={dot === index ? "step" : undefined}
          >
            <span className="visually-hidden">{`Step ${dot + 1}`}</span>
          </li>
        ))}
      </ol>
      <StepBody
        id={step.id}
        readiness={readiness}
        busy={busy}
        asked={asked}
        onContinue={continueNext}
        onRequest={request}
        onRun={run}
        onShowFloatingControl={onShowFloatingControl}
        onMicrophoneGranted={onMicrophoneGranted}
      />
      {error && <p className="error" role="alert">{error}</p>}
      <div className="onboarding-footer">
        {index > 0 ? (
          <button type="button" className="onboarding-text" disabled={busy} onClick={() => setIndex((current) => Math.max(0, current - 1))}>
            Back
          </button>
        ) : <span />}
        {step.id !== "ready" && (
          <button type="button" className="onboarding-text" disabled={busy} onClick={onDismiss}>
            Set up later
          </button>
        )}
      </div>
    </GateFrame>
  );
}

function advancesWhenDone(id: SetupStepId): boolean {
  return id === "microphone" || id === "overlay" || id === "floating";
}

interface StepBodyProps {
  id: SetupStepId;
  readiness: DeviceReadiness;
  busy: boolean;
  asked: readonly AndroidPermission[];
  onContinue(): void;
  onRequest(permission: AndroidPermission): void;
  onRun(action: () => Promise<void>): void;
  onShowFloatingControl(show: boolean): void;
  onMicrophoneGranted(): void;
}

function StepBody({
  id,
  readiness,
  busy,
  asked,
  onContinue,
  onRequest,
  onRun,
  onShowFloatingControl,
  onMicrophoneGranted,
}: StepBodyProps) {
  switch (id) {
    case "welcome":
      return (
        <>
          <h2>A button that stays with you</h2>
          <p className="onboarding-copy">
            {readiness.platform === "android"
              ? "Personal Voice sits over other apps. We'll allow the microphone, let the button float on top, and turn it on."
              : "Personal Voice sits over other apps. We'll allow the microphone and show the floating button. Hold Right Alt to dictate."}
          </p>
          <button type="button" className="record" disabled={busy} onClick={onContinue}>Get started</button>
        </>
      );
    case "microphone": {
      const granted = stepDone("microphone", readiness);
      return (
        <>
          <h2>Microphone</h2>
          <p className="onboarding-copy">Used only while you hold the mic. Nothing is saved.</p>
          {granted ? (
            <button type="button" className="record" disabled={busy} onClick={onContinue}>Continue</button>
          ) : readiness.platform === "android" ? (
            <button
              type="button"
              className="record"
              disabled={busy}
              onClick={() => asked.includes("microphone") ? void onRun(androidSetup.openAppSettings) : onRequest("microphone")}
            >
              {asked.includes("microphone") ? "App info" : "Allow"}
            </button>
          ) : (
            <button
              type="button"
              className="record"
              disabled={busy}
              onClick={() => void onRun(async () => {
                await requestMicrophoneAccess();
                onMicrophoneGranted();
              })}
            >
              Allow
            </button>
          )}
        </>
      );
    }
    case "overlay":
      return (
        <>
          <h2>Display over other apps</h2>
          <p className="onboarding-copy">
            Lets the floating mic sit on top of other apps. Android opens system settings. Come back here after you allow it.
          </p>
          {stepDone("overlay", readiness) ? (
            <button type="button" className="record" disabled={busy} onClick={onContinue}>Continue</button>
          ) : (
            <button type="button" className="record" disabled={busy} onClick={() => void onRun(androidSetup.openOverlaySettings)}>
              Open settings
            </button>
          )}
        </>
      );
    case "accessibility":
      return (
        <>
          <h2>Type into other apps</h2>
          <p className="onboarding-copy">
            Accessibility types into the field you're in. Without it, dictation is copied so you can paste.
          </p>
          <details className="fold">
            <summary>If Android blocks it</summary>
            <p>Open App info, tap the menu, and choose Allow restricted settings.</p>
          </details>
          {stepDone("accessibility", readiness) ? (
            <button type="button" className="record" disabled={busy} onClick={onContinue}>Continue</button>
          ) : (
            <div className="onboarding-actions">
              <button type="button" className="record" disabled={busy} onClick={() => void onRun(androidSetup.openAccessibilitySettings)}>
                Open settings
              </button>
              <button type="button" className="secondary" disabled={busy} onClick={() => void onRun(androidSetup.openAppSettings)}>
                App info
              </button>
              <button type="button" className="secondary" disabled={busy} onClick={onContinue}>Skip for now</button>
            </div>
          )}
        </>
      );
    case "keep-available":
      return (
        <>
          <h2>Keep the mic available</h2>
          <p className="onboarding-copy">These help the floating mic stay on. You can skip both.</p>
          <div className="onboarding-option">
            <div>
              <strong>Notifications</strong>
              <p>Shown while the floating mic is on.</p>
            </div>
            {readiness.android?.notifications ? <span className="setup-state is-done">Done</span> : (
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => asked.includes("notifications") ? void onRun(androidSetup.openAppSettings) : onRequest("notifications")}
              >
                {asked.includes("notifications") ? "App info" : "Allow"}
              </button>
            )}
          </div>
          <div className="onboarding-option">
            <div>
              <strong>Unrestricted battery</strong>
              <p>Helps the floating mic stay on. On Samsung, also set this app to Never sleeping if prompted.</p>
            </div>
            {readiness.android?.batteryUnrestricted ? <span className="setup-state is-done">Done</span> : (
              <button type="button" className="secondary" disabled={busy} onClick={() => void onRun(androidSetup.openBatterySettings)}>
                Allow
              </button>
            )}
          </div>
          <button type="button" className="record" disabled={busy} onClick={onContinue}>Continue</button>
        </>
      );
    case "floating":
      return readiness.platform === "android" ? (
        <AndroidFloating readiness={readiness} busy={busy} onRun={onRun} onContinue={onContinue} />
      ) : (
        <>
          <h2>Show the floating control</h2>
          <p className="onboarding-copy">A small button over other apps. Hold Right Alt, or that button, to dictate.</p>
          {stepDone("floating", readiness) ? (
            <button type="button" className="record" disabled={busy} onClick={onContinue}>Continue</button>
          ) : (
            <button type="button" className="record" disabled={busy} onClick={() => onShowFloatingControl(true)}>
              Show floating control
            </button>
          )}
        </>
      );
    case "ready":
      return (
        <>
          <h2>You're ready</h2>
          <p className="onboarding-copy">{readyCopy(readiness)}</p>
          <button type="button" className="record" disabled={busy} onClick={onContinue}>Start using Personal Voice</button>
        </>
      );
    default: {
      const unhandled: never = id;
      throw new Error(`Unhandled setup step: ${String(unhandled)}`);
    }
  }
}

function AndroidFloating({
  readiness,
  busy,
  onRun,
  onContinue,
}: {
  readiness: DeviceReadiness;
  busy: boolean;
  onRun(action: () => Promise<void>): void;
  onContinue(): void;
}) {
  const android = readiness.android;
  const enabled = !!android && canStartFloatingMic(android);
  if (stepDone("floating", readiness)) {
    return (
      <>
        <h2>Floating mic is on</h2>
        <p className="onboarding-copy">Hold it to dictate into whatever you're typing.</p>
        <button type="button" className="record" disabled={busy} onClick={onContinue}>Continue</button>
      </>
    );
  }
  return (
    <>
      <h2>Turn on the floating mic</h2>
      <p className="onboarding-copy">This is the button you'll hold to dictate.</p>
      <button type="button" className="record" disabled={busy || !enabled} onClick={() => void onRun(androidSetup.startFloatingMic)}>
        Turn on floating mic
      </button>
      {!enabled && <p className="hint">Allow the microphone and display over other apps first.</p>}
    </>
  );
}

function readyCopy(readiness: DeviceReadiness): string {
  if (readiness.platform === "windows") {
    return "Hold Right Alt, or the floating button, to dictate into the app you're using.";
  }
  if (readiness.android?.accessibility) {
    return "Hold the floating mic to dictate. Text goes into whatever you're typing.";
  }
  return "Hold the floating mic to dictate. Text is copied until you turn on accessibility in Devices & Controls.";
}
