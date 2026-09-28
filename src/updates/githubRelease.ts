import { parseVersion } from "@/updates/version";

/**
 * Public repo whose GitHub Releases hold the installer, `latest.json`, and the APK.
 * `plugins.updater.endpoints` in `tauri.conf.json` must point at the same repo.
 */
export const RELEASE_REPO = "Danejw/personal-voice";
export const LATEST_RELEASE_API = `https://api.github.com/repos/${RELEASE_REPO}/releases/latest`;
const DOWNLOAD_PREFIX = `https://github.com/${RELEASE_REPO}/releases/download/`;

/** The published APK for the latest release. */
export interface AndroidRelease {
  version: string;
  notes: string;
  apkUrl: string;
}

/** Release workflow asset name; see `.github/workflows/release.yml`. */
export function apkAssetName(version: string): string {
  return `PersonalVoice-${version}.apk`;
}

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;
}

/**
 * Picks the signed APK out of GitHub's "latest release" response. `null` if the release has
 * no APK for its own version, or its download link isn't this repo's release download.
 */
export function parseAndroidRelease(body: unknown): AndroidRelease | null {
  const tag = field(body, "tag_name");
  const version = typeof tag === "string" ? parseVersion(tag)?.join(".") : undefined;
  if (!version) return null;
  const assets = field(body, "assets");
  if (!Array.isArray(assets)) return null;
  const apk = assets.find((asset) => field(asset, "name") === apkAssetName(version));
  const apkUrl = field(apk, "browser_download_url");
  if (typeof apkUrl !== "string" || !apkUrl.startsWith(DOWNLOAD_PREFIX)) return null;
  const notes = field(body, "body");
  return { version, notes: typeof notes === "string" ? notes.trim() : "", apkUrl };
}
