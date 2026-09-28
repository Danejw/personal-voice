import { useEffect } from "react";
import { useDictation } from "@/app/useDictation";
import { AuthPanel } from "@/auth/AuthPanel";
import { useAuth } from "@/auth/useAuth";
import { createPlatformAdapter } from "@/platform";
import type { AppPlatform } from "@/platform";
import { AndroidSetupPanel } from "@/platform/android/AndroidSetupPanel";
import { MicrophonePanel } from "@/platform/windows/MicrophonePanel";
import { PushToTalkShortcutPanel } from "@/platform/windows/PushToTalkShortcutPanel";
import { WindowsBehaviorPanel } from "@/platform/windows/WindowsBehaviorPanel";
import { fetchGeminiToken } from "@/services/geminiTokenService";
import { personalSyncApi } from "@/services/personalSyncService";
import { DictionaryPanel } from "@/sync/DictionaryPanel";
import { PersonalSyncStore } from "@/sync/PersonalSyncStore";
import { SyncStatus } from "@/sync/SyncStatus";
import { TranscriptionSettingsPanel } from "@/sync/TranscriptionSettingsPanel";
import { transcriptionPreferences } from "@/sync/personalData";
import { usePersonalSync } from "@/sync/usePersonalSync";
import { UpdatePanel } from "@/updates/UpdatePanel";
import { useUpdates } from "@/updates/useUpdates";
import { GeminiProvider, geminiConfigFrom } from "@/voice/provider/gemini/GeminiProvider";
import { GeminiTokenSource } from "@/voice/provider/gemini/GeminiTokenSource";
import type { VoiceState } from "@/voice/session/state";

const platform = createPlatformAdapter();
const tokens = new GeminiTokenSource(fetchGeminiToken);
const personalSync = new PersonalSyncStore(personalSyncApi, localStorage, platform.platform);

/** Read at press time, so a settings or dictionary change applies to the very next utterance. */
function createProvider(): GeminiProvider {
  return new GeminiProvider(tokens, geminiConfigFrom(transcriptionPreferences(personalSync.getSnapshot().data)));
}

/** Primary control label and whether pressing it does anything in this state. */
function controlFor(state: VoiceState): { label: string; enabled: boolean } {
  switch (state) {
    case "IDLE": return { label: "Test dictation", enabled: true };
    case "CONNECTING": return { label: "Stop", enabled: true };
    case "LISTENING": return { label: "Stop", enabled: true };
    case "FINALIZING": return { label: "Transcribing…", enabled: false };
    case "INSERTING": return { label: "Typing…", enabled: false };
    case "ERROR": return { label: "Try again", enabled: true };
    default: {
      const unhandled: never = state;
      throw new Error(`Unhandled voice state: ${String(unhandled)}`);
    }
  }
}

/** One word for where dictation is, in the user's terms rather than the state machine's. */
function statusFor(state: VoiceState): string {
  switch (state) {
    case "IDLE": return "Ready";
    case "CONNECTING":
    case "LISTENING": return "Listening";
    case "FINALIZING": return "Transcribing";
    case "INSERTING": return "Typing";
    case "ERROR": return "Something went wrong";
    default: {
      const unhandled: never = state;
      throw new Error(`Unhandled voice state: ${String(unhandled)}`);
    }
  }
}

/** How dictation is triggered and set up outside this window, per platform. */
function PlatformSections({ platform }: { platform: AppPlatform }) {
  switch (platform.platform) {
    case "windows":
      return (
        <>
          <section aria-labelledby="trigger-heading">
            <h2 id="trigger-heading">Push-to-talk</h2>
            <PushToTalkShortcutPanel platform={platform} />
            <MicrophonePanel />
          </section>
          <section aria-labelledby="behavior-heading">
            <h2 id="behavior-heading">On this PC</h2>
            <WindowsBehaviorPanel platform={platform} />
          </section>
        </>
      );
    case "android":
      return (
        <section aria-labelledby="trigger-heading">
          <h2 id="trigger-heading">Floating mic</h2>
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
  const { snapshot, controller, paused } = useDictation(platform, createProvider);
  const updates = useUpdates(platform);
  const { state, partial, transcript, error } = snapshot;
  const control = controlFor(state);
  const signedIn = !!auth.email;
  const idle = state === "IDLE" || state === "ERROR";
  const status = !auth.ready ? "Starting…" : !signedIn ? "Sign in to start dictating" : paused ? "Paused from the tray" : statusFor(state);

  // Warm one token so the first press doesn't wait on it; drop it when the account changes.
  useEffect(() => {
    tokens.clear();
    if (auth.email) tokens.prefetch();
  }, [auth.email]);

  function onControl() {
    switch (state) {
      case "IDLE": void controller.start(createProvider()); return;
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
    <main>
      <header className="app-header">
        <h1>Personal Voice</h1>
        <p className="intro">Speak in any app, and your words are typed where you&apos;re writing.</p>
      </header>
      <section aria-labelledby="status-heading">
        <h2 id="status-heading">Dictation</h2>
        <p className="status" role="status">{status}</p>
        <button type="button" className="record" disabled={!control.enabled || (state === "IDLE" && !signedIn)} onClick={onControl}>
          {control.label}
        </button>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="transcript" aria-live="polite">
          {partial && <p className="partial">{partial}</p>}
          {!partial && transcript && <p>{transcript}</p>}
          {!partial && !transcript && <p className="placeholder">Your last transcript will appear here.</p>}
        </div>
      </section>
      <section aria-labelledby="account-heading">
        <h2 id="account-heading">Account</h2>
        <AuthPanel auth={auth} disabled={!idle} />
        {signedIn && <SyncStatus store={personalSync} sync={sync} />}
      </section>
      <PlatformSections platform={platform} />
      <section aria-labelledby="transcription-heading">
        <h2 id="transcription-heading">Transcription</h2>
        <TranscriptionSettingsPanel store={personalSync} sync={sync} />
      </section>
      <section aria-labelledby="dictionary-heading">
        <h2 id="dictionary-heading">Personal dictionary</h2>
        <DictionaryPanel store={personalSync} sync={sync} />
      </section>
      <section aria-labelledby="updates-heading">
        <h2 id="updates-heading">Updates</h2>
        <UpdatePanel updates={updates} busy={!idle} />
      </section>
      <p className="footnote">
        {state === "CONNECTING" || state === "LISTENING" ? "Microphone on" : "Microphone off"}
      </p>
    </main>
  );
}
