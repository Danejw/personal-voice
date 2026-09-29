import { useEffect, useState } from "react";
import { Toggle } from "@/components/Toggle";
import type { WindowsPlatformAdapter } from "@/platform/windows/WindowsPlatformAdapter";
import { loadRemoteComputerActions, loadRemoteReads, saveRemoteComputerActions, saveRemoteReads } from "@/settings/deviceSettings";

interface WindowsBehaviorPanelProps {
  platform: WindowsPlatformAdapter;
  showFloatingControl: boolean;
  settingsReady: boolean;
  onFloatingControlChange(show: boolean): void;
}

/** How the app sits on this PC. Startup is a Windows setting; the overlay is this device's preference. */
export function WindowsBehaviorPanel({
  platform,
  showFloatingControl,
  settingsReady,
  onFloatingControlChange,
}: WindowsBehaviorPanelProps) {
  const [launchAtLogin, setLaunchAtLogin] = useState<boolean | null>(null);
  const [remoteReads, setRemoteReads] = useState(false);
  const [remoteComputerActions, setRemoteComputerActions] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    platform.getLaunchAtLogin().then(setLaunchAtLogin, (reason: unknown) => setError(String(reason)));
  }, [platform]);

  useEffect(() => {
    setRemoteReads(loadRemoteReads());
    setRemoteComputerActions(loadRemoteComputerActions());
  }, [settingsReady]);

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
      <Toggle
        label="Allow remote reads"
        title="Other devices on this account can ask what window is open. A screenshot still needs Allow once. Nothing is clicked or typed."
        checked={remoteReads}
        onChange={(enabled) => {
          saveRemoteReads(enabled);
          setRemoteReads(enabled);
        }}
      />
      <Toggle
        label="Allow remote actions"
        title="Other devices on this account can ask this PC to open Notepad or Calculator, press Copy, Paste, Select all, Undo, Escape, or Tab, or insert text. Each one still needs confirmation. There is no shell."
        checked={remoteComputerActions}
        onChange={(enabled) => {
          saveRemoteComputerActions(enabled);
          setRemoteComputerActions(enabled);
        }}
      />
      {error && <p className="error" role="alert">{error}</p>}
    </>
  );
}
