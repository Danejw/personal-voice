import { useEffect, useState } from "react";
import { AppNav, sectionMeta, type AppSection } from "@/app/AppNav";
import { useDictation } from "@/app/useDictation";
import { AuthPanel } from "@/auth/AuthPanel";
import { useAuth } from "@/auth/useAuth";
import { SelectionPanel } from "@/context/SelectionPanel";
import { SelectField } from "@/components/SelectField";
import type { SelectOption } from "@/components/SelectField";
import { DevicesPanel } from "@/devices/DevicesPanel";
import { DeviceStore } from "@/devices/DeviceStore";
import { useDevices } from "@/devices/useDevices";
import { DeviceTargetField } from "@/handoffs/DeviceTargetField";
import { HandoffPanel } from "@/handoffs/HandoffPanel";
import { HandoffStore } from "@/handoffs/HandoffStore";
import { useHandoffAlerts } from "@/handoffs/useHandoffAlerts";
import { useHandoffs } from "@/handoffs/useHandoffs";
import { DictationHistoryPanel } from "@/history/DictationHistoryPanel";
import { DictationHistoryStore } from "@/history/DictationHistoryStore";
import { useDictationHistory } from "@/history/useDictationHistory";
import { VoiceNotesPanel } from "@/notes/VoiceNotesPanel";
import { VoiceNotesStore } from "@/notes/VoiceNotesStore";
import { useVoiceNotes } from "@/notes/useVoiceNotes";
import { useOverlay } from "@/overlay/useOverlay";
import { createPlatformAdapter, type AppPlatform } from "@/platform";
import type { TargetApp } from "@/platform/targetApp";
import { AndroidSetupPanel } from "@/platform/android/AndroidSetupPanel";
import { MicrophonePanel } from "@/platform/windows/MicrophonePanel";
import { PushToTalkShortcutPanel } from "@/platform/windows/PushToTalkShortcutPanel";
import { WindowsBehaviorPanel } from "@/platform/windows/WindowsBehaviorPanel";
import { deviceApi } from "@/services/deviceService";
import { fetchGeminiToken } from "@/services/geminiTokenService";
import { handoffApi } from "@/services/handoffService";
import { personalSyncApi } from "@/services/personalSyncService";
import { usageApi } from "@/services/usageService";
import { voiceNotesApi } from "@/services/voiceNotesService";
import { bindDeviceSettings, loadDestination, loadShowIndicator, saveDestination, saveShowIndicator } from "@/settings/deviceSettings";
import { DictionaryPanel } from "@/sync/DictionaryPanel";
import { PersonalSyncStore } from "@/sync/PersonalSyncStore";
import { SyncStatus } from "@/sync/SyncStatus";
import { TranscriptionSettingsPanel } from "@/sync/TranscriptionSettingsPanel";
import { localDeviceId } from "@/sync/personalCache";
import { transcriptionPreferences } from "@/sync/personalData";
import type { DictionaryTerm } from "@/sync/personalData";
import { usePersonalSync } from "@/sync/usePersonalSync";
import { AnalyticsPanel } from "@/usage/AnalyticsPanel";
import { mergeUsageDays, termUsage } from "@/usage/analytics";
import { UsagePanel } from "@/usage/UsagePanel";
import { UsageStore } from "@/usage/UsageStore";
import type { UsageSnapshot } from "@/usage/usageEvents";
import { useUsage } from "@/usage/useUsage";
import { countOutputWords } from "@/usage/words";
import { UpdatePanel } from "@/updates/UpdatePanel";
import { useUpdates } from "@/updates/useUpdates";
import { GeminiProvider, geminiConfigFrom } from "@/voice/provider/gemini/GeminiProvider";
import { GeminiTokenSource } from "@/voice/provider/gemini/GeminiTokenSource";
import type { VoiceState } from "@/voice/session/state";
import { TranscriptDestinationRouter } from "@/voice/transcript/TranscriptDestination";
import type { TranscriptDestinationId } from "@/voice/transcript/TranscriptDestination";

