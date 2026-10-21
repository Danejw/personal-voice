import { describe, expect, it } from "vitest";
import {
  classifyClipboardText,
  clipboardIngestPlan,
  clipboardLooksSensitive,
  clipboardOverflowIds,
  collapseClipboardHashes,
  DEFAULT_CLIPBOARD_PREFERENCES,
  MAX_CLIPBOARD_ENTRIES,
  parseClipboardChange,
  rankClipboardEntries,
  reconcileClipboard,
  searchClipboardEntries,
  type ClipboardEntry,
} from "@/clipboard/clipboardEntry";

function entry(patch: Partial<ClipboardEntry> & Pick<ClipboardEntry, "id" | "contentHash">): ClipboardEntry {
  return {
    kind: "text",
    text: patch.id,
    sourceApp: null,
    sourceProcess: null,
    sourceDeviceId: null,
    pinned: false,
    copyCount: 1,
    lastCopiedAt: null,
    createdAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-20T00:00:00.000Z",
    deletedAt: null,
    imagePath: null,
    visibility: "account",
    pending: "none",
    ...patch,
  };
}

describe("clipboard text", () => {
  it("classifies a bare URL and ordinary text", () => {
    expect(classifyClipboardText("  https://example.com/a  ")).toEqual({
      ok: true,
      kind: "url",
      text: "https://example.com/a",
    });
    expect(classifyClipboardText("see https://example.com")).toMatchObject({ ok: true, kind: "text" });
    expect(classifyClipboardText("   ")).toEqual({ ok: false, reason: "empty" });
  });

  it("skips an unchanged latest value and reuses an older copy", () => {
    const entries = [
      entry({ id: "new", contentHash: "b", updatedAt: "2026-10-20T02:00:00.000Z" }),
      entry({ id: "old", contentHash: "a", updatedAt: "2026-10-20T01:00:00.000Z" }),
    ];
    expect(clipboardIngestPlan(entries, "b")).toBe("skip");
    expect(clipboardIngestPlan(entries, "a")).toBe("bump");
    expect(clipboardIngestPlan(entries, "c")).toBe("create");
  });

  it("ranks pinned and recently copied entries first and searches the text", () => {
    const entries = [
      entry({ id: "plain", contentHash: "a", text: "alpha", updatedAt: "2026-10-20T03:00:00.000Z" }),
      entry({ id: "pin", contentHash: "b", text: "beta", pinned: true, updatedAt: "2026-10-20T01:00:00.000Z" }),
      entry({ id: "used", contentHash: "c", text: "gamma", lastCopiedAt: "2026-10-20T04:00:00.000Z" }),
    ];
    expect(rankClipboardEntries(entries).map((item) => item.id)).toEqual(["pin", "used", "plain"]);
    expect(searchClipboardEntries(entries, "GAM").map((item) => item.id)).toEqual(["used"]);
  });

  it("only skips copies Windows marked as excluded, whatever app they came from", () => {
    expect(DEFAULT_CLIPBOARD_PREFERENCES).toEqual({
      captureEnabled: true,
      syncEnabled: true,
      paused: false,
      imagesEnabled: true,
    });
    expect(clipboardLooksSensitive({
      text: "hunter2",
      sourceApp: "Notepad",
      sourceProcess: "notepad.exe",
      excludedByOs: true,
    })).toBe(true);
    expect(clipboardLooksSensitive({
      text: "hunter2",
      sourceApp: "Vault",
      sourceProcess: "1password.exe",
      excludedByOs: false,
    })).toBe(false);
    expect(clipboardLooksSensitive({
      text: "notes",
      sourceApp: "Banking",
      sourceProcess: "chrome.exe",
      excludedByOs: false,
    })).toBe(false);
  });
});

