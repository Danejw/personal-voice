import { SelectField } from "@/components/SelectField";
import { Toggle } from "@/components/Toggle";
import type { PersonalSyncStore, SyncSnapshot } from "@/sync/PersonalSyncStore";
import { readOnlyReason } from "@/sync/SyncStatus";
import { LANGUAGE_OPTIONS } from "@/sync/personalData";

interface TranscriptionSettingsPanelProps {
  store: PersonalSyncStore;
  sync: SyncSnapshot;
}

/** Account-wide transcription settings. They apply from the next utterance. */
export function TranscriptionSettingsPanel({ store, sync }: TranscriptionSettingsPanelProps) {
  const { settings } = sync.data;
  const readOnly = readOnlyReason(sync.status);
  const knownLanguage = LANGUAGE_OPTIONS.some((option) => option.value === settings.language);
  const languages = [
    { value: "", label: "Detect automatically" },
    ...(settings.language && !knownLanguage ? [{ value: settings.language, label: settings.language }] : []),
    ...LANGUAGE_OPTIONS,
  ];

  return (
    <>
      {readOnly && <p className="hint">{readOnly}</p>}
      <Toggle
        label="Smart transcription"
        title="Punctuation and cleanup. Off is word-for-word."
        checked={settings.smartTranscription} disabled={!!readOnly}
        onChange={(smartTranscription) => store.updateSettings({ smartTranscription })}
      />
      <SelectField
        label="Language" value={settings.language ?? ""} options={languages} disabled={!!readOnly}
        layout="stack"
        onChange={(language) => store.updateSettings({ language: language || null })}
      />
    </>
  );
}