function dictionaryTermUsage(
  usageSnapshot: UsageSnapshot,
  deviceId: string | null,
  terms: readonly DictionaryTerm[],
): Record<string, { uses: number; lastDay: string | null }> {
  const rows = mergeUsageDays(
    usageSnapshot.remote.filter((row) => row.epoch === usageSnapshot.epoch),
    usageSnapshot.days,
    deviceId ?? "",
  );
  const stats = termUsage(rows, [...terms]);
  const labels: Record<string, { uses: number; lastDay: string | null }> = {};
  for (const entry of stats.used) labels[entry.term.toLocaleLowerCase()] = { uses: entry.uses, lastDay: entry.lastDay };
  for (const term of stats.neverUsed) labels[term.toLocaleLowerCase()] = { uses: 0, lastDay: null };
  return labels;
}

const platform = createPlatformAdapter();
const tokens = new GeminiTokenSource(fetchGeminiToken);
const usage = new UsageStore(localStorage, platform.platform, () => new Date(), usageApi);
const personalSync = new PersonalSyncStore(personalSyncApi, localStorage, platform.platform);
const voiceNotes = new VoiceNotesStore(
  voiceNotesApi,
  (userId) => localDeviceId(localStorage, userId, () => crypto.randomUUID()),
  () => usage.recordLater({ name: "voice_note_created" }),
);
const devices = new DeviceStore(
  deviceApi,
  (userId) => localDeviceId(localStorage, userId, () => crypto.randomUUID()),
);
const handoffs = new HandoffStore(
  handoffApi,
  (userId) => localDeviceId(localStorage, userId, () => crypto.randomUUID()),
  () => usage.recordLater({ name: "handoff_created" }),
  () => usage.recordLater({ name: "shared_clipboard" }),
);
const history = new DictationHistoryStore(localStorage);

/** Counts a successful paste. A failure here must not fail the paste itself. */
function recordTargetApp(text: string, app: TargetApp | null): void {
  if (!app) return;
  try {
    usage.recordLater({
      name: "target_app",
      appId: app.id,
      appLabel: app.label,
      words: countOutputWords(text, personalSync.getSnapshot().data.settings.language),
    });
  } catch {
    // The transcript is already in the other app.
  }
}

function pasteIntoField(text: string): Promise<void> {
  return platform.insertText(text).then((app) => {
    recordTargetApp(text, app);
  });
}

function pasteReceived(text: string): Promise<void> {
  return platform.insertReceivedText(text).then((app) => {
    recordTargetApp(text, app);
  });
}

const destinations = new TranscriptDestinationRouter({
  "active-field": { deliver: (transcript) => pasteIntoField(transcript) },
  "voice-note": { deliver: (transcript) => voiceNotes.create(transcript) },
  "send-to-device": { deliver: (transcript) => handoffs.send(transcript) },
}, "active-field", (result) => {
  history.recordLater(result);
  if (result.outcome === "success") {
    usage.recordLater({ name: "destination_used", destination: result.destination });
  }
});
const DESTINATION_OPTIONS: readonly SelectOption[] = [
  { value: "active-field", label: "Active field" },
  { value: "voice-note", label: "Voice note" },
  { value: "send-to-device", label: "Send to device" },
];

/** Read at press time, so a settings or dictionary change applies to the very next utterance. */
function createProvider(): GeminiProvider {
  return new GeminiProvider(tokens, geminiConfigFrom(transcriptionPreferences(personalSync.getSnapshot().data)));
}

/** Primary control label and whether pressing it does anything in this state. */
function controlFor(state: VoiceState, destination: TranscriptDestinationId): { label: string; enabled: boolean } {
  switch (state) {
    case "IDLE": return { label: "Test dictation", enabled: true };
    case "CONNECTING": return { label: "Stop", enabled: true };
    case "LISTENING": return { label: "Stop", enabled: true };
    case "FINALIZING": return { label: "Transcribing…", enabled: false };
    case "INSERTING": {
      switch (destination) {
        case "active-field": return { label: "Typing…", enabled: false };
        case "voice-note": return { label: "Saving…", enabled: false };
        case "send-to-device": return { label: "Sending…", enabled: false };
        default: {
          const unhandled: never = destination;
          throw new Error(`Unhandled transcript destination: ${String(unhandled)}`);
        }
      }
    }
    case "ERROR": return { label: "Try again", enabled: true };
    default: {
      const unhandled: never = state;
      throw new Error(`Unhandled voice state: ${String(unhandled)}`);
    }
  }
}

