import { Toggle } from "@/components/Toggle";
import type { SyncSnapshot } from "@/sync/PersonalSyncStore";
import type { PersonalSyncStore } from "@/sync/PersonalSyncStore";
import { readOnlyReason } from "@/sync/SyncStatus";

interface UsagePanelProps {
  store: PersonalSyncStore;
  sync: SyncSnapshot;
}

/** Account opt-out. The counts themselves live on the Analytics page. */
export function UsagePanel({ store, sync }: UsagePanelProps) {
  const readOnly = readOnlyReason(sync.status);
  return (
    <>
      {readOnly && <p className="hint">{readOnly}</p>}
      <Toggle
        label="Usage intelligence"
        title="Counts outcomes on this device. No transcripts or audio. The switch syncs; the counts stay with your account."
        checked={sync.data.settings.usageIntelligence}
        disabled={!!readOnly}
        onChange={(usageIntelligence) => store.updateSettings({ usageIntelligence })}
      />
    </>
  );
}
