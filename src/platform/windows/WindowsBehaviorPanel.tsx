import { useEffect, useState } from "react";
import { Toggle } from "@/components/Toggle";
import type { WindowsPlatformAdapter } from "@/platform/windows/WindowsPlatformAdapter";

interface WindowsBehaviorPanelProps {
  platform: WindowsPlatformAdapter;
  showFloatingControl: boolean;
  onFloatingControlChange(show: boolean): void;
}

/** How the app sits on this PC. Startup is a Windows setting; the overlay is this device's preference. */
export function WindowsBehaviorPanel({
  platform,
  showFloatingControl,
  onFloatingControlChange,
}: WindowsBehaviorPanelProps) {
  const [launchAtLogin, setLaunchAtLogin] = useState<boolean | null>(null);
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
    onFloatingControlChange(show);
  }

  return (
    <>
      <Toggle
        label="Start with Windows"
        title="Opens in the tray when you sign in."
        checked={launchAtLogin ?? false} disabled={launchAtLogin === null}
        onChange={onLaunchAtLogin}
      />
      <Toggle
        label="Show floating control"
        title="A small button over other apps. Close and minimize keep the app in the tray; Quit is on the tray icon."
        checked={showFloatingControl}
        onChange={onShowIndicator}
      />
      {error && <p className="error" role="alert">{error}</p>}
    </>
  );
}
