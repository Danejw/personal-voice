import { useEffect, useRef, useState } from "react";
import { formatHandoffList, formatNoteList } from "@/assistant/accountTools";
import { buildContinuation, handoffDisplayText } from "@/assistant/continuation";
import { selectionPreview } from "@/assistant/selectionContext";
import { snapshotFromNative } from "@/assistant/snapshot";
import { encodeSnapshotJpeg } from "@/assistant/snapshotEncode";
import { AssistantConversationStore } from "@/assistant/AssistantConversationStore";
import { supabaseAssistantFeed, supabaseMemoryFeed } from "@/assistant/assistantFeed";
import { AssistantMemoryStore } from "@/assistant/AssistantMemoryStore";
import { MemoryPanel } from "@/assistant/MemoryPanel";
import { useAssistantMemory } from "@/assistant/useAssistantMemory";
import { AssistantController } from "@/assistant/AssistantController";
import { AssistantHeader, AssistantPanel } from "@/assistant/AssistantPanel";
import { PersonalContextPanel } from "@/assistant/PersonalContextPanel";
import { personalContextBody, profileFacts } from "@/assistant/personalContext";
import { AssistantSession } from "@/assistant/AssistantSession";
import { PcmPlayback } from "@/assistant/PcmPlayback";
import { AndroidAssistantPlayback } from "@/platform/android/AndroidAssistantPlayback";
import { useAssistant } from "@/assistant/useAssistant";
import { useAssistantLibrary } from "@/assistant/useAssistantLibrary";
import { AppNav, sectionMeta, useMobileNav, type AppSection } from "@/app/AppNav";
import { BrandMark } from "@/app/BrandMark";
import { useDictation } from "@/app/useDictation";
import { AuthGate, BrandSplash } from "@/auth/AuthGate";
import { AuthPanel } from "@/auth/AuthPanel";
import { useAuth } from "@/auth/useAuth";
import { SelectionPanel } from "@/context/SelectionPanel";
import { SelectField } from "@/components/SelectField";
import type { SelectOption } from "@/components/SelectField";
import { Toggle } from "@/components/Toggle";
import { Tooltip } from "@/components/Tooltip";
import { DevicesPanel } from "@/devices/DevicesPanel";
import { DeviceStore } from "@/devices/DeviceStore";
import { useDevices } from "@/devices/useDevices";
import { HandoffPanel, HandoffToolbar } from "@/handoffs/HandoffPanel";
import { HandoffStore } from "@/handoffs/HandoffStore";
import { useHandoffAlerts } from "@/handoffs/useHandoffAlerts";
import { useHandoffs } from "@/handoffs/useHandoffs";
import { RemoteDictationDestination } from "@/remote-dictation/RemoteDictationDestination";
import { RemoteDictationStore } from "@/remote-dictation/RemoteDictationStore";
import { supabaseRemoteDictationFeed } from "@/remote-dictation/remoteDictationFeed";
import { useRemoteDictation } from "@/remote-dictation/useRemoteDictation";
import { DictationHistoryPanel } from "@/history/DictationHistoryPanel";
import { DictationHistoryStore, DICTATION_HISTORY_LIMIT } from "@/history/DictationHistoryStore";
import { useDictationHistory } from "@/history/useDictationHistory";
import { NotesPanel, NotesToolbar } from "@/notes/NotesPanel";
import { Onboarding } from "@/onboarding/Onboarding";
import { dismissOnboarding, isDeviceReady, onboardingDismissed } from "@/onboarding/setupReady";
import { useDeviceSetup } from "@/onboarding/useDeviceSetup";
import { NotesStore } from "@/notes/NotesStore";
import { useNotes } from "@/notes/useNotes";
import { useOverlay } from "@/overlay/useOverlay";
import { overlayAssistantFrom, overlayAssistantIntent } from "@/overlay/overlay";
import { createPlatformAdapter, type AppPlatform } from "@/platform";
import type { TargetApp } from "@/platform/targetApp";
import { AndroidSetupPanel } from "@/platform/android/AndroidSetupPanel";
import { MicrophonePanel } from "@/platform/windows/MicrophonePanel";
import { PushToTalkShortcutPanel } from "@/platform/windows/PushToTalkShortcutPanel";
import { WindowsBehaviorPanel } from "@/platform/windows/WindowsBehaviorPanel";
import { assistantConversationsApi } from "@/services/assistantConversationsService";
import { assistantMemoriesApi } from "@/services/assistantMemoriesService";
import { requestMemoryLearn } from "@/services/memoryLearnService";
import { deviceApi } from "@/services/deviceService";
import { dictationsApi } from "@/services/dictationsService";
import { remoteContextApi } from "@/services/remoteContextService";
import { computerActionApi } from "@/services/computerActionService";
import { RemoteReadStore } from "@/assistant/RemoteReadStore";
import { useRemoteReads } from "@/assistant/useRemoteReads";
import { ComputerActionStore } from "@/assistant/ComputerActionStore";
import { useComputerActions } from "@/assistant/useComputerActions";
import { showHandoffAlert } from "@/platform/windows/handoffNotification";
import { fetchGeminiToken } from "@/services/geminiTokenService";
import { handoffApi } from "@/services/handoffService";
import { remoteDictationApi } from "@/services/remoteDictationService";
import { personalSyncApi } from "@/services/personalSyncService";
import { usageApi } from "@/services/usageService";
import { notesApi } from "@/services/notesService";
import {
  bindDeviceSettings,
  loadAssistantAutoRun,
  loadAssistantProfile,
  loadAutoUpdate,
  loadDestination,
  loadRemoteDictation,
  loadShowIndicator,
  saveAssistantAutoRun,
  saveAssistantProfile,
  saveAutoUpdate,
  saveDestination,
  saveRemoteDictation,
  saveShowIndicator,
} from "@/settings/deviceSettings";
import { DictionaryPanel, DictionaryToolbar } from "@/sync/DictionaryPanel";
import { PersonalSyncStore } from "@/sync/PersonalSyncStore";
import { SyncStatus } from "@/sync/SyncStatus";
import { TranscriptionSettingsPanel } from "@/sync/TranscriptionSettingsPanel";
import { localDeviceId } from "@/sync/personalCache";
import { createId } from "@/sync/createId";
import { transcriptionPreferences } from "@/sync/personalData";
import type { DictionaryTerm } from "@/sync/personalData";
import { usePersonalSync } from "@/sync/usePersonalSync";
import { AnalyticsPanel } from "@/usage/AnalyticsPanel";
import { localDayKey, mergeUsageDays, termUsage } from "@/usage/analytics";
import { UsagePanel } from "@/usage/UsagePanel";
import { UsageStore } from "@/usage/UsageStore";
import type { UsageSnapshot } from "@/usage/usageEvents";
import { useUsage } from "@/usage/useUsage";
import { countOutputWords } from "@/usage/words";
import { UpdatePanel } from "@/updates/UpdatePanel";
import { UpdateToast } from "@/updates/UpdateToast";
import { useUpdates } from "@/updates/useUpdates";
import { GeminiProvider, geminiConfigFrom } from "@/voice/provider/gemini/GeminiProvider";
import { GeminiTokenSource } from "@/voice/provider/gemini/GeminiTokenSource";
import { MicrophoneLease } from "@/voice/audio/microphoneLease";
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
const assistantTokens = new GeminiTokenSource(() => fetchGeminiToken("assistant"));
const microphone = new MicrophoneLease();
const assistantPlayback = platform.platform === "android" ? new AndroidAssistantPlayback() : new PcmPlayback();
const assistant = new AssistantController(
  (onEvent, handle) => new AssistantSession(() => assistantTokens.take(), onEvent, handle),
  assistantPlayback,
  createId,
  () => platform.createCapture({ purpose: "assistant" }),
  microphone,
);
assistant.setCamera(platform.createCamera());
const assistantLibrary = new AssistantConversationStore(
  assistant,
  assistantConversationsApi,
  localStorage,
  createId,
  (userId) => localDeviceId(localStorage, userId, createId),
  supabaseAssistantFeed(),
);
const assistantMemory = new AssistantMemoryStore(
  assistantMemoriesApi,
  localStorage,
  supabaseMemoryFeed(),
  (rows) => assistant.setMemories(rows),
  () => assistantLibrary.getSnapshot().currentId,
);
assistantLibrary.setOnUserSaved(() => {
  void assistantMemory.learn();
});
assistantMemory.setRemoteLearn(() => requestMemoryLearn());
assistant.setProducer(() => assistantLibrary.holdingLease());
const usage = new UsageStore(localStorage, platform.platform, () => new Date(), usageApi);
const personalSync = new PersonalSyncStore(personalSyncApi, localStorage, platform.platform);
const notesStore = new NotesStore(
  notesApi,
  (userId) => localDeviceId(localStorage, userId, createId),
  (sourceType) => {
    if (sourceType === "voice") usage.recordLater({ name: "voice_note_created" });
  },
);
const devices = new DeviceStore(
  deviceApi,
  (userId) => localDeviceId(localStorage, userId, createId),
);
const handoffs = new HandoffStore(
  handoffApi,
  (userId) => localDeviceId(localStorage, userId, createId),
  () => usage.recordLater({ name: "handoff_created" }),
  () => usage.recordLater({ name: "shared_clipboard" }),
);
const remoteReads = new RemoteReadStore(
  remoteContextApi,
  (userId) => deviceApi.list(userId),
  (userId) => localDeviceId(localStorage, userId, createId),
  platform,
  (id) => {
    if (platform.platform !== "windows") return;
    void showHandoffAlert({
      id: `remote-read:${id}`,
      title: "Screenshot requested",
      body: "Allow the one-time screenshot in Personal Voice.",
    }).catch(() => undefined);
  },
);
const computerActions = new ComputerActionStore(
  computerActionApi,
  (userId) => deviceApi.list(userId),
  (userId) => localDeviceId(localStorage, userId, createId),
  platform,
);
const remoteDictation = new RemoteDictationStore(
  remoteDictationApi,
  (userId) => deviceApi.list(userId),
  (userId) => localDeviceId(localStorage, userId, createId),
  (text) => pasteReceived(text),
  supabaseRemoteDictationFeed(),
);
const remoteDictationDestination = new RemoteDictationDestination({
  send: (transcript, target) => remoteDictation.send(transcript, target),
});
let accountUserId: string | null = null;
const history = new DictationHistoryStore(
  localStorage,
  DICTATION_HISTORY_LIMIT,
  () => new Date(),
  dictationsApi,
  (userId) => localDeviceId(localStorage, userId, createId),
);

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

