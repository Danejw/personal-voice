import { useCallback, useEffect, useState } from "react";
import { androidSetup } from "@/platform/android/androidSetup";
import type { AndroidSetupStatus } from "@/platform/android/androidSetup";
import type { PlatformName } from "@/platform/PlatformAdapter";
import { watchMicrophone } from "@/platform/windows/microphonePermission";
import type { DeviceReadiness } from "@/onboarding/setupReady";

/** Reads Android permission status, or the Windows microphone permission, for onboarding. */
export function useDeviceSetup(platformName: PlatformName, floatingControl: boolean) {
  const [android, setAndroid] = useState<AndroidSetupStatus | null>(null);
  const [androidKnown, setAndroidKnown] = useState(platformName !== "android");
  const [microphoneGranted, setMicrophoneGranted] = useState(false);
  const [microphoneKnown, setMicrophoneKnown] = useState(platformName !== "windows");

  const refresh = useCallback(() => {
    if (platformName !== "android") return;
    androidSetup.status().then(
      (status) => {
        setAndroid(status);
        setAndroidKnown(true);
      },
      () => setAndroidKnown(true),
    );
  }, [platformName]);

  useEffect(() => {
    if (platformName !== "android") return;
    refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void androidSetup.onFloatingMicChanged(refresh).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisible);
      unlisten?.();
    };
  }, [platformName, refresh]);

  useEffect(() => {
    if (platformName !== "windows") return;
    let disposed = false;
    let unlisten = () => {};
    void watchMicrophone((granted) => {
      if (!disposed) {
        setMicrophoneGranted(granted);
        setMicrophoneKnown(true);
      }
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });
    return () => {
      disposed = true;
      unlisten();
    };
  }, [platformName]);

  const markMicrophoneGranted = useCallback(() => {
    setMicrophoneGranted(true);
    setMicrophoneKnown(true);
  }, []);

  const readiness: DeviceReadiness = {
    platform: platformName,
    known: platformName === "android" ? androidKnown : microphoneKnown,
    microphoneGranted,
    floatingControl,
    android,
  };

  return { readiness, refresh, markMicrophoneGranted };
}
