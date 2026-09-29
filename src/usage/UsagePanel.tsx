import { Toggle } from "@/components/Toggle";
import type { SyncSnapshot } from "@/sync/PersonalSyncStore";
import type { PersonalSyncStore } from "@/sync/PersonalSyncStore";
import { readOnlyReason } from "@/sync/SyncStatus";
import type { UsageSnapshot } from "@/usage/usageEvents";

interface UsagePanelProps {
  store: PersonalSyncStore;
  sync: SyncSnapshot;
  usage: UsageSnapshot;
}

/** Account opt-out plus this device's counters. Totals never leave the device. */
export function UsagePanel({ store, sync, usage }: UsagePanelProps) {
  const readOnly = readOnlyReason(sync.status);
  const { totals } = usage;
  return (
    <>
      {readOnly && <p className="hint">{readOnly}</p>}
      <Toggle
        label="Usage intelligence"
        title="Counts outcomes on this device. No transcripts or audio. The switch syncs; the counts stay here."
        checked={sync.data.settings.usageIntelligence}
        disabled={!!readOnly}
        onChange={(usageIntelligence) => store.updateSettings({ usageIntelligence })}
      />
      <p className="hint">
        {totals.dictation_completed} completed · {totals.dictation_failed} failed · {totals.voice_note_created} notes · {totals.handoff_created} handoffs · {totals.selection_captured} selections
      </p>
      {usage.error && <p className="error" role="alert">{usage.error}</p>}
    </>
  );
}