assistant.setActions({
  copyText: (text) => navigator.clipboard.writeText(text),
  insertText: (text) => pasteIntoField(text),
  createVoiceNote: (text) => notesStore.create(text, "assistant"),
  planHandoff: (deviceName) => {
    const snap = handoffs.getSnapshot();
    const only = snap.devices[0];
    if (!deviceName && !snap.targetDeviceId && snap.devices.length === 1 && only) {
      return { deviceId: only.id, label: only.name };
    }
    try {
      const target = handoffs.resolveTarget(deviceName);
      return { deviceId: target.id, label: target.name };
    } catch (error) {
      const names = snap.devices.map((device) => device.name);
      const listed = names.length ? ` Devices: ${names.join(", ")}.` : " No other device is on this account.";
      const message = error instanceof Error ? error.message : "The handoff could not be prepared.";
      throw new Error(`${message}${listed}`, { cause: error });
    }
  },
  sendHandoff: (text, deviceId) => handoffs.send(text, "dictation", deviceId),
  captureSelection: () => platform.captureSelection(),
  listVoiceNotes: async (includeArchived) => {
    const snap = notesStore.getSnapshot();
    if (snap.status === "signed-out") throw new Error("Sign in to read notes.");
    if (snap.status !== "synced" && snap.notes.length === 0) throw new Error("Notes are unavailable until sync reconnects.");
    const body = formatNoteList(snap.notes, includeArchived);
    return snap.status === "synced" ? body : `Notes may be out of date.\n${body}`;
  },
  listHandoffs: async () => {
    const snap = handoffs.getSnapshot();
    if (snap.status === "signed-out") throw new Error("Sign in to read handoffs.");
    if (snap.status !== "synced" && snap.received.length === 0 && snap.devices.length === 0) {
      throw new Error("Device handoff is unavailable until sync reconnects.");
    }
    const body = formatHandoffList(
      snap.devices.map((device) => device.name),
      snap.received.map((handoff) => ({
        id: handoff.id,
        text: handoff.text,
        createdAt: handoff.createdAt,
        sourceLabel: snap.devices.find((device) => device.id === handoff.sourceDeviceId)?.name ?? "Another device",
      })),
    );
    return snap.status === "synced" ? body : `Handoffs may be out of date.\n${body}`;
  },
  describeItem: (kind, id) => {
    if (kind === "note") {
      const note = notesStore.getSnapshot().notes.find((item) => item.id === id);
      if (!note) throw new Error("No note has that id. Call list_voice_notes.");
      return selectionPreview(note.text);
    }
    const handoff = handoffs.getSnapshot().received.find((item) => item.id === id);
    if (!handoff) throw new Error("No received handoff has that id. Call list_handoffs.");
    return selectionPreview(handoffDisplayText(handoff.text));
  },
  archiveVoiceNote: (id, archived) => notesStore.setArchived(id, archived),
  deleteVoiceNote: (id) => notesStore.remove(id),
  dismissHandoff: (id) => handoffs.consume(id),
  listMemories: () => assistantMemory.listText(),
  rememberMemory: (input) => assistantMemory.remember(input.kind, input.key, input.value),
  changeMemory: (input) => assistantMemory.change(input.key, input.value),
  forgetMemory: (key) => assistantMemory.forget(key),
  readRemote: async (kind, deviceName) => {
    if (!accountUserId) throw new Error("Sign in to check another device.");
    return remoteReads.ask(accountUserId, kind, deviceName);
  },
  captureScreen: async () => snapshotFromNative(await platform.captureSnapshot(), encodeSnapshotJpeg),
  computer: {
    openApp: (id) => computerActions.openApp(id),
    pressShortcut: (id) => computerActions.pressShortcut(id),
    remoteAction: (action, argument, deviceName) => computerActions.remoteAction(action, argument, deviceName),
    capture: () => computerActions.capture(),
    propose: (body) => computerActions.propose(body),
    execute: (call) => computerActions.execute(call),
    restore: () => computerActions.restore(),
  },
});

