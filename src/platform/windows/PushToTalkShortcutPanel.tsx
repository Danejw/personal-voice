import { useEffect, useState } from "react";
import { SelectField } from "@/components/SelectField";
import type { PlatformAdapter } from "@/platform/PlatformAdapter";
import {
  loadPushToTalk, PUSH_TO_TALK_PRESETS, pushToTalkLabel, savePushToTalk,
} from "@/settings/pushToTalk";

interface PushToTalkShortcutPanelProps {
  platform: PlatformAdapter;
}

/** Windows push-to-talk key. Stored on this device only; it isn't synced. */
export function PushToTalkShortcutPanel({ platform }: PushToTalkShortcutPanelProps) {
  const [shortcut, setShortcut] = useState(loadPushToTalk);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    platform.setPushToTalkShortcut(shortcut).then(
      () => { savePushToTalk(shortcut); setError(null); },
      (reason: unknown) => setError(String(reason)),
    );
  }, [platform, shortcut]);

  return (
    <>
      <p className="hint">
        Hold <strong>{pushToTalkLabel(shortcut)}</strong> in any app, speak, and release. Press Esc while speaking to
        cancel. Closing this window keeps dictation running in the tray.
      </p>
      <SelectField label="Hold to dictate" value={shortcut} options={PUSH_TO_TALK_PRESETS} onChange={setShortcut} />
      {error && <p className="error" role="alert">{error}</p>}
    </>
  );
}
