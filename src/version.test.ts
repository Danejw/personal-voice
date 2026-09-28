import { readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { describe, expect, it } from "vitest";
import { RELEASE_REPO } from "@/updates/githubRelease";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("app version", () => {
  const version = (JSON.parse(read("package.json")) as { version: string }).version;

  it("is SemVer, so Tauri can derive the Android versionCode from it", () => {
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("comes from package.json for both the Windows installer and the Android APK", () => {
    const tauri = JSON.parse(read("src-tauri/tauri.conf.json")) as { version: string };
    expect(tauri.version).toBe("../package.json");
  });

  it("matches the Rust crate", () => {
    expect(read("src-tauri/Cargo.toml")).toMatch(new RegExp(`^version = "${version.replaceAll(".", "\\.")}"$`, "m"));
  });
});

describe("updater config", () => {
  const tauri = JSON.parse(read("src-tauri/tauri.conf.json")) as {
    bundle: { createUpdaterArtifacts?: boolean };
    plugins: { updater: { pubkey: string; endpoints: string[]; requireSignedVersion?: boolean } };
  };
  const { updater } = tauri.plugins;

  it("builds signed updater artifacts and only accepts signatures for the announced version", () => {
    expect(tauri.bundle.createUpdaterArtifacts).toBe(true);
    expect(updater.requireSignedVersion).toBe(true);
    expect(atob(updater.pubkey)).toMatch(/^untrusted comment: minisign public key/);
  });

  it("reads Windows updates from the same repo Android checks", () => {
    expect(updater.endpoints).toEqual([`https://github.com/${RELEASE_REPO}/releases/latest/download/latest.json`]);
  });
});
