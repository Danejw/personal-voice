import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));
const watched = [
  "src",
  "src-tauri/src",
  "src-tauri/gen/android/app/src/main/java",
  "src-tauri/gen/android/app/src/main/res/values",
];
const extensions = new Set([".ts", ".tsx", ".rs", ".kt", ".java", ".xml", ".css", ".html"]);

function sourceFiles(relative: string): string[] {
  const full = path.join(root, relative);
  if (!existsSync(full)) return [];
  return readdirSync(full, { withFileTypes: true }).flatMap((entry) => {
    const next = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) return sourceFiles(next);
    return entry.isFile() && extensions.has(path.extname(entry.name)) ? [next] : [];
  });
}

describe("canonical Notes terminology", () => {
  it("keeps retired user-facing terminology and Assistant tool names out of application sources", () => {
    const obsoleteLabel = /\bvoice\s+notes?\b/i;
    const obsoleteTool = /\b(?:create|list|edit|archive|restore|delete)_voice_note\b|\battach_image_to_voice_note\b/;
    const offenders = watched.flatMap((directory) => sourceFiles(directory))
      .filter((file) => !file.endsWith("/notesTerminology.test.ts"))
      .flatMap((file) => {
        const text = readFileSync(path.join(root, file), "utf8");
        return [...text.split("\n").entries()]
          .filter(([, line]) => obsoleteLabel.test(line) || obsoleteTool.test(line))
          .map(([index]) => `${file}:${index + 1}`);
      });
    expect(offenders).toEqual([]);
  });

  it("does not check generated Android JavaScript and CSS into source control", () => {
    const tracked = execFileSync("git", [
      "ls-files", "--", "src-tauri/gen/android/app/src/main/assets",
    ], { cwd: root, encoding: "utf8" }).trim();
    expect(tracked).toBe("");
  });
});
