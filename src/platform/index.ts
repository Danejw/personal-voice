import { AndroidPlatformAdapter } from "@/platform/android/AndroidPlatformAdapter";
import type { PlatformAdapter } from "@/platform/PlatformAdapter";
import { WindowsPlatformAdapter } from "@/platform/windows/WindowsPlatformAdapter";

/** The single place a platform implementation is chosen. Android's WebView always reports "Android". */
export function createPlatformAdapter(): PlatformAdapter {
  return /\bAndroid\b/.test(navigator.userAgent) ? new AndroidPlatformAdapter() : new WindowsPlatformAdapter();
}
