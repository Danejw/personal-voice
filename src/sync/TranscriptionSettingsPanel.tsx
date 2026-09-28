import type { PersonalSyncStore, SyncSnapshot, SyncStatus } from "@/sync/PersonalSyncStore";
import { LANGUAGE_OPTIONS } from "@/sync/personalData";

interface TranscriptionSettingsPanelProps {
  store: PersonalSyncStore;
  sync: SyncSnapshot;
}

function statusLabel(status: SyncStatus): string {
  switch (status) {
    case "signed-out": return "Sign in to sync settings and dictionary.";
    case "loading": return "Syncing…";
    case "synced": return "Synced to your account.";
    case "offline": return "Offline.";
    default: {
      const unhandled: never = status;
      throw new Error(`Unhandled sync status: ${String(unhandled)}`);
    }
  }
}

/** Account-wide transcription settings. They apply from the next utterance. */
export function TranscriptionSettingsPanel({ store, sync }: TranscriptionSettingsPanelProps) {
  const { settings } = sync.data;
  const editable = sync.status === "synced";
  const knownLanguage = LANGUAGE_OPTIONS.some((option) => option.value === settings.language);

  return (
    <>
      <label className="toggle">
        <input
          type="checkbox" checked={settings.smartTranscription} disabled={!editable}
          onChange={(event) => store.updateSettings({ smartTranscription: event.target.checked })}
        />
        <span>
          Smart transcription
          <small>Punctuation, capitalization, and filler-word cleanup. Off gives a word-for-word transcript.</small>
        </span>
      </label>
      <label className="field">
        <span>Language</span>
        <select
          value={settings.language ?? ""} disabled={!editable}
          onChange={(event) => store.updateSettings({ language: event.target.value || null })}
        >
          <option value="">Detect automatically</option>
          {settings.language && !knownLanguage && <option value={settings.language}>{settings.language}</option>}
          {LANGUAGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      <div className="sync-status">
        <p role="status">{statusLabel(sync.status)}</p>
        {sync.status === "offline" && (
          <button type="button" className="secondary" onClick={() => void store.reload()}>Retry</button>
        )}
      </div>
      {sync.error && <p className="error" role="alert">{sync.error}</p>}
    </>
  );
}
