import { useEffect, useState } from "react";
import { Toggle } from "@/components/Toggle";
import type { WindowsPlatformAdapter } from "@/platform/windows/WindowsPlatformAdapter";
import { loadShowIndicator, saveShowIndicator } from "@/settings/deviceSettings";

interface WindowsBehaviorPanelProps {
  platform: WindowsPlatformAdapter;
}

/** How the app sits on this PC: starting with Windows and the on-screen indicator. Not synced. */
export function WindowsBehaviorPanel({ platform }: WindowsBehaviorPanelProps) {
  const [launchAtLogin, setLaunchAtLogin] = useState<boolean | null>(null);
  const [showIndicator, setShowIndicator] = useState(loadShowIndicator);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    platform.getLaunchAtLogin().then(setLaunchAtLogin, (reason: unknown) => setError(String(reason)));
  }, [platform]);

  function onLaunchAtLogin(enabled: boolean) {
    setError(null);
    platform.setLaunchAtLogin(enabled).then(
      () => setLaunchAtLogin(enabled),
      (reason: unknown) => setError(`Couldn't change the startup setting. ${String(reason)}`),
    );
  }

  function onShowIndicator(show: boolean) {
    saveShowIndicator(show);
    setShowIndicator(show);
  }

  return (
    <>
      <Toggle
        label="Start with Windows"
        description="Opens in the tray when you sign in to Windows, ready to dictate."
        checked={launchAtLogin ?? false} disabled={launchAtLogin === null}
        onChange={onLaunchAtLogin}
      />
      <Toggle
        label="Show listening indicator"
        description="A small pill near the bottom of the screen while you dictate. Errors always show."
        checked={showIndicator}
        onChange={onShowIndicator}
      />
      {error && <p className="error" role="alert">{error}</p>}
    </>
  );
}