describe("clipboard sync merge", () => {
  it("lets a newer deletion win and keeps a newer local edit", () => {
    const local = [
      entry({ id: "gone", contentHash: "a", updatedAt: "2026-10-20T01:00:00.000Z" }),
      entry({ id: "kept", contentHash: "b", updatedAt: "2026-10-20T05:00:00.000Z", pending: "upsert", text: "local edit" }),
    ];
    const remote = [
      entry({ id: "gone", contentHash: "a", updatedAt: "2026-10-20T04:00:00.000Z", deletedAt: "2026-10-20T04:00:00.000Z", text: null }),
      entry({ id: "kept", contentHash: "b", updatedAt: "2026-10-20T02:00:00.000Z", text: "server" }),
      entry({ id: "other", contentHash: "c", text: "from the other pc", updatedAt: "2026-10-20T03:00:00.000Z" }),
    ];
    const merged = reconcileClipboard(local, remote, null);
    const gone = merged.find((item) => item.id === "gone");
    expect(gone?.deletedAt).toBe("2026-10-20T04:00:00.000Z");
    expect(merged.find((item) => item.id === "kept")?.text).toBe("local edit");
    expect(merged.find((item) => item.id === "other")?.text).toBe("from the other pc");
  });

  it("collapses two devices saving the same value into the server row", () => {
    const merged = collapseClipboardHashes([
      entry({ id: "local", contentHash: "same", pending: "upsert", copyCount: 4, updatedAt: "2026-10-20T05:00:00.000Z" }),
      entry({ id: "server", contentHash: "same", copyCount: 1, updatedAt: "2026-10-20T02:00:00.000Z" }),
    ]);
    const live = merged.filter((item) => item.deletedAt === null);
    expect(live.map((item) => item.id)).toEqual(["server"]);
    expect(live[0]?.copyCount).toBe(4);
    expect(live[0]?.pending).toBe("upsert");
  });

  it("forgets history from before a permanent clear", () => {
    const merged = reconcileClipboard([
      entry({ id: "old", contentHash: "a", updatedAt: "2026-10-20T01:00:00.000Z" }),
      entry({ id: "new", contentHash: "b", updatedAt: "2026-10-20T06:00:00.000Z", pending: "upsert" }),
    ], [], "2026-10-20T04:00:00.000Z");
    expect(merged.map((item) => item.id)).toEqual(["new"]);
  });

  it("keeps only the most recent copies once history is past the cap", () => {
    expect(MAX_CLIPBOARD_ENTRIES).toBe(20);
    const entries = [
      entry({ id: "pin", contentHash: "p", pinned: true, createdAt: "2026-10-20T00:00:00.000Z", updatedAt: "2026-10-20T00:00:00.000Z" }),
      entry({ id: "old", contentHash: "o", createdAt: "2026-10-20T01:00:00.000Z", updatedAt: "2026-10-20T01:00:00.000Z" }),
      entry({ id: "new", contentHash: "n", createdAt: "2026-10-20T02:00:00.000Z", updatedAt: "2026-10-20T02:00:00.000Z" }),
    ];
    expect(clipboardOverflowIds(entries, 2)).toEqual(["pin"]);
  });

  it("ignores a clipboard event the OS told us to exclude", () => {
    expect(parseClipboardChange({ excluded: true, text: "secret" })).toMatchObject({
      excluded: true,
      text: null,
    });
    expect(parseClipboardChange({ text: "hello", sourceApp: "Notepad" })?.text).toBe("hello");
  });

  it("accepts PNG image events and older BMP image events", () => {
    expect(parseClipboardChange({ imageBase64: "iVBORw0KGgo=", imageFormat: "png", sourceApp: "Snipping Tool" })).toMatchObject({
      text: null,
      imageFormat: "png",
    });
    expect(parseClipboardChange({ imageBmpBase64: "Qk0=" })).toMatchObject({
      imageBase64: "Qk0=",
      imageFormat: "bmp",
    });
  });

  it("does not save an em dash in source metadata, and leaves copied text exact", () => {
    const change = parseClipboardChange({
      text: "keep \u2014 this",
      sourceApp: "Persyn.ai \u2014 One AI Creator - Cursor",
      sourceProcess: "cursor.exe",
    });
    expect(change?.text).toBe("keep \u2014 this");
    expect(change?.sourceApp).toBe("Persyn.ai - One AI Creator - Cursor");
    expect(change?.sourceApp).not.toContain("\u2014");
  });
});
