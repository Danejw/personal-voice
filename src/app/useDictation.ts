import { useEffect, useRef, useState } from "react";
import type { PlatformAdapter, PushToTalkEvent } from "@/platform/PlatformAdapter";
import { gateDictationCapture } from "@/voice/audio/gateDictationCapture";
import type { MicrophoneLease } from "@/voice/audio/microphoneLease";
import { countOutputWords, countTermUses } from "@/usage/words";
import { usageEventsFromDictation } from "@/usage/usageEvents";
import type { UsageStore } from "@/usage/UsageStore";
import type { VoiceProvider } from "@/voice/provider/VoiceProvider";
import { DictationController, initialDictationSnapshot } from "@/voice/session/DictationController";
import type { DictationSnapshot } from "@/voice/session/DictationController";
import { isCancellable } from "@/voice/session/indicator";
import { formatTimings } from "@/voice/session/timings";
import type { TranscriptDestinationId, TranscriptDestinationRouter } from "@/voice/transcript/TranscriptDestination";

/** Indicator/Escape IPC must never break dictation itself. */
function quietly(promise: Promise<unknown>) {
  promise.catch(() => undefined);
}

/**
 * Binds one `DictationController` to React state and to the platform:
 * push-to-talk drives it, and Escape is routed while an utterance is cancellable.
 */
export interface UsageContext {
  locale: string | null;
  terms: readonly string[];
}

export function useDictation(
  platform: PlatformAdapter,
  getProvider: () => VoiceProvider,
  destinations: TranscriptDestinationRouter,
  usage: UsageStore,
  getUsageContext: () => UsageContext = () => ({ locale: null, terms: [] }),
  lease?: MicrophoneLease,
  /** Runs before capture starts so destinations can lock utterance-scoped state. */
  prepareUtterance?: (destination: TranscriptDestinationId) => void,
) {
  const [snapshot, setSnapshot] = useState<DictationSnapshot>(initialDictationSnapshot);
  const [paused, setPaused] = useState(false);
  const contextRef = useRef(getUsageContext);
  contextRef.current = getUsageContext;
  const [controller] = useState(
    () => new DictationController(
      () => lease ? gateDictationCapture(platform.createCapture(), lease) : platform.createCapture(),
      setSnapshot,
      destinations,
      {
      onTimings: (timings, transcript) => {
        if (import.meta.env.DEV) console.info(`[latency] ${formatTimings(timings)}`);
        const context = contextRef.current();
        usage.recordLater({
          name: "dictation_completed",
          outputWords: countOutputWords(transcript, context.locale),
          completionMs: timings.totalMs,
          recordingMs: timings.recordingMs,
          termUses: countTermUses(transcript, context.terms, context.locale),
        });
        if (timings.recovered) usage.recordLater({ name: "recovery_used" });
      },
    }),
  );
  const previousRef = useRef(snapshot);
  const providerRef = useRef(getProvider);
  const prepareRef = useRef(prepareUtterance);
  useEffect(() => { providerRef.current = getProvider; }, [getProvider]);
  prepareRef.current = prepareUtterance;

  useEffect(() => () => void controller.dispose(), [controller]);

  useEffect(() => {
    const onPushToTalk = (event: PushToTalkEvent) => {
      switch (event.event) {
        case "press":
          if (lease?.heldBy() === "assistant") return;
          if (event.trigger) usage.armTrigger(event.trigger);
          destinations.overrideNext(event.destination ?? null);
          try {
            prepareRef.current?.(event.destination ?? destinations.selected);
          } catch {
            destinations.overrideNext(null);
            return;
          }
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
        case "toggle-assistant":
          // The Assistant shortcut is a separate listener. It must not start dictation.
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
    const trigger = snapshot.utterance > previous.utterance ? usage.consumeTrigger() : null;
    for (const event of usageEventsFromDictation(previous, snapshot, trigger)) {
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
