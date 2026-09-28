import { LATEST_RELEASE_API, parseAndroidRelease } from "@/updates/githubRelease";
import type { AndroidRelease } from "@/updates/githubRelease";

/**
 * The latest published release's APK, or `null` when there's no release yet or it has no APK.
 * Unauthenticated: the repo is public and this runs at most a few times a day.
 */
export async function fetchLatestAndroidRelease(fetchImpl: typeof fetch = fetch): Promise<AndroidRelease | null> {
  const response = await fetchImpl(LATEST_RELEASE_API, { headers: { Accept: "application/vnd.github+json" } });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub answered ${response.status}.`);
  return parseAndroidRelease(await response.json());
}
