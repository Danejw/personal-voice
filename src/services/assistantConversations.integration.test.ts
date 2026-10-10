/**
 * Applies the repository migrations to a disposable local Postgres and checks
 * the conversation RPCs. Skipped unless ASSISTANT_TEST_DATABASE_URL points at
 * 127.0.0.1 or localhost and a database named assistant. The suite drops the
 * public and auth schemas on that database before migrating.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool, PoolClient, QueryResult } from "pg";
import { createRequire } from "node:module";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { Pool: PgPool } = require("pg") as { Pool: new (config: { connectionString: string }) => Pool };

const databaseUrl = process.env.ASSISTANT_TEST_DATABASE_URL;
const describeDb = databaseUrl ? describe : describe.skip;

function assertDisposable(url: string): void {
  const parsed = new URL(url);
  const name = parsed.pathname.replace(/^\//, "");
  if ((parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") || name !== "assistant") {
    throw new Error("Refusing to reset a database that is not the local assistant test database.");
  }
}

const BOOTSTRAP = `
  create schema if not exists auth;
  create table if not exists auth.users (id uuid primary key);
  create or replace function auth.uid() returns uuid
  language sql stable
  set search_path = ''
  as $$ select nullif(pg_catalog.current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  do $$
  begin
    if not exists (select 1 from pg_catalog.pg_roles where rolname = 'anon') then
      create role anon nologin;
    end if;
    if not exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticated') then
      create role authenticated nologin;
    end if;
  end $$;
  grant usage on schema public to anon, authenticated;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
`;

describeDb("assistant conversation database", () => {
  if (!databaseUrl) return;
  const url = databaseUrl;
  const pool = new PgPool({ connectionString: url });

  beforeAll(async () => {
    assertDisposable(url);
    await pool.query("drop schema if exists public cascade");
    await pool.query("drop schema if exists auth cascade");
    await pool.query("create schema public");
    await pool.query(BOOTSTRAP);
    const directory = fileURLToPath(new URL("../../supabase/migrations", import.meta.url));
    const files = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
    for (const name of files) {
      await pool.query(await readFile(join(directory, name), "utf8"));
    }
  }, 60_000);

  afterAll(async () => {
    await pool.end();
  });

  async function asUser<T>(userId: string, run: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
      await client.query("set local role authenticated");
      const value = await run(client);
      await client.query("commit");
      return value;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async function queryUser(userId: string, sql: string, params: unknown[] = []): Promise<QueryResult> {
    return asUser(userId, (client) => client.query(sql, params));
  }

  async function tokenOf(userId: string, sql: string, params: unknown[] = []): Promise<string> {
    try {
      await queryUser(userId, sql, params);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
      return `${code} ${message}`;
    }
    throw new Error("Expected the database call to fail.");
  }

  async function user(id: string): Promise<void> {
    await pool.query("insert into auth.users (id) values ($1) on conflict do nothing", [id]);
  }

  it("keeps settings epoch protection and can still save a note", async () => {
    const owner = "10000000-0000-4000-8000-000000000001";
    const device = "10000000-0000-4000-8000-000000000002";
    await user(owner);
    await queryUser(owner, "insert into public.settings (user_id, usage_epoch) values ($1, 9)", [owner]);
    await queryUser(owner, "update public.settings set usage_epoch = 9 where user_id = $1", [owner]);
    const settings = await queryUser(
      owner,
      "select usage_epoch, usage_intelligence, cloud_dictation_history from public.settings where user_id = $1",
      [owner],
    );
    expect(settings.rows[0]).toMatchObject({
      usage_epoch: "0",
      usage_intelligence: true,
      cloud_dictation_history: false,
    });
    const note = await queryUser(
      owner,
      "insert into public.notes (text, source_device_id) values ('hello', $1) returning user_id",
      [device],
    );
    expect(note.rows[0]?.user_id).toBe(owner);
  });

  it("lets the owner create, read, and append, and hides the row from another account", async () => {
    const owner = "20000000-0000-4000-8000-000000000001";
    const other = "20000000-0000-4000-8000-000000000002";
    const conversation = "20000000-0000-4000-8000-000000000003";
    const device = "20000000-0000-4000-8000-000000000004";
    const message = "20000000-0000-4000-8000-000000000005";
    await user(owner);
    await user(other);
    const created = await queryUser(
      owner,
      "select public.create_assistant_conversation($1, $2, $3) as row",
      [owner, conversation, "Trip notes"],
    );
    expect(created.rows[0]?.row.created).toBe(true);
    const again = await queryUser(
      owner,
      "select public.create_assistant_conversation($1, $2, $3) as row",
      [owner, conversation, "Different title"],
    );
    expect(again.rows[0]?.row.created).toBe(false);
    expect(again.rows[0]?.row.title).toBe("Trip notes");
    const renamed = await queryUser(
      owner,
      "select public.rename_assistant_conversation($1, $2, 'Renamed') as row",
      [owner, conversation],
    );
    expect(renamed.rows[0]?.row.title).toBe("Renamed");
    expect(renamed.rows[0]?.row.revision).toBe(1);
    const sameName = await queryUser(
      owner,
      "select public.rename_assistant_conversation($1, $2, 'Renamed') as row",
      [owner, conversation],
    );
    expect(sameName.rows[0]?.row.revision).toBe(1);

    const appended = await queryUser(
      owner,
      "select public.append_assistant_message($1, $2, $3, 'user', 'final', 'Hello', $4, '[]'::jsonb, null, null) as row",
      [owner, conversation, message, device],
    );
    expect(appended.rows[0]?.row.appended).toBe(true);
    expect(appended.rows[0]?.row.seq).toBe(1);
    const retry = await queryUser(
      owner,
      "select public.append_assistant_message($1, $2, $3, 'user', 'final', 'Hello', $4, '[]'::jsonb, null, null) as row",
      [owner, conversation, message, device],
    );
    expect(retry.rows[0]?.row.appended).toBe(false);
    expect(retry.rows[0]?.row.revision).toBe(2);
    const count = await pool.query("select count(*)::int as n from public.assistant_messages where id = $1", [message]);
    expect(count.rows[0]?.n).toBe(1);

    const visible = await queryUser(other, "select id from public.assistant_conversations where id = $1", [conversation]);
    expect(visible.rows).toEqual([]);
    const hidden = await tokenOf(
      other,
      "select public.get_assistant_conversation($1, $2)",
      [other, conversation],
    );
    expect(hidden).toContain("ASSISTANT_CONVERSATION_NOT_FOUND");
    const mismatch = await tokenOf(
      owner,
      "select public.append_assistant_message($1, $2, $3, 'user', 'final', 'Nope', $4, '[]'::jsonb, null, null)",
      [other, conversation, "20000000-0000-4000-8000-000000000006", device],
    );
    expect(mismatch).toContain("ASSISTANT_ACCOUNT_MISMATCH");
    const foreign = await tokenOf(
      other,
      "select public.append_assistant_message($1, $2, $3, 'user', 'final', 'Nope', $4, '[]'::jsonb, null, null)",
      [other, conversation, "20000000-0000-4000-8000-000000000007", device],
    );
    expect(foreign).toContain("ASSISTANT_CONVERSATION_NOT_FOUND");
  });

  it("rejects a conflicting message id and a citation that carries extra fields", async () => {
    const owner = "30000000-0000-4000-8000-000000000001";
    const conversation = "30000000-0000-4000-8000-000000000002";
    const message = "30000000-0000-4000-8000-000000000003";
    const device = "30000000-0000-4000-8000-000000000004";
    await user(owner);
    await queryUser(owner, "select public.create_assistant_conversation($1, $2, 'Tools')", [owner, conversation]);
    await queryUser(owner, "select public.claim_assistant_conversation($1, $2, $3, 45, true)", [owner, conversation, device]);
    await queryUser(
      owner,
      "select public.append_assistant_message($1, $2, $3, 'assistant', 'final', 'See this', $4, $5::jsonb, null, null, 1)",
      [owner, conversation, message, device, JSON.stringify([{ url: "https://example.com/a", title: "Example" }])],
    );
    const conflict = await tokenOf(
      owner,
      "select public.append_assistant_message($1, $2, $3, 'assistant', 'final', 'Different', $4, '[]'::jsonb, null, null)",
      [owner, conversation, message, device],
    );
    expect(conflict).toContain("ASSISTANT_MESSAGE_CONFLICT");
    const extra = await tokenOf(
      owner,
      "select public.append_assistant_message($1, $2, $3, 'assistant', 'final', 'Next', $4, $5::jsonb, null, null)",
      [owner, conversation, "30000000-0000-4000-8000-000000000005", device, JSON.stringify([{ url: "https://example.com/a", title: "Example", args: "replay" }])],
    );
    expect(extra).toContain("ASSISTANT_MESSAGE_REJECTED");
    const messy = await tokenOf(owner, "select public.create_assistant_conversation($1, $2, '  spaced  ')", [owner, "30000000-0000-4000-8000-000000000006"]);
    expect(messy).toContain("ASSISTANT_CONVERSATION_REJECTED");
  });

  it("assigns sequence numbers without gaps when appends run together", async () => {
    const owner = "40000000-0000-4000-8000-000000000001";
    const conversation = "40000000-0000-4000-8000-000000000002";
    const device = "40000000-0000-4000-8000-000000000003";
    await user(owner);
    await queryUser(owner, "select public.create_assistant_conversation($1, $2, 'Parallel')", [owner, conversation]);
    const ids = Array.from({ length: 8 }, (_, index) => `40000000-0000-4000-8000-0000000000${index + 10}`);
    await Promise.all(ids.map((id, index) => queryUser(
      owner,
      "select public.append_assistant_message($1, $2, $3, 'user', 'final', $4, $5, '[]'::jsonb, null, null)",
      [owner, conversation, id, `Line ${index}`, device],
    )));
    const rows = await pool.query(
      "select seq from public.assistant_messages where conversation_id = $1 order by seq",
      [conversation],
    );
    expect(rows.rows.map((row: { seq: string }) => Number(row.seq))).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("pages conversations and messages without gaps or duplicates", async () => {
    const owner = "50000000-0000-4000-8000-000000000001";
    const device = "50000000-0000-4000-8000-000000000002";
    await user(owner);
    const ids = Array.from({ length: 5 }, (_, index) => `50000000-0000-4000-8000-00000000001${index}`);
    for (const id of ids) {
      await queryUser(owner, "select public.create_assistant_conversation($1, $2, $3)", [owner, id, `Thread ${id.slice(-1)}`]);
    }
    await pool.query("alter table public.assistant_conversations disable trigger assistant_conversations_touch_updated_at");
    await pool.query(
      `update public.assistant_conversations
       set updated_at = timestamptz '2026-09-30 12:00:00+00' + (right(id::text, 1) || ' seconds')::interval
       where user_id = $1`,
      [owner],
    );
    await pool.query("alter table public.assistant_conversations enable trigger assistant_conversations_touch_updated_at");
    const seen: string[] = [];
    let beforeUpdatedAt: string | null = null;
    let beforeId: string | null = null;
    for (let page = 0; page < 5; page += 1) {
      const result = await queryUser(
        owner,
        "select id, updated_at from public.list_assistant_conversations($1, 2, $2, $3)",
        [owner, beforeUpdatedAt, beforeId],
      );
      if (result.rows.length === 0) break;
      seen.push(...result.rows.map((row: { id: string }) => row.id));
      const last = result.rows.at(-1) as { id: string; updated_at: Date };
      beforeUpdatedAt = last.updated_at.toISOString();
      beforeId = last.id;
      if (result.rows.length < 2) break;
    }
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.slice().sort()).toEqual(ids.slice().sort());

    const conversation = ids[0] ?? "";
    const messageIds = Array.from({ length: 5 }, (_, index) => `50000000-0000-4000-8000-00000000002${index}`);
    for (const [index, id] of messageIds.entries()) {
      await queryUser(
        owner,
        "select public.append_assistant_message($1, $2, $3, 'user', 'final', $4, $5, '[]'::jsonb, null, null)",
        [owner, conversation, id, `M${index}`, device],
      );
    }
    const first = await queryUser(owner, "select seq from public.list_assistant_messages($1, $2, 0, 2)", [owner, conversation]);
    const lastSeq = Number(first.rows.at(-1)?.seq);
    const second = await queryUser(owner, "select seq from public.list_assistant_messages($1, $2, $3, 2)", [owner, conversation, lastSeq]);
    const third = await queryUser(
      owner,
      "select seq from public.list_assistant_messages($1, $2, $3, 2)",
      [owner, conversation, Number(second.rows.at(-1)?.seq)],
    );
    const seqs = [...first.rows, ...second.rows, ...third.rows].map((row: { seq: string }) => Number(row.seq));
    expect(seqs).toEqual([1, 2, 3, 4, 5]);
  });

  it("keeps a deleted id from being created or appended again", async () => {
    const owner = "60000000-0000-4000-8000-000000000001";
    const conversation = "60000000-0000-4000-8000-000000000002";
    const device = "60000000-0000-4000-8000-000000000003";
    const message = "60000000-0000-4000-8000-000000000004";
    await user(owner);
    await queryUser(owner, "select public.create_assistant_conversation($1, $2, 'Gone')", [owner, conversation]);
    await queryUser(
      owner,
      "select public.append_assistant_message($1, $2, $3, 'user', 'interrupted', 'Stopped', $4, '[]'::jsonb, null, null)",
      [owner, conversation, message, device],
    );
    await queryUser(owner, "select public.delete_assistant_conversation($1, $2)", [owner, conversation]);
    await queryUser(owner, "select public.delete_assistant_conversation($1, $2)", [owner, conversation]);
    const tombstone = await pool.query(
      "select title, fence, deleted_at is not null as gone from public.assistant_conversations where id = $1",
      [conversation],
    );
    expect(tombstone.rows[0]).toMatchObject({ title: "", fence: "1", gone: true });
    const messages = await pool.query("select count(*)::int as n from public.assistant_messages where conversation_id = $1", [conversation]);
    expect(messages.rows[0]?.n).toBe(0);
    const listed = await queryUser(owner, "select id from public.list_assistant_conversations($1, 20, null, null)", [owner]);
    expect(listed.rows.map((row: { id: string }) => row.id)).not.toContain(conversation);
    expect(await tokenOf(owner, "select public.create_assistant_conversation($1, $2, 'Again')", [owner, conversation]))
      .toContain("ASSISTANT_CONVERSATION_DELETED");
    expect(await tokenOf(
      owner,
      "select public.append_assistant_message($1, $2, $3, 'user', 'final', 'Late', $4, '[]'::jsonb, null, null)",
      [owner, conversation, "60000000-0000-4000-8000-000000000005", device],
    )).toContain("ASSISTANT_CONVERSATION_DELETED");
    const denied = await tokenOf(
      owner,
      "insert into public.assistant_conversations (id, user_id, title) values ($1, $2, 'Direct')",
      ["60000000-0000-4000-8000-000000000006", owner],
    );
    expect(denied).toContain("42501");
  });

  it("keeps one producer, fences a stale assistant write, and retries a commit that already landed", async () => {
    const owner = "70000000-0000-4000-8000-000000000001";
    const other = "70000000-0000-4000-8000-000000000002";
    const conversation = "70000000-0000-4000-8000-000000000003";
    const laptop = "70000000-0000-4000-8000-000000000004";
    const phone = "70000000-0000-4000-8000-000000000005";
    const message = "70000000-0000-4000-8000-000000000006";
    const spoken = "70000000-0000-4000-8000-000000000007";
    await user(owner);
    await user(other);
    await queryUser(owner, "select public.create_assistant_conversation($1, $2, 'Lease')", [owner, conversation]);
    const claimed = await queryUser(
      owner,
      "select public.claim_assistant_conversation($1, $2, $3, 45, false) as row",
      [owner, conversation, laptop],
    );
    expect(claimed.rows[0]?.row.acquired).toBe(true);
    expect(Number(claimed.rows[0]?.row.fence)).toBe(1);
    const renewed = await queryUser(
      owner,
      "select public.claim_assistant_conversation($1, $2, $3, 45, false) as row",
      [owner, conversation, laptop],
    );
    expect(renewed.rows[0]?.row.acquired).toBe(true);
    expect(Number(renewed.rows[0]?.row.fence)).toBe(1);
    const blocked = await queryUser(
      owner,
      "select public.claim_assistant_conversation($1, $2, $3, 45, false) as row",
      [owner, conversation, phone],
    );
    expect(blocked.rows[0]?.row.acquired).toBe(false);
    expect(Number(blocked.rows[0]?.row.fence)).toBe(1);
    const taken = await queryUser(
      owner,
      "select public.claim_assistant_conversation($1, $2, $3, 45, true) as row",
      [owner, conversation, phone],
    );
    expect(taken.rows[0]?.row.acquired).toBe(true);
    expect(Number(taken.rows[0]?.row.fence)).toBe(2);
    expect(await tokenOf(
      owner,
      "select public.append_assistant_message($1, $2, $3, 'assistant', 'final', 'Late', $4, '[]'::jsonb, null, null, 1)",
      [owner, conversation, message, laptop],
    )).toContain("ASSISTANT_LEASE_LOST");
    const stored = await queryUser(
      owner,
      "select public.append_assistant_message($1, $2, $3, 'assistant', 'final', 'Current', $4, '[]'::jsonb, null, null, 2) as row",
      [owner, conversation, message, phone],
    );
    expect(stored.rows[0]?.row.appended).toBe(true);
    await queryUser(
      owner,
      "select public.claim_assistant_conversation($1, $2, $3, 45, true)",
      [owner, conversation, laptop],
    );
    const retry = await queryUser(
      owner,
      "select public.append_assistant_message($1, $2, $3, 'assistant', 'final', 'Current', $4, '[]'::jsonb, null, null, 2) as row",
      [owner, conversation, message, phone],
    );
    expect(retry.rows[0]?.row.appended).toBe(false);
    const said = await queryUser(
      owner,
      "select public.append_assistant_message($1, $2, $3, 'user', 'final', 'I said this', $4, '[]'::jsonb, null, null) as row",
      [owner, conversation, spoken, laptop],
    );
    expect(said.rows[0]?.row.appended).toBe(true);
    await pool.query(
      "update public.assistant_conversations set lease_expires_at = pg_catalog.now() - interval '1 minute' where id = $1",
      [conversation],
    );
    const expired = await queryUser(
      owner,
      "select public.claim_assistant_conversation($1, $2, $3, 45, false) as row",
      [owner, conversation, phone],
    );
    expect(expired.rows[0]?.row.acquired).toBe(true);
    expect(Number(expired.rows[0]?.row.fence)).toBe(4);
    expect(await tokenOf(
      other,
      "select public.claim_assistant_conversation($1, $2, $3, 45, true)",
      [other, conversation, phone],
    )).toContain("ASSISTANT_CONVERSATION_NOT_FOUND");
  });
});
