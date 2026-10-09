import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { formatHandoffList, formatNoteList } from "@/assistant/accountTools";
import { buildContinuation, handoffDisplayText } from "@/assistant/continuation";
import { selectionPreview } from "@/assistant/selectionContext";
import { snapshotFromNative } from "@/assistant/snapshot";
import { encodeSnapshotJpeg } from "@/assistant/snapshotEncode";
import { AssistantConversationStore } from "@/assistant/AssistantConversationStore";
import { listPastConversations, readPastConversation } from "@/assistant/assistantConversationRecall";
import { supabaseAssistantFeed, supabaseMemoryFeed } from "@/assistant/assistantFeed";
import { AssistantMemoryStore } from "@/assistant/AssistantMemoryStore";
import { MemoryPanel } from "@/assistant/MemoryPanel";
import { MemoryGraphPanel } from "@/memory-graph/MemoryGraphPanel";
import { MemoryGraphErrorBoundary } from "@/memory-graph/MemoryGraphErrorBoundary";
import { useAssistantMemory } from "@/assistant/useAssistantMemory";
import { AssistantController } from "@/assistant/AssistantController";
import { inspectAssistantPointer, trackAssistantPointer } from "@/assistant/pointerAwareness";
import { bindAssistantCues } from "@/assistant/assistantCues";
import { AssistantPanel } from "@/assistant/AssistantPanel";
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
import { InsightsPanel, InsightsToolbar } from "@/insights/InsightsPanel";
import { InsightsStore } from "@/insights/InsightsStore";
import { useInsights } from "@/insights/useInsights";
import type { InsightCandidate } from "@/insights/insights";
import { isExistingCandidate, type ProposedCandidate } from "@/insights/candidateDedupe";
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
import { indexNextMemoryBatch, memorySearchToolText, searchPersonalMemory } from "@/services/personalMemoryService";
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
import { insightsApi } from "@/services/insightsService";
import { insightsAnalyzer } from "@/services/insightsAnalysisService";
import { noteOrganizerApi } from "@/services/noteOrganizerService";
import { snippetsApi } from "@/services/snippetsService";
import { transformProfilesApi } from "@/services/transformProfilesService";
import {
  bindDeviceSettings,
  loadAssistantAutoRun,
  loadAssistantRoutineAutoRun,
  saveAssistantRoutineAutoRun,
  loadAssistantProfile,
  loadAutoUpdate,
  loadDictationSounds,
  loadDestination,
  loadRemoteDictation,
  loadShowIndicator,
  loadTransformProfileId,
  saveAssistantAutoRun,
  saveAssistantProfile,
  saveAutoUpdate,
  saveDictationSounds,
  saveDestination,
  saveRemoteDictation,
  saveShowIndicator,
  saveTransformProfileId,
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
import { SnippetPanel, SnippetToolbar } from "@/snippets/SnippetPanel";
import { SnippetStore } from "@/snippets/SnippetStore";
import { useSnippets } from "@/snippets/useSnippets";
import { resolveSnippet } from "@/snippets/snippet";
import { TransformPanel, TransformToolbar } from "@/transforms/TransformPanel";
import { TransformStore } from "@/transforms/TransformStore";
import { useTransforms } from "@/transforms/useTransforms";
import { applyTransform } from "@/transforms/applyTransform";
import { transformById, transformOptions } from "@/transforms/transformProfile";
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
import { LiveFieldPreview } from "@/voice/session/LiveFieldPreview";
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
const liveFieldPreview = new LiveFieldPreview(platform);
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

// Development-only, explicit opt-in local tool trace capture for PR26 evaluation.
// Never installed in production and never sends/retains arguments, text, images or tokens.
if (import.meta.env.DEV && typeof window !== "undefined") {
  Object.defineProperty(window, "__pvToolEval", {
    configurable: true,
    value: {
      begin(scenarioId: string, modality: "typed" | "voice" = "typed") {
        assistant.setToolEvalTraceHandler(() => undefined);
        assistant.beginToolEvalCase({ scenarioId, modality, platform: platform.platform });
      },
      finish() {
        const trace = assistant.endToolEvalCase();
        assistant.setToolEvalTraceHandler(null);
        return trace;
      },
      cancel() {
        assistant.endToolEvalCase();
        assistant.setToolEvalTraceHandler(null);
      },
    },
  });
}

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
  (rows) => {
    assistant.setMemories(rows);
    if (rows.some((row) => row.status === "active")) {
      void indexNextMemoryBatch().catch(() => undefined);
    }
  },
  () => assistantLibrary.getSnapshot().currentId,
);
assistantLibrary.setOnUserSaved(() => {
  void assistantMemory.learn();
});
assistantMemory.setRemoteLearn(() => requestMemoryLearn());
assistant.setProducer(() => assistantLibrary.holdingLease());
const usage = new UsageStore(localStorage, platform.platform, () => new Date(), usageApi);
const personalSync = new PersonalSyncStore(personalSyncApi, localStorage, platform.platform);
const snippetStore = new SnippetStore(snippetsApi, localStorage);
const transformStore = new TransformStore(transformProfilesApi);
const insightsStore = new InsightsStore(insightsApi, insightsAnalyzer);
const notesStore = new NotesStore(
  notesApi,
  (userId) => localDeviceId(localStorage, userId, createId),
  (sourceType) => {
    if (sourceType === "voice") usage.recordLater({ name: "voice_note_created" });
  },
  noteOrganizerApi,
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
  editVoiceNote: (id, text) => notesStore.updateText(id, text),
  listSnippets: async () => {
    const snap = snippetStore.getSnapshot();
    if (snap.status === "signed-out") throw new Error("Sign in to read snippets.");
    return JSON.stringify({ status: snap.status, snippets: snap.snippets.map(({id, trigger, content, enabled}) => ({id, trigger, content, enabled})) }).slice(0, 8000);
  },
  createSnippet: (trigger, content) => snippetStore.create(trigger, content),
  updateSnippet: (id, trigger, content) => snippetStore.update(id, trigger, content),
  sendRemoteDictation: async (text, deviceName) => {
    const snap = remoteDictation.getSnapshot();
    const matches = snap.devices.filter((device) => device.name.toLocaleLowerCase() === deviceName.toLocaleLowerCase());
    if (matches.length !== 1) throw new Error("Choose an exact, unique online remote device name.");
    const selected = matches[0];
    if (!selected) throw new Error("Choose an exact, unique online remote device name.");
    const target = remoteDictation.lockTarget(selected.id);
    try {
      await remoteDictation.send(text, target);
    } finally {
      remoteDictation.setActive(false);
    }
  },
  createTransform: (name, instruction) => transformStore.create(name, instruction),
  addDictionaryWord: async (word) => {
    const error = personalSync.addTerm(word);
    if (error) throw new Error(error);
    await personalSync.settled();
  },
  readDashboard: async (kind) => {
    if (kind === "read_insights") {
      const snapshot = insightsStore.getSnapshot();
      return JSON.stringify({ status: snapshot.status, candidates: snapshot.candidates.slice(0, 40) });
    }
    const snapshot = usage.getSnapshot();
    return JSON.stringify({ days: snapshot.days.slice(-30), remote: snapshot.remote.slice(-30) });
  },
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
  searchMemory: async (query) => memorySearchToolText(query, await searchPersonalMemory(query)),
  listPastConversations: (query, cursor, count) => listPastConversations(assistantConversationsApi, accountUserId ?? "", query, cursor, count),
  readPastConversation: (conversationId) => readPastConversation(assistantConversationsApi, accountUserId ?? "", conversationId),
  checkPastConversation: async (conversationId) => {
    if (!accountUserId) throw new Error("Sign in to continue a conversation.");
    const conversation = await assistantConversationsApi.get(accountUserId, conversationId);
    return conversation.title;
  },
  continuePastConversation: (conversationId) => assistantLibrary.continueThread(conversationId),
  rememberMemory: (input) => assistantMemory.remember(input.kind, input.key, input.value),
  changeMemory: (input) => assistantMemory.change(input.key, input.value),
  forgetMemory: (key) => assistantMemory.forget(key),
  readRemote: async (kind, deviceName) => {
    if (!accountUserId) throw new Error("Sign in to check another device.");
    return remoteReads.ask(accountUserId, kind, deviceName);
  },
  captureScreen: async () => snapshotFromNative(await platform.captureSnapshot(), encodeSnapshotJpeg),
  inspectPointer: () => {
    if (platform.platform !== "windows" || !accountUserId) throw new Error("Pointer inspection is available only on signed-in Windows Assistant sessions.");
    return inspectAssistantPointer();
  },
  capturePointerTarget: async () => {
    if (platform.platform !== "windows" || !accountUserId) throw new Error("Pointed screenshots are available only on signed-in Windows Assistant sessions.");
    return snapshotFromNative(await invoke("capture_pointer_snapshot"), encodeSnapshotJpeg);
  },
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

async function transformFinalDictation(text: string): Promise<string> {
  const snippet = resolveSnippet(text, snippetStore.getSnapshot().snippets);
  if (snippet.matched) return snippet.text;

  const selectedId = loadTransformProfileId();
  if (!selectedId) return text;
  const profile = transformById(transformStore.getSnapshot().profiles, selectedId);
  if (!profile) throw new Error("The selected transform is unavailable. Open Transforms and choose another.");
  return applyTransform(text, profile);
}

const destinations = new TranscriptDestinationRouter({
  "active-field": { deliver: async (transcript) => {
    if (!await liveFieldPreview.commit(transcript)) await pasteIntoField(transcript);
  } },
  "voice-note": { deliver: (transcript) => notesStore.create(transcript, "voice") },
  "remote-dictation": remoteDictationDestination,
}, "active-field", (result) => {
  history.recordLater(result);
  if (result.outcome === "success") {
    usage.recordLater({ name: "destination_used", destination: result.destination });
  }
}, transformFinalDictation);
const DESTINATION_OPTIONS: readonly SelectOption[] = [
  { value: "active-field", label: "Active field" },
  { value: "voice-note", label: "Note" },
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
  const snippets = useSnippets(snippetStore, auth.userId);
  const transforms = useTransforms(transformStore, auth.userId);
  const deviceSnapshot = useDevices(devices, auth.userId);
  const handoffSnapshot = useHandoffs(handoffs, auth.userId);
  const historySnapshot = useDictationHistory(history, auth.userId, sync.data.settings.cloudDictationHistory);
  const usageSnapshot = useUsage(usage);
  const [destination, setDestination] = useState<TranscriptDestinationId>(destinations.selected);
  const [dictationTransformId, setDictationTransformId] = useState<string | null>(() => loadTransformProfileId());
  const [section, setSection] = useState<AppSection>("dictation");
  const insightsSnapshot = useInsights(insightsStore, auth.userId, section === "insights");
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
  const [routineAutoRun, setRoutineAutoRun] = useState(false);
  const [autoUpdate, setAutoUpdate] = useState(() => loadAutoUpdate());
  const [dictationSounds, setDictationSounds] = useState(() => loadDictationSounds());
  const voiceSoundsRef = useRef(dictationSounds);
  voiceSoundsRef.current = dictationSounds;
  useEffect(() => bindAssistantCues(assistant, platform, () => voiceSoundsRef.current), []);
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
  }, liveFieldPreview, () => {
    // Release only stops recording. Keep the utterance target through FINALIZING
    // and clear it only after delivery, cancellation, or failure has settled.
    remoteDictation.setActive(false);
    remoteDictationDestination.clearLock();
  }, dictationSounds);
  const { state, partial, transcript, error } = snapshot;
  const control = controlFor(state, destination);
  const page = sectionMeta(section);
  const signedIn = !!auth.email;
  const idle = state === "IDLE" || state === "ERROR";
  const updates = useUpdates(platform, { autoUpdate, busy: !idle });
  const assistantLive = assistantSnapshot.status === "CONNECTING" || assistantSnapshot.status === "READY" || assistantSnapshot.status === "RESPONDING";
  const dictationLive = state === "CONNECTING" || state === "LISTENING";
  useEffect(() => {
    if (!signedIn || platform.platform !== "windows" || !assistantLive) return;
    return trackAssistantPointer();
  }, [assistantLive, platform.platform, signedIn]);
  const availableTransforms = transformOptions(transforms.profiles);
  const selectedDictationTransform = transformById(transforms.profiles, dictationTransformId);
  const dictationTransformOptions: readonly SelectOption[] = [
    { value: "", label: "None" },
    ...availableTransforms.map((profile) => ({ value: profile.id, label: profile.name })),
  ];
  const status = !auth.ready ? "Starting…" : !signedIn ? "Sign in to start dictating" : paused ? "Paused from the tray" : statusFor(state, destination);

  function chooseDestination(value: string) {
    if (value !== "active-field" && value !== "voice-note" && value !== "remote-dictation") return;
    destinations.select(value);
    setDestination(value);
    saveDestination(value);
  }

  function chooseDictationTransform(value: string) {
    if (value && !transformById(transforms.profiles, value)) return;
    const next = value || null;
    setDictationTransformId(next);
    saveTransformProfileId(next);
  }

  function insightValue(candidate: InsightCandidate, key: string): string {
    const value = candidate.payload[key];
    return typeof value === "string" ? value.trim() : "";
  }

  async function acceptInsightCandidate(candidate: InsightCandidate): Promise<void> {
    const proposed: ProposedCandidate = {
      kind: candidate.kind,
      title: candidate.title,
      payload: candidate.payload,
      evidenceCount: candidate.evidenceCount,
      confidence: candidate.confidence,
      reason: candidate.reason,
    };
    const alreadyExists = isExistingCandidate(proposed, {
      dictionary: sync.data.terms,
      snippets: snippets.snippets,
      transforms: availableTransforms,
      memories: assistantMemorySnapshot.memories,
      seenFingerprints: new Set(),
    });
    if (alreadyExists) {
      await insightsStore.setCandidateStatus(candidate.id, "duplicate");
      throw new Error("That suggestion already exists, so it was removed from Insights.");
    }

    switch (candidate.kind) {
      case "dictionary": {
        const problem = personalSync.addTerm(insightValue(candidate, "term"));
        if (problem) throw new Error(problem);
        await personalSync.settled();
        const syncProblem = personalSync.getSnapshot().error;
        if (syncProblem) throw new Error(syncProblem);
        return;
      }
      case "snippet":
        await snippetStore.create(insightValue(candidate, "trigger"), insightValue(candidate, "content"));
        return;
      case "transform":
        await transformStore.create(insightValue(candidate, "name"), insightValue(candidate, "instruction"));
        return;
      case "memory": {
        const rawKind = insightValue(candidate, "kind");
        const kind = rawKind === "fact" ? "fact" : "preference";
        await assistantMemory.remember(kind, insightValue(candidate, "key"), insightValue(candidate, "value"));
        return;
      }
      default: {
        const unhandled: never = candidate.kind;
        return unhandled;
      }
    }
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
    onAssistantStart: () => assistantLibrary.produce(),
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
    assistant.setDeviceContext({
      platform: platform.platform,
      otherDeviceCount: deviceSnapshot.status === "synced"
        ? deviceSnapshot.devices.filter((device) => device.id !== deviceSnapshot.currentDeviceId).length
        : null,
    });
  }, [deviceSnapshot.status, deviceSnapshot.devices, deviceSnapshot.currentDeviceId]);

  useEffect(() => {
    if (settingsDeviceId === undefined) return;
    bindDeviceSettings(settingsDeviceId);
    const next = loadDestination();
    destinations.select(next);
    setDestination(next);
    setDictationTransformId(loadTransformProfileId());
    setFloatingControl(loadShowIndicator());
    setProfileEnabled(loadAssistantProfile());
    const auto = loadAssistantAutoRun();
    setAutoRun(auto);
    assistant.setAutoRun(auto);
    const routine = loadAssistantRoutineAutoRun();
    setRoutineAutoRun(routine);
    assistant.setRoutineAccessibilityAutoRun(routine);
    setAutoUpdate(loadAutoUpdate());
    setDictationSounds(loadDictationSounds());
  }, [settingsDeviceId]);

  useEffect(() => {
    if (transforms.status !== "synced" || !dictationTransformId) return;
    if (transformById(transforms.profiles, dictationTransformId)) return;
    setDictationTransformId(null);
    saveTransformProfileId(null);
  }, [transforms.status, transforms.profiles, dictationTransformId]);

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
      else if (signedInRef.current) void assistantLibrary.produce();
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
      <main className={section === "assistant" ? "app-main hide-scrollbar is-assistant-page" : "app-main hide-scrollbar"} aria-labelledby="page-title">
        <header className={section === "assistant" ? "page-header assistant-page-header" : "page-header"}>
          <h2 id={mobileNav ? "page-title-desktop" : "page-title"} className="page-title">{page.label}</h2>
          {section === "dictation" && (
            <div className="page-header-actions">
              <p className="status" role="status">{status}</p>
            </div>
          )}
          {section === "dictionary" && <DictionaryToolbar store={personalSync} sync={sync} />}
          {section === "notes" && <NotesToolbar store={notesStore} snapshot={notes} />}
          {section === "handoffs" && <HandoffToolbar store={handoffs} snapshot={handoffSnapshot} />}
          {section === "snippets" && <SnippetToolbar store={snippetStore} snapshot={snippets} />}
          {section === "transforms" && <TransformToolbar store={transformStore} snapshot={transforms} />}
          {section === "insights" && <InsightsToolbar store={insightsStore} snapshot={insightsSnapshot} />}
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
              <SelectField
                label="Transform"
                value={selectedDictationTransform?.id ?? ""}
                options={dictationTransformOptions}
                disabled={!idle || transforms.status !== "synced"}
                layout={mobileNav ? "stack" : "row"}
                onChange={chooseDictationTransform}
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
              transformProfiles={availableTransforms}
              saveAsNote={(text) => notesStore.create(text, "manual")}
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
              transformProfiles={availableTransforms}
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
              transformProfiles={availableTransforms}
            />
          </section>
        </div>

        <div className="panel-stack" hidden={section !== "snippets"}>
          <section aria-labelledby="page-title" className="page-panel">
            <SnippetPanel store={snippetStore} snapshot={snippets} />
          </section>
        </div>

        <div className="panel-stack" hidden={section !== "transforms"}>
          <section aria-labelledby="page-title" className="page-panel">
            <TransformPanel store={transformStore} snapshot={transforms} />
          </section>
        </div>

        {section === "memory-graph" && (
          <div className="panel-stack memory-graph-section">
            <section aria-label="Interactive personal memory network" className="page-panel">
              <MemoryGraphErrorBoundary onBack={() => setSection("assistant")}>
                <MemoryGraphPanel
                  userId={auth.userId}
                  active={section === "memory-graph"}
                  onNavigate={(next) => setSection(next)}
                />
              </MemoryGraphErrorBoundary>
            </section>
          </div>
        )}

        <div className="panel-stack assistant-workspace-stack" hidden={section !== "assistant"}>
          <section aria-label="Assistant conversations" className="page-panel assistant-workspace-section">
            <AssistantPanel
              micBusy={dictationLive}
              onProduce={() => { void assistantLibrary.produce(); }}
              settingsContent={
                <div className="assistant-settings-content">
                  <div className="assistant-pane-intro">
                    <span className="assistant-eyebrow">PERSONALIZATION</span>
                    <h4>Assistant settings</h4>
                    <p>Control how your Assistant learns, searches saved content and uses context across devices.</p>
                  </div>
                  <MemoryPanel
                    store={assistantMemory}
                    snapshot={assistantMemorySnapshot}
                    signedIn={signedIn}
                    userId={auth.userId}
                    learning={sync.data.settings.assistantMemoryLearning}
                    onLearningChange={(enabled) => { personalSync.updateSettings({ assistantMemoryLearning: enabled }); }}
                  />
                  <PersonalContextPanel enabled={profileEnabled} deviceLine={personalDeviceLine} facts={personalFacts} />
                </div>
              }

              controller={assistant}
              snapshot={assistantSnapshot}
              signedIn={signedIn}
              library={assistantLibrarySnapshot}
              onNewThread={() => assistantLibrary.startThread()}
              onOpenThread={(id) => assistantLibrary.open(id)}
              onRenameThread={(id, title) => { void assistantLibrary.rename(id, title); }}
              onDeleteThread={(id) => { void assistantLibrary.delete(id); }}
              onRetrySave={() => assistantLibrary.retry()}
              onLoadOlder={() => { void assistantLibrary.loadOlder(); }}
              onRefreshThreads={() => { void assistantLibrary.catchUp(); }}
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
              transformProfiles={availableTransforms}
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
            <Toggle
              label="Voice sounds"
              description="Play the same subtle start and stop sounds for both Dictation and Assistant on this device."
              checked={dictationSounds}
              onChange={(enabled) => {
                saveDictationSounds(enabled);
                setDictationSounds(enabled);
              }}
            />
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
              label="Auto-run routine Windows controls"
              description="Skip repeated approval for focus, scroll, selection, window arrangement, and reversible UI operations. Editing, invoking buttons, sending images, and starting monitoring still require your approval. Requires Auto-run actions."
              checked={routineAutoRun}
              onChange={(enabled) => {
                saveAssistantRoutineAutoRun(enabled);
                setRoutineAutoRun(enabled);
                assistant.setRoutineAccessibilityAutoRun(enabled);
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

        <div className="panel-stack is-scroll" hidden={section !== "insights"}>
          <section aria-labelledby="page-title" className="page-panel">
            <InsightsPanel
              store={insightsStore}
              snapshot={insightsSnapshot}
              knowledge={{
                dictionary: sync.data.terms,
                snippets: snippets.snippets,
                transforms: availableTransforms,
                memories: assistantMemorySnapshot.memories,
              }}
              cloudHistoryEnabled={sync.data.settings.cloudDictationHistory}
              onEnableCloudHistory={() => {
                personalSync.updateSettings({ cloudDictationHistory: true });
              }}
              devices={deviceSnapshot.devices}
              usage={usageSnapshot}
              currentDeviceId={settingsDeviceId ?? null}
              onAccept={acceptInsightCandidate}
            />
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
