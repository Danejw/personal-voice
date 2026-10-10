import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  fileURLToPath(new URL("../../supabase/migrations/20261010010000_remove_legacy_voice_notes_view.sql", import.meta.url)),
  "utf8",
);

describe("legacy voice_notes view retirement", () => {
  it("retains Assistant recall access to canonical notes", () => {
    expect(migration).toMatch(/create or replace function public\.search_assistant_recall\(/i);
    expect(migration).toContain("from public.notes n");
    expect(migration).not.toContain("from public.voice_notes n");
    expect(migration).toContain("uid := public.assistant_require_account(p_user_id);");
    expect(migration).toContain("(p_include_archived or n.status = 'inbox')");
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path = ''");
  });

  it("drops only the legacy view and never cascades or deletes saved data", () => {
    expect(migration).toMatch(/drop view public\.voice_notes\s*;/i);
    expect(migration.replace(/^--.*$/gm, "")).not.toMatch(/\bcascade\b/i);
    expect(migration).not.toMatch(/\b(drop table|truncate|delete from|update public\.notes)\b/i);
    expect(migration).toContain("rename constraint voice_notes_pkey to notes_pkey");
    expect(migration).toContain("alter index public.voice_notes_fts_idx rename to notes_fts_idx");
    expect(migration.trimEnd().endsWith("commit;")).toBe(true);
  });
});