/** One word for where dictation is, in the user's terms rather than the state machine's. */
function statusFor(state: VoiceState, destination: TranscriptDestinationId): string {
  switch (state) {
    case "IDLE": return "Ready";
    case "CONNECTING":
    case "LISTENING": return "Listening";
    case "FINALIZING": return "Transcribing";
    case "INSERTING": {
      switch (destination) {
        case "active-field": return "Typing";
        case "voice-note": return "Saving note";
        case "send-to-device": return "Sending";
        default: {
          const unhandled: never = destination;
          throw new Error(`Unhandled transcript destination: ${String(unhandled)}`);
        }
      }
    }
    case "ERROR": return "Something went wrong";
    default: {
      const unhandled: never = state;
      throw new Error(`Unhandled voice state: ${String(unhandled)}`);
    }
  }
}

/** Shortcuts and on-device behavior. Account devices stay in the shared devices panel. */
function DeviceControls({
  platform,
  settingsReady,
  showFloatingControl,
  onFloatingControlChange,
}: {
  platform: AppPlatform;
  /** False until this install's device record is the one load/save will use. */
  settingsReady: boolean;
  showFloatingControl: boolean;
  onFloatingControlChange(show: boolean): void;
}) {
  switch (platform.platform) {
    case "windows":
      return (
        <>
          <section aria-labelledby="trigger-heading">
            <h2 id="trigger-heading" title="Saved on this PC. Not copied to your phone.">Keybindings</h2>
            {settingsReady
              ? <PushToTalkShortcutPanel platform={platform} />
              : <p className="hint">Loading saved bindings…</p>}
          </section>
          <section aria-labelledby="behavior-heading">
            <h2 id="behavior-heading">On this PC</h2>
            <WindowsBehaviorPanel
              platform={platform}
              showFloatingControl={showFloatingControl}
              onFloatingControlChange={onFloatingControlChange}
            />
          </section>
        </>
      );
    case "android":
      return (
        <section aria-labelledby="trigger-heading">
          <h2 id="trigger-heading">Floating mic</h2>
          <p className="hint">Overlay, accessibility, and whether the mic is on stay on this phone.</p>
          <AndroidSetupPanel />
        </section>
      );
    default: {
      const unhandled: never = platform;
      throw new Error(`Unhandled platform: ${String(unhandled)}`);
    }
  }
}

