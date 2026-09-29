import { Toggle } from "@/components/Toggle";
import type { SyncSnapshot } from "@/sync/PersonalSyncStore";
import type { PersonalSyncStore } from "@/sync/PersonalSyncStore";
import { readOnlyReason } from "@/sync/SyncStatus";
import type { UsageSnapshot } from "@/usage/usageEvents";

interface UsagePanelProps {
  store: PersonalSyncStore;
  sync: SyncSnapshot;
  usage: UsageSnapshot;
  onClear(): void;
}

/** Account opt-out. The counts themselves live on the Analytics page. */
export function UsagePanel({ store, sync, usage, onClear }: UsagePanelProps) {
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
      <p className="hint">Open Analytics to see words, devices, and shortcuts. Turning this off stops new counts.</p>
      <button type="button" className="secondary" disabled={!!readOnly} onClick={onClear}>Clear analytics</button>
      {usage.legacy && (
        <p className="hint">Earlier on this device: {usage.legacy.dictationCompleted} completed. Those counts are not in the dated totals.</p>
      )}
      {usage.error && <p className="error" role="alert">{usage.error}</p>}
    </>
  );
}
