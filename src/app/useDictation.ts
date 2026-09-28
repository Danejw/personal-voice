import { useEffect, useRef, useState } from "react";
import type { PlatformAdapter, PushToTalkEvent } from "@/platform/PlatformAdapter";
import { usageEventsFromDictation } from "@/usage/usageEvents";
import type { UsageStore } from "@/usage/UsageStore";
import type { VoiceProvider } from "@/voice/provider/VoiceProvider";
import { DictationController, initialDictationSnapshot } from "@/voice/session/DictationController";
import type { DictationSnapshot } from "@/voice/session/DictationController";
import { isCancellable } from "@/voice/session/indicator";
import { formatTimings } from "@/voice/session/timings";
import type { TranscriptDestinationRouter } from "@/voice/transcript/TranscriptDestination";

/** Indicator/Escape IPC must never break dictation itself. */
function quietly(promise: Promise<unknown>) {
  promise.catch(() => undefined);
}

/**
 * Binds one `DictationController` to React state and to the platform:
 * push-to-talk drives it, and Escape is routed while an utterance is cancellable.
 */
export function useDictation(
  platform: PlatformAdapter,
  getProvider: () => VoiceProvider,
  destinations: TranscriptDestinationRouter,
  usage: UsageStore,
) {
  const [snapshot, setSnapshot] = useState<DictationSnapshot>(initialDictationSnapshot);
  const [paused, setPaused] = useState(false);
  const [controller] = useState(
    () => new DictationController(() => platform.createCapture(), setSnapshot, destinations, {
      onTimings: (timings) => {
        if (import.meta.env.DEV) console.info(`[latency] ${formatTimings(timings)}`);
        usage.recordLater({ name: "dictation_completed", durationMs: timings.totalMs });
        if (timings.recovered) usage.recordLater({ name: "recovery_used" });
      },
    }),
  );
  const previousRef = useRef(snapshot);
  const providerRef = useRef(getProvider);
  useEffect(() => { providerRef.current = getProvider; }, [getProvider]);

  useEffect(() => () => void controller.dispose(), [controller]);

  useEffect(() => {
    const onPushToTalk = (event: PushToTalkEvent) => {
      switch (event.event) {
        case "press":
          destinations.overrideNext(event.destination ?? null);
          void controller.press(providerRef.current());
          return;
        case "release": void controller.stop(); return;
        case "cancel":
          destinations.overrideNext(null);
          void controller.cancel();
          return;
        case "capture-selection":
          // Overlay and Settings handle capture; this is not a dictation press.
          return;
        default: {
          const unhandled: never = event.event;
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
  }, [controller, platform, destinations]);

  useEffect(() => {
    const previous = previousRef.current;
    previousRef.current = snapshot;
    for (const event of usageEventsFromDictation(previous, snapshot)) {
      usage.recordLater(event);
    }
  }, [snapshot, usage]);

  useEffect(() => {
    if (snapshot.state === "IDLE" || snapshot.state === "ERROR") {
      destinations.overrideNext(null);
    }
  }, [destinations, snapshot.state]);

  useEffect(() => {
    quietly(platform.setDictationActive(isCancellable(snapshot.state)));
  }, [platform, snapshot.state]);

  return { snapshot, controller, paused };
}
