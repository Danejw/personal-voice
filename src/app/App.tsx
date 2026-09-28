import { useEffect } from "react";
import { useDictation } from "@/app/useDictation";
import { AuthPanel } from "@/auth/AuthPanel";
import { useAuth } from "@/auth/useAuth";
import { createPlatformAdapter } from "@/platform";
import { AndroidSetupPanel } from "@/platform/android/AndroidSetupPanel";
import type { PlatformAdapter } from "@/platform/PlatformAdapter";
import { PushToTalkShortcutPanel } from "@/platform/windows/PushToTalkShortcutPanel";
import { fetchGeminiToken } from "@/services/geminiTokenService";
import { personalSyncApi } from "@/services/personalSyncService";
import { DictionaryPanel } from "@/sync/DictionaryPanel";
import { PersonalSyncStore } from "@/sync/PersonalSyncStore";
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
    case "IDLE": return { label: "Record", enabled: true };
    case "CONNECTING": return { label: "Stop", enabled: true };
    case "LISTENING": return { label: "Stop", enabled: true };
    case "FINALIZING": return { label: "Finishing…", enabled: false };
    case "INSERTING": return { label: "Inserting…", enabled: false };
    case "ERROR": return { label: "Try again", enabled: true };
    default: {
      const unhandled: never = state;
      throw new Error(`Unhandled voice state: ${String(unhandled)}`);
    }
  }
}

/** How dictation is triggered outside this window: a hotkey on Windows, the floating mic on Android. */
function TriggerSection({ platform }: { platform: PlatformAdapter }) {
  switch (platform.platform) {
    case "windows":
      return (
        <section aria-labelledby="trigger-heading">
          <h2 id="trigger-heading">Push-to-talk shortcut</h2>
          <PushToTalkShortcutPanel platform={platform} />
        </section>
      );
    case "android":
      return (
        <section aria-labelledby="trigger-heading">
          <h2 id="trigger-heading">Floating mic</h2>
          <AndroidSetupPanel />
        </section>
      );
    default: {
      const unhandled: never = platform.platform;
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
      <p className="eyebrow">PERSONAL VOICE</p>
      <h1>A place for your voice.</h1>
      <p className="intro">Speak in any app, and your words are typed where you&apos;re writing.</p>
      <section aria-labelledby="account-heading">
        <h2 id="account-heading">Account</h2>
        <AuthPanel auth={auth} disabled={!idle} />
      </section>
      <section aria-labelledby="status-heading">
        <h2 id="status-heading">Dictation</h2>
        <p className="status" role="status">{paused ? "PAUSED" : state}</p>
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
      <TriggerSection platform={platform} />
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
        {paused ? "Dictation paused from the tray" : state === "CONNECTING" || state === "LISTENING" ? "Microphone active" : "Microphone inactive"}
      </p>
    </main>
  );
}
