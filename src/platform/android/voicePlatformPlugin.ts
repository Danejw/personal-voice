import { addPluginListener, invoke } from "@tauri-apps/api/core";
import type { InvokeArgs } from "@tauri-apps/api/core";

/** `VoicePlatformPlugin` in `src-tauri/gen/android/.../platform`, registered in `src-tauri/src/platform/android.rs`. */
const PLUGIN = "voice-platform";

/** Kotlin rejections arrive as `{ message }` objects; everything above this layer expects `Error`s. */
export function pluginErrorMessage(reason: unknown): string {
  if (typeof reason === "string" && reason) return reason;
  if (reason instanceof Error) return reason.message;
  const message = typeof reason === "object" && reason !== null ? (reason as { message?: unknown }).message : undefined;
  return typeof message === "string" && message ? message : "The Android platform call failed.";
}

export async function callPlugin<T = void>(command: string, args?: InvokeArgs): Promise<T> {
  try {
    return await invoke<T>(`plugin:${PLUGIN}|${command}`, args);
  } catch (reason) {
    throw new Error(pluginErrorMessage(reason), { cause: reason });
  }
}

export async function listenPlugin(event: string, handler: (payload: unknown) => void): Promise<() => void> {
  const listener = await addPluginListener(PLUGIN, event, handler);
  return () => void listener.unregister();
}
