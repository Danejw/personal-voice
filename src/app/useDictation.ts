import { useEffect, useRef, useState } from "react";
import type { PlatformAdapter, PushToTalkEvent } from "@/platform/PlatformAdapter";
import type { VoiceProvider } from "@/voice/provider/VoiceProvider";
import { DictationController, initialDictationSnapshot } from "@/voice/session/DictationController";
import type { DictationSnapshot } from "@/voice/session/DictationController";
import { indicatorFor, isCancellable } from "@/voice/session/indicator";

const ERROR_INDICATOR_MS = 4000;

/** Indicator/Escape IPC must never break dictation itself. */
function quietly(promise: Promise<unknown>) {
  promise.catch(() => undefined);
}

/**
 * Binds one `DictationController` to React state and to the platform:
 * push-to-talk drives it, and its state drives the floating indicator.
 */
export function useDictation(platform: PlatformAdapter, getProvider: () => VoiceProvider) {
  const [snapshot, setSnapshot] = useState<DictationSnapshot>(initialDictationSnapshot);
  const [paused, setPaused] = useState(false);
  const [controller] = useState(
    () => new DictationController(() => platform.createCapture(), setSnapshot, (text) => platform.insertText(text)),
  );
  const providerRef = useRef(getProvider);
  useEffect(() => { providerRef.current = getProvider; }, [getProvider]);

  useEffect(() => () => void controller.dispose(), [controller]);

  useEffect(() => {
    const onPushToTalk = (event: PushToTalkEvent) => {
      switch (event) {
        case "press": void controller.press(providerRef.current()); return;
        case "release": void controller.stop(); return;
        case "cancel": void controller.cancel(); return;
        default: {
          const unhandled: never = event;
          throw new Error(`Unhandled push-to-talk event: ${String(unhandled)}`);
        }
      }
    };
    const onPaused = (isPaused: boolean) => {
      setPaused(isPaused);
      if (isPaused) void controller.cancel();
    };
    let disposed = false;
    let unlisteners: (() => void)[] = [];
    void Promise.all([platform.onPushToTalk(onPushToTalk), platform.onPausedChange(onPaused)]).then((fns) => {
      if (disposed) fns.forEach((unlisten) => unlisten());
      else unlisteners = fns;
    });
    return () => {
      disposed = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [controller, platform]);

  const { state, error, utterance } = snapshot;
  useEffect(() => {
    quietly(platform.setDictationActive(isCancellable(state)));
    const indicator = indicatorFor({ ...initialDictationSnapshot, state, error });
    if (!indicator) {
      quietly(platform.hideIndicator());
      return;
    }
    quietly(platform.showIndicator(indicator));
    if (indicator.kind !== "error") return;
    const timer = setTimeout(() => quietly(platform.hideIndicator()), ERROR_INDICATOR_MS);
    return () => clearTimeout(timer);
  }, [platform, state, error, utterance]);

  return { snapshot, controller, paused };
}
