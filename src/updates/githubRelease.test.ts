import { describe, expect, it } from "vitest";
import { apkAssetName, parseAndroidRelease, RELEASE_REPO } from "@/updates/githubRelease";
import { fetchLatestAndroidRelease } from "@/services/releaseService";

const download = (tag: string, name: string) => `https://github.com/${RELEASE_REPO}/releases/download/${tag}/${name}`;

function release(tag: string, assets: { name: string; browser_download_url: string }[], body = " Notes \n") {
  return { tag_name: tag, body, assets };
}

describe("parseAndroidRelease", () => {
  it("picks the APK for the release's own version", () => {
    const parsed = parseAndroidRelease(release("v0.3.0", [
      { name: "PersonalVoice-0.3.0-Setup.exe", browser_download_url: download("v0.3.0", "PersonalVoice-0.3.0-Setup.exe") },
      { name: apkAssetName("0.3.0"), browser_download_url: download("v0.3.0", apkAssetName("0.3.0")) },
    ]));
    expect(parsed).toEqual({ version: "0.3.0", notes: "Notes", apkUrl: download("v0.3.0", "PersonalVoice-0.3.0.apk") });
  });

  it("ignores a release without its APK, or with a stale one", () => {
    expect(parseAndroidRelease(release("v0.3.0", []))).toBeNull();
    expect(parseAndroidRelease(release("v0.3.0", [
      { name: apkAssetName("0.2.0"), browser_download_url: download("v0.3.0", apkAssetName("0.2.0")) },
    ]))).toBeNull();
  });

  it("only accepts this repo's release downloads", () => {
    expect(parseAndroidRelease(release("v0.3.0", [
      { name: apkAssetName("0.3.0"), browser_download_url: "https://example.com/PersonalVoice-0.3.0.apk" },
    ]))).toBeNull();
    expect(parseAndroidRelease(release("v0.3.0", [
      { name: apkAssetName("0.3.0"), browser_download_url: `http://github.com/${RELEASE_REPO}/releases/download/v0.3.0/x.apk` },
    ]))).toBeNull();
  });

  it("rejects malformed responses", () => {
    expect(parseAndroidRelease(null)).toBeNull();
    expect(parseAndroidRelease({ tag_name: "nightly", assets: [] })).toBeNull();
    expect(parseAndroidRelease({ tag_name: "v0.3.0", assets: "none" })).toBeNull();
  });
});

describe("fetchLatestAndroidRelease", () => {
  const respond = (status: number, body: unknown = {}) =>
    (() => Promise.resolve(new Response(JSON.stringify(body), { status }))) as typeof fetch;

  it("treats a repo without releases as up to date", async () => {
    await expect(fetchLatestAndroidRelease(respond(404))).resolves.toBeNull();
  });

  it("fails on other errors, so a manual check can say so", async () => {
    await expect(fetchLatestAndroidRelease(respond(503))).rejects.toThrow("503");
  });

  it("returns the parsed release", async () => {
    const body = release("v0.3.0", [{ name: apkAssetName("0.3.0"), browser_download_url: download("v0.3.0", apkAssetName("0.3.0")) }]);
    await expect(fetchLatestAndroidRelease(respond(200, body))).resolves.toMatchObject({ version: "0.3.0" });
  });
});
