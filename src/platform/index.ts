import { AndroidPlatformAdapter } from "@/platform/android/AndroidPlatformAdapter";
import { WindowsPlatformAdapter } from "@/platform/windows/WindowsPlatformAdapter";

/**
 * Both implement `PlatformAdapter`. Returning the concrete union lets platform-specific
 * settings panels narrow on `platform.platform` instead of adding stubs to the other OS.
 */
export type AppPlatform = WindowsPlatformAdapter | AndroidPlatformAdapter;

/** The single place a platform implementation is chosen. Android's WebView always reports "Android". */
export function createPlatformAdapter(): AppPlatform {
  return /\bAndroid\b/.test(navigator.userAgent) ? new AndroidPlatformAdapter() : new WindowsPlatformAdapter();
}