const destinations = new TranscriptDestinationRouter({
  "active-field": { deliver: (transcript) => pasteIntoField(transcript) },
  "voice-note": { deliver: (transcript) => notesStore.create(transcript, "voice") },
  "remote-dictation": remoteDictationDestination,
}, "active-field", (result) => {
  history.recordLater(result);
  if (result.outcome === "success") {
    usage.recordLater({ name: "destination_used", destination: result.destination });
  }
});
const DESTINATION_OPTIONS: readonly SelectOption[] = [
  { value: "active-field", label: "Active field" },
  { value: "voice-note", label: "Voice note" },
  { value: "remote-dictation", label: "Remote Dictation" },
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
        case "remote-dictation": return { label: "Sending…", enabled: false };
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
        case "remote-dictation": return "Sending";
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

function AndroidRemoteDictationToggle({ settingsReady }: { settingsReady: boolean }) {
  const [enabled, setEnabled] = useState(() => loadRemoteDictation());
  useEffect(() => {
    setEnabled(loadRemoteDictation());
  }, [settingsReady]);
  return (
    <section aria-labelledby="remote-dictation-heading">
      <h2 id="remote-dictation-heading">On this phone</h2>
      <Toggle
        label="Allow remote dictation"
        description="Allow my other Personal Voice devices to insert dictated text into this device's active field."
        checked={enabled}
        onChange={(next) => {
          saveRemoteDictation(next);
          setEnabled(next);
        }}
      />
    </section>
  );
}

/** Shortcuts and on-device behavior. Account devices stay in the shared devices panel. */
function DeviceControls({
  platform,
  settingsReady,
}: {
  platform: AppPlatform;
  /** False until this install's device record is the one load/save will use. */
  settingsReady: boolean;
}) {
  switch (platform.platform) {
    case "windows":
      return (
        <>
          <section aria-labelledby="trigger-heading">
            <Tooltip content="Saved on this PC. Not copied to your phone.">
              <h2 id="trigger-heading">Keybindings</h2>
            </Tooltip>
            {settingsReady
              ? <PushToTalkShortcutPanel platform={platform} />
              : <p className="hint">Loading saved bindings…</p>}
          </section>
          <section aria-labelledby="behavior-heading">
            <h2 id="behavior-heading">On this PC</h2>
            <WindowsBehaviorPanel
              platform={platform}
              settingsReady={settingsReady}
            />
          </section>
        </>
      );
    case "android":
      return (
        <>
          <section aria-labelledby="trigger-heading">
            <h2 id="trigger-heading">Floating mic</h2>
            <p className="hint">
              Stays on over other apps until you turn it off. Start with phone restores it after reboot.
            </p>
            <AndroidSetupPanel />
          </section>
          <AndroidRemoteDictationToggle settingsReady={settingsReady} />
        </>
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
  const notes = useNotes(notesStore, auth.userId);
  const deviceSnapshot = useDevices(devices, auth.userId);
  const handoffSnapshot = useHandoffs(handoffs, auth.userId);
  const historySnapshot = useDictationHistory(history, auth.userId, sync.data.settings.cloudDictationHistory);
  const usageSnapshot = useUsage(usage);
  const [destination, setDestination] = useState<TranscriptDestinationId>(destinations.selected);
  const [section, setSection] = useState<AppSection>("dictation");
  useHandoffAlerts(
    handoffs,
    auth.userId,
    platform.platform === "windows",
    (text) => pasteReceived(text),
    () => setSection("handoffs"),
    () => { void platform.openSettings(); },
  );
  const remoteSnapshot = useRemoteReads(remoteReads, auth.userId);
  const computerSnapshot = useComputerActions(computerActions, auth.userId);
  const remoteDictationSnapshot = useRemoteDictation(remoteDictation, auth.userId);
  const assistantSnapshot = useAssistant(assistant);
  const assistantLibrarySnapshot = useAssistantLibrary(assistantLibrary);
  const assistantMemorySnapshot = useAssistantMemory(assistantMemory);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const mobileNav = useMobileNav();
  const [floatingControl, setFloatingControl] = useState(loadShowIndicator);
  const [entryPhase, setEntryPhase] = useState<"checking" | "wizard" | "app">("checking");
  const [profileEnabled, setProfileEnabled] = useState(true);
  const [autoRun, setAutoRun] = useState(true);
  const [autoUpdate, setAutoUpdate] = useState(() => loadAutoUpdate());
  const { snapshot, controller, paused } = useDictation(platform, createProvider, destinations, usage, () => {
    const data = personalSync.getSnapshot().data;
    return {
      locale: data.settings.language,
      terms: data.terms.filter((entry) => entry.enabled).map((entry) => entry.term),
    };
  }, microphone, (nextDestination) => {
    if (nextDestination !== "remote-dictation") {
      remoteDictationDestination.clearLock();
      remoteDictation.setActive(false);
      return;
    }
    const target = remoteDictation.lockSelectedTarget();
    remoteDictationDestination.lockTarget(target);
  });
  const { state, partial, transcript, error } = snapshot;
  const control = controlFor(state, destination);
  const page = sectionMeta(section);
  const signedIn = !!auth.email;
  const idle = state === "IDLE" || state === "ERROR";
  const updates = useUpdates(platform, { autoUpdate, busy: !idle });
  const assistantLive = assistantSnapshot.status === "CONNECTING" || assistantSnapshot.status === "READY" || assistantSnapshot.status === "RESPONDING";
  const dictationLive = state === "CONNECTING" || state === "LISTENING";
  const status = !auth.ready ? "Starting…" : !signedIn ? "Sign in to start dictating" : paused ? "Paused from the tray" : statusFor(state, destination);

  function chooseDestination(value: string) {
    if (value !== "active-field" && value !== "voice-note" && value !== "remote-dictation") return;
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
    canDictate: () => microphone.heldBy() !== "assistant",
    assistant: assistantSnapshot,
    assistantController: assistant,
    remoteTargetId: remoteDictationSnapshot.targetDeviceId,
    remoteTargetLabel: remoteDictationSnapshot.targetLabel,
    remoteTargetPlatform: remoteDictationSnapshot.targetPlatform,
    remoteTargetKind: remoteDictationSnapshot.targetKind,
    remoteTargetOnline: remoteDictationSnapshot.targetOnline,
    remoteTargetCount: remoteDictationSnapshot.targetCount,
    remoteDictationActive: remoteDictationSnapshot.active,
    remoteNotice: remoteDictationSnapshot.notice,
    remoteTipEpoch: remoteDictationSnapshot.tipEpoch,
    onCycleRemoteTarget: () => { remoteDictation.cycleTarget(); },
    onLockRemoteTarget: (targetId) => {
      const target = remoteDictation.lockTarget(targetId);
      remoteDictationDestination.lockTarget(target);
      return target;
    },
    onRemoteDictationEnded: () => {
      remoteDictation.setActive(false);
      remoteDictationDestination.clearLock();
    },
  });

  // Bind before the keybinding panel's first read. Child state initializers run during this
  // render, and the effect below runs only after that, which used to load the signed-out copy
  // and then save it over this device's bindings.
  const settingsDeviceId = !auth.ready
    ? undefined
    : auth.userId
      ? localDeviceId(localStorage, auth.userId, createId)
      : null;
  if (settingsDeviceId !== undefined) bindDeviceSettings(settingsDeviceId);
  const showFloating = settingsDeviceId !== undefined ? loadShowIndicator() : floatingControl;
  const { readiness, refresh: refreshSetup, markMicrophoneGranted } = useDeviceSetup(platform.platform, showFloating);

  const personalToday = localDayKey(new Date());
  const personalDevice = deviceSnapshot.devices.find((device) => device.id === deviceSnapshot.currentDeviceId);
  const personalFacts = profileFacts(
    mergeUsageDays(
      usageSnapshot.remote.filter((row) => row.epoch === usageSnapshot.epoch),
      usageSnapshot.days,
      settingsDeviceId ?? "",
    ).filter((row) => row.epoch === usageSnapshot.epoch),
    deviceSnapshot.devices.map((device) => ({ id: device.id, name: device.name, platform: device.platform })),
    personalToday,
  );
  const personalDeviceName = personalDevice?.name ?? "This device";
  const personalPlatform = personalDevice?.platform ?? platform.platform;
  const personalBody = personalContextBody({
    deviceName: personalDeviceName,
    platform: personalPlatform,
    profileEnabled,
    facts: profileEnabled ? personalFacts : [],
  });
  const personalDeviceLine = personalBody.split("\n")[0] ?? "";

  useEffect(() => {
    assistant.setPersonalContext(personalBody);
  }, [personalBody]);

  useEffect(() => {
    assistantLibrary.setDeviceLabel((id) => deviceSnapshot.devices.find((device) => device.id === id)?.name ?? null);
  }, [deviceSnapshot.devices]);

  useEffect(() => {
    if (settingsDeviceId === undefined) return;
    bindDeviceSettings(settingsDeviceId);
    const next = loadDestination();
    destinations.select(next);
    setDestination(next);
    setFloatingControl(loadShowIndicator());
    setProfileEnabled(loadAssistantProfile());
    const auto = loadAssistantAutoRun();
    setAutoRun(auto);
    assistant.setAutoRun(auto);
    setAutoUpdate(loadAutoUpdate());
  }, [settingsDeviceId]);

  useEffect(() => {
    if (!auth.email) {
      setEntryPhase("checking");
      return;
    }
    if (!readiness.known) return;
    setEntryPhase((current) => {
      if (current !== "checking") return current;
      if (onboardingDismissed(sessionStorage) || isDeviceReady(readiness)) return "app";
      return "wizard";
    });
  }, [auth.email, readiness]);

  // Warm one token so the first press doesn't wait on it; drop it when the account changes.
  useEffect(() => {
    tokens.clear();
    assistantTokens.clear();
    assistant.end();
    assistant.clearAccountContext();
    void assistantLibrary.setUser(auth.userId);
    void assistantMemory.setUser(auth.userId);
    accountUserId = auth.userId;
    computerActions.userId = auth.userId;
    if (auth.email) tokens.prefetch();
  }, [auth.email, auth.userId]);

  useEffect(() => {
    usage.setEnabled(sync.data.settings.usageIntelligence);
  }, [sync.data.settings.usageIntelligence]);

  useEffect(() => {
    assistantMemory.setLearning(sync.data.settings.assistantMemoryLearning);
  }, [sync.data.settings.assistantMemoryLearning]);

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

  const signedInRef = useRef(signedIn);
  signedInRef.current = signedIn;

  useEffect(() => {
    let stop = () => {};
    void platform.onShowFloatingControl(() => {
      saveShowIndicator(true);
      setFloatingControl(true);
    }).then((unlisten) => { stop = unlisten; });
    return () => stop();
  }, []);

  useEffect(() => {
    let stop = () => {};
    void platform.onPushToTalk((event) => {
      if (event.event !== "toggle-assistant") return;
      const intent = overlayAssistantIntent(overlayAssistantFrom(assistant.getSnapshot().status));
      if (intent === "end") assistant.end();
      else if (signedInRef.current) assistant.start();
    }).then((unlisten) => { stop = unlisten; });
    return () => stop();
  }, []);

  function onControl() {
    switch (state) {
      case "IDLE":
        if (microphone.heldBy() === "assistant") return;
        usage.armTrigger("ui-button");
        try {
          if (destination === "remote-dictation") {
            const target = remoteDictation.lockSelectedTarget();
            remoteDictationDestination.lockTarget(target);
          } else {
            remoteDictationDestination.clearLock();
            remoteDictation.setActive(false);
          }
        } catch {
          return;
        }
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

  function selectSection(next: AppSection) {
    setSection(next);
    if (mobileNav) setDrawerOpen(false);
  }

  const microphoneOn = dictationLive || assistantLive;

  if (!auth.ready) return <BrandSplash label="Starting…" />;
  if (!signedIn) return <AuthGate auth={auth} />;
  if (!readiness.known || entryPhase === "checking") return <BrandSplash label="Checking this device…" />;
  if (entryPhase === "wizard") {
    return (
      <Onboarding
        readiness={readiness}
        sync={sync}
        refresh={refreshSetup}
        onMicrophoneGranted={markMicrophoneGranted}
        onShowFloatingControl={(show) => {
          saveShowIndicator(show);
          setFloatingControl(show);
        }}
        onCloudHistory={(enabled) => {
          personalSync.updateSettings({ cloudDictationHistory: enabled });
        }}
        onDismiss={() => {
          dismissOnboarding(sessionStorage);
          setEntryPhase("app");
        }}
        onEnter={() => setEntryPhase("app")}
      />
    );
  }

  return (
    <div className={mobileNav ? `app-shell is-mobile${drawerOpen ? " is-drawer-open" : ""}` : "app-shell"}>
      {mobileNav && (
        <header className="mobile-topbar">
          <button
            type="button"
            className="mobile-menu-btn"
            aria-label="Open menu"
            aria-expanded={drawerOpen}
            aria-controls="app-nav-drawer"
            onClick={() => setDrawerOpen(true)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
          <h2 id="page-title" className="mobile-topbar-title">{page.label}</h2>
          <span className="brand-mark-wrap" aria-hidden="true">
            <BrandMark />
            <span className={microphoneOn ? "mic-dot is-on" : "mic-dot is-off"} />
          </span>
        </header>
      )}
      {mobileNav && drawerOpen && (
        <button
          type="button"
          className="app-drawer-scrim"
          aria-label="Close menu"
          onClick={() => setDrawerOpen(false)}
        />
      )}
      <AppNav
        section={section}
        microphoneOn={microphoneOn}
        onSelect={selectSection}
        drawer={mobileNav}
        drawerOpen={drawerOpen}
        onDrawerClose={() => setDrawerOpen(false)}
        showFloatingControl={platform.platform === "windows" ? floatingControl : undefined}
        onFloatingControlChange={platform.platform === "windows"
          ? (show) => {
              saveShowIndicator(show);
              setFloatingControl(show);
            }
          : undefined}
      />
      <main className="app-main hide-scrollbar" aria-labelledby="page-title">
        <header className="page-header">
          <h2 id={mobileNav ? "page-title-desktop" : "page-title"} className="page-title">{page.label}</h2>
          {section === "dictation" && (
            <div className="page-header-actions">
              <p className="status" role="status">{status}</p>
            </div>
          )}
          {section === "dictionary" && <DictionaryToolbar store={personalSync} sync={sync} />}
          {section === "notes" && <NotesToolbar store={notesStore} snapshot={notes} />}
          {section === "handoffs" && <HandoffToolbar store={handoffs} snapshot={handoffSnapshot} />}
          {section === "assistant" && (
            <AssistantHeader
              controller={assistant}
              snapshot={assistantSnapshot}
              signedIn={signedIn}
              micBusy={dictationLive}
              library={assistantLibrarySnapshot}
              onProduce={() => { void assistantLibrary.produce(); }}
            />
          )}
          <div id="page-header-actions" className="page-header-actions" hidden={section !== "capture"} />
        </header>
        {computerSnapshot.approval && (
          <div className="assistant-action" role="region" aria-label="Remote action">
            <p>{computerSnapshot.approval.label}</p>
            <div className="assistant-action-buttons">
              <button type="button" className="secondary" onClick={() => { if (auth.userId) void computerActions.approve(auth.userId); }}>Allow once</button>
              <button type="button" className="secondary" onClick={() => { if (auth.userId) void computerActions.deny(auth.userId); }}>Don't allow</button>
            </div>
          </div>
        )}
        {remoteSnapshot.approval && (
          <div className="assistant-action" role="region" aria-label="Remote screenshot">
            <p>{remoteSnapshot.approval.label}</p>
            <div className="assistant-action-buttons">
              <button type="button" className="secondary" onClick={() => { if (auth.userId) void remoteReads.approve(auth.userId); }}>Allow once</button>
              <button type="button" className="secondary" onClick={() => { if (auth.userId) void remoteReads.deny(auth.userId); }}>Don't allow</button>
            </div>
          </div>
        )}
        {updates.offer && (
          <UpdateToast
            update={updates.offer}
            busy={!idle}
            onUpdate={updates.install}
            onDismiss={updates.dismissOffer}
          />
        )}

        <div className="panel-stack" hidden={section !== "dictation"}>
          <section aria-labelledby="page-title" className="page-panel dictations-live">
            <div className="dictation-controls">
              <SelectField
                label="Send to" value={destination} options={DESTINATION_OPTIONS}
                disabled={!idle} layout={mobileNav ? "stack" : "row"} onChange={chooseDestination}
              />
              <button type="button" className="record" disabled={!control.enabled || (state === "IDLE" && (!signedIn || assistantLive))} onClick={onControl}>
                {control.label}
              </button>
            </div>
            {destination === "remote-dictation" && (
              <p className="hint">
                {remoteDictationSnapshot.targetOnline && remoteDictationSnapshot.targetLabel
                  ? `Target: ${remoteDictationSnapshot.targetLabel}. Tap the Remote Dictation control to cycle.`
                  : "No other device is online for Remote Dictation."}
              </p>
            )}
            {error && <p className="error" role="alert">{error}</p>}
            <div className="transcript" aria-live="polite">
              {partial && <p className="partial">{partial}</p>}
              {!partial && transcript && <p>{transcript}</p>}
              {!partial && !transcript && <p className="placeholder">No transcript yet.</p>}
            </div>
          </section>
          <section aria-labelledby="history-heading" className="page-panel dictations-recent">
            <DictationHistoryPanel
              snapshot={historySnapshot}
              cloudSync={sync.data.settings.cloudDictationHistory}
              insertIntoActiveField={(text) => pasteReceived(text)}
              onInserted={() => usage.recordLater({ name: "history_inserted" })}
            />
          </section>
        </div>

        <div className="panel-stack" hidden={section !== "dictionary"}>
          <section aria-labelledby="page-title" className="page-panel">
            <DictionaryPanel store={personalSync} sync={sync} termUsage={dictionaryTermUsage(usageSnapshot, settingsDeviceId ?? null, sync.data.terms)} />
          </section>
        </div>

        <div className="panel-stack" hidden={section !== "capture"}>
          <section aria-labelledby="page-title" className="page-panel">
            <SelectionPanel
              platform={platform.platform}
              disabled={!idle}
              active={section === "capture"}
              capture={() => platform.captureSelection()}
              onCaptured={() => usage.recordLater({ name: "selection_captured" })}
              attached={assistantSnapshot.selection}
              onItem={(item) => {
                if (!item) {
                  assistant.detachSelection();
                  return;
                }
                const message = assistant.attachSelection(item);
                if (message) throw new Error(message);
              }}
            />
          </section>
        </div>

        <div className="panel-stack" hidden={section !== "notes"}>
          <section aria-labelledby="page-title" className="page-panel">
            <NotesPanel
              store={notesStore}
              snapshot={notes}
              attachedNoteIds={assistantSnapshot.notes.map((note) => note.id)}
              onAttachNote={(note) => assistant.attachNote({ id: note.id, text: note.text, createdAt: note.createdAt })}
              onDetachNote={(id) => assistant.detachNote(id)}
            />
          </section>
        </div>

        <div className="panel-stack" hidden={section !== "assistant"}>
          <section aria-labelledby="page-title" className="page-panel">
            <PersonalContextPanel
              enabled={profileEnabled}
              deviceLine={personalDeviceLine}
              facts={personalFacts}
            />
            <MemoryPanel
              store={assistantMemory}
              snapshot={assistantMemorySnapshot}
              signedIn={signedIn}
              learning={sync.data.settings.assistantMemoryLearning}
              onLearningChange={(enabled) => { personalSync.updateSettings({ assistantMemoryLearning: enabled }); }}
            />
            <AssistantPanel
              controller={assistant}
              snapshot={assistantSnapshot}
              signedIn={signedIn}
              library={assistantLibrarySnapshot}
              onNewThread={() => assistantLibrary.startThread()}
              onOpenThread={(id) => assistantLibrary.open(id)}
              onRenameThread={(id, title) => { void assistantLibrary.rename(id, title); }}
              onDeleteThread={(id) => { void assistantLibrary.delete(id); }}
              onRetrySave={() => assistantLibrary.retry()}
              onDismissRecovery={(id) => assistantLibrary.dismissRecovery(id)}
              onContinueTask={async () => {
                const current = deviceSnapshot.devices.find((device) => device.id === deviceSnapshot.currentDeviceId);
                if (!current) throw new Error("Sign in to continue Assistant on another device.");
                const built = buildContinuation({
                  turns: assistantSnapshot.turns.map((turn) => ({ role: turn.role, text: turn.text })),
                  selection: assistantSnapshot.selection
                    ? {
                        text: assistantSnapshot.selection.text,
                        ...(assistantSnapshot.selection.sourceApp ? { sourceApp: assistantSnapshot.selection.sourceApp } : {}),
                        capturedAt: assistantSnapshot.selection.capturedAt,
                      }
                    : null,
                  notes: assistantSnapshot.notes,
                  handoff: assistantSnapshot.handoff,
                  screen: assistantSnapshot.screen
                    ? {
                        source: assistantSnapshot.screen.source,
                        ...(assistantSnapshot.screen.sourceApp ? { sourceApp: assistantSnapshot.screen.sourceApp } : {}),
                        capturedAt: assistantSnapshot.screen.capturedAt,
                      }
                    : null,
                  sourceDeviceId: current.id,
                  sourceDeviceName: current.name,
                  createdAt: new Date().toISOString(),
                  conversationId: assistantLibrarySnapshot.currentId,
                });
                if (!built.ok) throw new Error(built.message);
                const target = handoffs.resolveTarget();
                await handoffs.send(built.text, "dictation", target.id);
              }}
              onCaptureScreen={async () => {
                try {
                  const native = await platform.captureSnapshot();
                  assistant.attachSnapshot(snapshotFromNative(native, encodeSnapshotJpeg));
                } catch (reason) {
                  assistant.reportSnapshotError(reason instanceof Error ? reason.message : "Couldn't capture the screen.");
                }
              }}
              onCaptureCamera={async () => {
                try {
                  await assistant.captureCameraPhoto("default");
                } catch (reason) {
                  assistant.reportCameraPhotoError(
                    reason instanceof Error ? reason.message : "Couldn't capture a camera photo.",
                  );
                }
              }}
            />
          </section>
        </div>

        <div className="panel-stack" hidden={section !== "handoffs"}>
          <section aria-labelledby="page-title" className="page-panel">
            <HandoffPanel
              store={handoffs}
              snapshot={handoffSnapshot}
              insertIntoActiveField={(text) => pasteReceived(text)}
              attachedHandoffId={assistantSnapshot.handoff?.id ?? null}
              onAttachHandoff={(handoff, sourceLabel) => assistant.attachHandoff({
                id: handoff.id,
                text: handoff.text,
                createdAt: handoff.createdAt,
                sourceLabel,
              })}
              onDetachHandoff={() => assistant.detachHandoff()}
              onOpenContinuation={(payload) => {
                if (payload.conversationId) {
                  assistantLibrary.open(payload.conversationId);
                  setSection("assistant");
                  return null;
                }
                assistantLibrary.startThread();
                const message = assistant.openContinuation(payload);
                if (!message) setSection("assistant");
                return message;
              }}
            />
          </section>
        </div>

        <div className="panel-stack is-scroll" hidden={section !== "devices"}>
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
          />
        </div>

        <div className="panel-stack is-scroll" hidden={section !== "settings"}>
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
            <UsagePanel store={personalSync} sync={sync} />
          </section>
          <section aria-labelledby="assistant-settings-heading">
            <h2 id="assistant-settings-heading">Assistant</h2>
            <Toggle
              label="Auto-run actions"
              description="Runs notes, handoffs, and other actions when you ask. Turn this off to confirm each one."
              checked={autoRun}
              onChange={(enabled) => {
                saveAssistantAutoRun(enabled);
                setAutoRun(enabled);
                assistant.setAutoRun(enabled);
              }}
            />
            <Toggle
              label="Use analytics profile"
              description="Sends dictation habits with Assistant. Turning this off keeps the facts on the Assistant page only."
              checked={profileEnabled}
              onChange={(enabled) => {
                saveAssistantProfile(enabled);
                setProfileEnabled(enabled);
              }}
            />
          </section>
          <section aria-labelledby="updates-heading">
            <h2 id="updates-heading">Updates</h2>
            <Toggle
              label="Auto-update"
              description="When Personal Voice opens, install updates automatically. Turn this off to choose when to update."
              checked={autoUpdate}
              onChange={(enabled) => {
                saveAutoUpdate(enabled);
                setAutoUpdate(enabled);
              }}
            />
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