export default function App() {
  const auth = useAuth();
  const sync = usePersonalSync(personalSync, auth.userId);
  const notes = useVoiceNotes(voiceNotes, auth.userId);
  const deviceSnapshot = useDevices(devices, auth.userId);
  const handoffSnapshot = useHandoffs(handoffs, auth.userId);
  useHandoffAlerts(
    handoffs,
    auth.userId,
    platform.platform === "windows",
    (text) => pasteReceived(text),
  );
  const historySnapshot = useDictationHistory(history);
  const usageSnapshot = useUsage(usage);
  const [destination, setDestination] = useState<TranscriptDestinationId>(destinations.selected);
  const [section, setSection] = useState<AppSection>("voice");
  const [floatingControl, setFloatingControl] = useState(loadShowIndicator);
  const { snapshot, controller, paused } = useDictation(platform, createProvider, destinations, usage, () => {
    const data = personalSync.getSnapshot().data;
    return {
      locale: data.settings.language,
      terms: data.terms.filter((entry) => entry.enabled).map((entry) => entry.term),
    };
  });
  const updates = useUpdates(platform);
  const { state, partial, transcript, error } = snapshot;
  const control = controlFor(state, destination);
  const page = sectionMeta(section);
  const signedIn = !!auth.email;
  const idle = state === "IDLE" || state === "ERROR";
  const status = !auth.ready ? "Starting…" : !signedIn ? "Sign in to start dictating" : paused ? "Paused from the tray" : statusFor(state, destination);

  function chooseDestination(value: string) {
    if (value !== "active-field" && value !== "voice-note" && value !== "send-to-device") return;
    destinations.select(value);
    setDestination(value);
    saveDestination(value);
  }

  useOverlay({
    platform,
    visible: platform.platform !== "windows" || floatingControl,
    dictation: snapshot,
    paused,
    signedIn,
    destination,
    notes: notes.notes,
    handoffs: handoffSnapshot.received,
    devices: handoffSnapshot.devices,
    controller,
    getProvider: createProvider,
    onDestination: chooseDestination,
    overrideDestination: (next) => destinations.overrideNext(next),
    insertHandoff: (text) => pasteReceived(text),
    dismissHandoff: (id) => handoffs.consume(id),
    onSelectionCaptured: () => usage.recordLater({ name: "selection_captured" }),
    onArmDictation: () => usage.armTrigger("overlay"),
  });

  // Bind before the keybinding panel's first read. Child state initializers run during this
  // render, and the effect below runs only after that, which used to load the signed-out copy
  // and then save it over this device's bindings.
  const settingsDeviceId = !auth.ready
    ? undefined
    : auth.userId
      ? localDeviceId(localStorage, auth.userId, () => crypto.randomUUID())
      : null;
  if (settingsDeviceId !== undefined) bindDeviceSettings(settingsDeviceId);

  useEffect(() => {
    if (settingsDeviceId === undefined) return;
    bindDeviceSettings(settingsDeviceId);
    const next = loadDestination();
    destinations.select(next);
    setDestination(next);
    setFloatingControl(loadShowIndicator());
  }, [settingsDeviceId]);

  // Warm one token so the first press doesn't wait on it; drop it when the account changes.
  useEffect(() => {
    tokens.clear();
    if (auth.email) tokens.prefetch();
  }, [auth.email]);

  useEffect(() => {
    usage.setEnabled(sync.data.settings.usageIntelligence);
  }, [sync.data.settings.usageIntelligence]);

  useEffect(() => {
    if (!auth.userId || !settingsDeviceId) {
      usage.adoptRemote([]);
      return;
    }
    usage.beginBootstrap(sync.data.settings.usageEpoch, settingsDeviceId);
    let cancelled = false;
    let request = 0;
    const pull = () => {
      const current = ++request;
      void usageApi.fetchDays().then(
        (rows) => {
          if (cancelled || current !== request) return;
          usage.adoptRemote(rows);
          usage.setRemote(rows);
        },
        () => {
          if (!cancelled && current === request) usage.adoptRemote([]);
        },
      );
    };
    pull();
    const onVisible = () => {
      if (document.visibilityState === "visible") pull();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [auth.userId, settingsDeviceId, sync.data.settings.usageEpoch]);

  useEffect(() => {
    let stop = () => {};
    void platform.onShowFloatingControl(() => {
      saveShowIndicator(true);
      setFloatingControl(true);
    }).then((unlisten) => { stop = unlisten; });
    return () => stop();
  }, []);

  function onControl() {
    switch (state) {
      case "IDLE":
        usage.armTrigger("ui-button");
        void controller.start(createProvider());
        return;
      case "CONNECTING":
      case "LISTENING": void controller.stop(); return;
      case "ERROR": controller.reset(); return;
      case "FINALIZING":
      case "INSERTING": return;
      default: {
        const unhandled: never = state;
        throw new Error(`Unhandled voice state: ${String(unhandled)}`);
      }
    }
  }

  return (
    <div className="app-shell">
      <AppNav
        section={section}
        microphoneOn={state === "CONNECTING" || state === "LISTENING"}
        onSelect={setSection}
      />
      <main className="app-main hide-scrollbar" aria-labelledby="page-title">
        <header className="page-header">
          <h2 id="page-title" className="page-title">{page.label}</h2>
        </header>

        <div className="voice-layout" hidden={section !== "voice"}>
          <div className="panel-stack">
            <section aria-labelledby="status-heading">
              <div className="card-head">
                <h2 id="status-heading">Dictation</h2>
                <p className="status" role="status">{status}</p>
              </div>
              <div className="dictation-controls">
                <SelectField
                  label="Send to" value={destination} options={DESTINATION_OPTIONS}
                  disabled={!idle} onChange={chooseDestination}
                />
                <button type="button" className="record" disabled={!control.enabled || (state === "IDLE" && !signedIn)} onClick={onControl}>
                  {control.label}
                </button>
              </div>
              {destination === "send-to-device" && (
                <DeviceTargetField
                  label="Target" store={handoffs} snapshot={handoffSnapshot} disabled={!idle}
                />
              )}
              {error && <p className="error" role="alert">{error}</p>}
              <div className="transcript" aria-live="polite">
                {partial && <p className="partial">{partial}</p>}
                {!partial && transcript && <p>{transcript}</p>}
                {!partial && !transcript && <p className="placeholder">No transcript yet.</p>}
              </div>
            </section>
            <section aria-labelledby="history-heading">
              <DictationHistoryPanel
                store={history}
                snapshot={historySnapshot}
                insertIntoActiveField={(text) => pasteReceived(text)}
                onInserted={() => usage.recordLater({ name: "history_inserted" })}
              />
            </section>
            <section aria-labelledby="dictionary-heading">
              <h2 id="dictionary-heading">Personal dictionary</h2>
              <DictionaryPanel store={personalSync} sync={sync} termUsage={dictionaryTermUsage(usageSnapshot, settingsDeviceId ?? null, sync.data.terms)} />
            </section>
          </div>
          <div className="panel-stack">
            <section aria-labelledby="selection-heading">
              <SelectionPanel
                platform={platform.platform}
                disabled={!idle}
                capture={() => platform.captureSelection()}
                onCaptured={() => usage.recordLater({ name: "selection_captured" })}
              />
            </section>
            <section aria-labelledby="notes-heading">
              <VoiceNotesPanel store={voiceNotes} snapshot={notes} />
            </section>
            <section aria-labelledby="handoffs-heading">
              <HandoffPanel
                store={handoffs}
                snapshot={handoffSnapshot}
                insertIntoActiveField={(text) => pasteReceived(text)}
              />
            </section>
          </div>
        </div>

        <div className="panel-stack panel-column" hidden={section !== "devices"}>
          {platform.platform === "windows" && (
            <section aria-labelledby="microphone-heading">
              <h2 id="microphone-heading">Microphone</h2>
              <MicrophonePanel />
            </section>
          )}
          <section aria-labelledby="devices-heading">
            <DevicesPanel
              store={devices}
              snapshot={deviceSnapshot}
              onChanged={() => { void handoffs.reload(); }}
            />
          </section>
          <DeviceControls
            key={auth.userId ?? "signed-out"}
            platform={platform}
            settingsReady={settingsDeviceId !== undefined}
            showFloatingControl={floatingControl}
            onFloatingControlChange={(show) => {
              saveShowIndicator(show);
              setFloatingControl(show);
            }}
          />
        </div>

        <div className="panel-stack panel-column" hidden={section !== "settings"}>
          <section aria-labelledby="account-heading">
            <h2 id="account-heading">Account</h2>
            <AuthPanel auth={auth} disabled={!idle} />
            {signedIn && <SyncStatus store={personalSync} sync={sync} />}
          </section>
          <section aria-labelledby="transcription-heading">
            <h2 id="transcription-heading">Transcription</h2>
            <TranscriptionSettingsPanel store={personalSync} sync={sync} />
          </section>
          <section aria-labelledby="usage-heading">
            <h2 id="usage-heading">Usage intelligence</h2>
            <UsagePanel store={personalSync} sync={sync} usage={usageSnapshot} onClear={() => { void usage.clearAnalytics(); }} />
          </section>
          <section aria-labelledby="updates-heading">
            <h2 id="updates-heading">Updates</h2>
            <UpdatePanel updates={updates} busy={!idle} />
          </section>
        </div>

        <div className="analytics" hidden={section !== "analytics"}>
          <AnalyticsPanel
            active={section === "analytics"}
            signedIn={signedIn}
            deviceId={settingsDeviceId ?? null}
            devices={deviceSnapshot.devices}
            dictionary={sync.data.terms}
            usage={usageSnapshot}
          />
        </div>
      </main>
    </div>
  );
}
