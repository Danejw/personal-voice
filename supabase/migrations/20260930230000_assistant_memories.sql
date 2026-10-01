-- Explicit Assistant memories. Additive. Conversations and settings are unchanged.
--
-- A row is one version of one account-scoped key. The active version is the
-- one a new session may hear. A correction marks the previous row superseded
-- and inserts the next version. Forget marks the active row forgotten and
-- leaves it, so the same source conversation cannot passively teach it again.
-- A later explicit remember is allowed and does not delete the forgotten row.
--
-- Deleting a conversation does not delete these rows. The source id stays so
-- the suppression still names that conversation. There is no extracted writer
-- in this migration. origin may be 'extracted' so a later phase can store a
-- guess, and an explicit correction replaces that guess.
--
-- Writes go through security-definer functions. The signed-in user must match
-- p_user_id. Clients cannot insert rows directly.

create table public.assistant_memories (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('preference', 'fact')),
  memory_key text not null check (memory_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  value text not null check (
    char_length(value) between 1 and 500
    and value = btrim(value)
  ),
  scope text not null default 'account' check (scope = 'account'),
  status text not null check (status in ('active', 'superseded', 'forgotten')),
  origin text not null check (origin in ('explicit', 'extracted')),
  source_conversation_id uuid,
  source_message_id uuid,
  supersedes_id uuid,
  revision bigint not null check (revision >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  forgotten_at timestamptz,
  constraint assistant_memories_forgotten_chk check (
    (status = 'forgotten' and forgotten_at is not null)
    or (status <> 'forgotten' and forgotten_at is null)
  )
);

create unique index assistant_memories_one_active_idx
  on public.assistant_memories (user_id, memory_key)
  where status = 'active';

create index assistant_memories_user_idx
  on public.assistant_memories (user_id, memory_key, revision);

create trigger assistant_memories_touch_updated_at
  before update on public.assistant_memories
  for each row execute function public.touch_updated_at();

alter table public.assistant_memories replica identity full;

do $publication$
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.assistant_memories;
    exception
      when duplicate_object then null;
    end;
  end if;
end
$publication$;

create function public.assistant_memory_lock(p_user_id uuid, p_key text) returns void
language plpgsql
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('mem:' || p_user_id::text || ':' || p_key)
  );
end;
$$;

create function public.assistant_memory_source(
  p_user_id uuid,
  p_conversation_id uuid,
  p_message_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_conversation_id is not null and not exists (
    select 1 from public.assistant_conversations
    where id = p_conversation_id and user_id = p_user_id
  ) then
    raise exception 'ASSISTANT_MEMORY_REJECTED' using errcode = '23514';
  end if;
  if p_message_id is not null and (
    p_conversation_id is null
    or not exists (
      select 1 from public.assistant_messages
      where id = p_message_id
        and conversation_id = p_conversation_id
        and user_id = p_user_id
    )
  ) then
    raise exception 'ASSISTANT_MEMORY_REJECTED' using errcode = '23514';
  end if;
end;
$$;

create function public.list_assistant_memories(p_user_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid;
begin
  uid := public.assistant_require_account(p_user_id);
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(m) order by m.memory_key, m.revision)
    from public.assistant_memories m
    where m.user_id = uid
  ), '[]'::jsonb);
end;
$$;

create function public.remember_assistant_memory(
  p_user_id uuid,
  p_id uuid,
  p_kind text,
  p_key text,
  p_value text,
  p_source_conversation_id uuid,
  p_source_message_id uuid,
  p_replace boolean,
  p_expected_revision bigint
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid;
  active public.assistant_memories;
  next_revision bigint;
begin
  uid := public.assistant_require_account(p_user_id);
  if p_id is null
    or p_kind not in ('preference', 'fact')
    or p_key is null
    or p_key !~ '^[a-z][a-z0-9_]{0,63}$'
    or p_value is null
    or pg_catalog.char_length(pg_catalog.btrim(p_value)) < 1
    or pg_catalog.char_length(p_value) > 500
    or p_value is distinct from pg_catalog.btrim(p_value)
    or p_replace is null
    or (p_expected_revision is not null and p_expected_revision < 1) then
    raise exception 'ASSISTANT_MEMORY_REJECTED' using errcode = '23514';
  end if;
  perform public.assistant_memory_source(uid, p_source_conversation_id, p_source_message_id);
  perform public.assistant_memory_lock(uid, p_key);
  select * into active
  from public.assistant_memories
  where user_id = uid and memory_key = p_key and status = 'active'
  for update;
  if found and active.origin = 'explicit' and not p_replace then
    raise exception 'ASSISTANT_MEMORY_EXISTS' using errcode = 'P0001';
  end if;
  if not found and p_replace then
    raise exception 'ASSISTANT_MEMORY_NOT_FOUND' using errcode = 'P0001';
  end if;
  if found and p_expected_revision is distinct from active.revision then
    raise exception 'ASSISTANT_MEMORY_CONFLICT' using errcode = 'P0001';
  end if;
  if not found and p_expected_revision is not null then
    raise exception 'ASSISTANT_MEMORY_CONFLICT' using errcode = 'P0001';
  end if;
  next_revision := 1;
  if found then
    next_revision := active.revision + 1;
    update public.assistant_memories
      set status = 'superseded'
      where id = active.id;
  end if;
  insert into public.assistant_memories (
    id, user_id, kind, memory_key, value, scope, status, origin,
    source_conversation_id, source_message_id, supersedes_id, revision
  ) values (
    p_id, uid, p_kind, p_key, p_value, 'account', 'active', 'explicit',
    p_source_conversation_id, p_source_message_id,
    case when found then active.id else null end,
    next_revision
  );
  return public.list_assistant_memories(uid);
end;
$$;

create function public.forget_assistant_memory(
  p_user_id uuid,
  p_key text,
  p_expected_revision bigint
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid;
  active public.assistant_memories;
begin
  uid := public.assistant_require_account(p_user_id);
  if p_key is null or p_key !~ '^[a-z][a-z0-9_]{0,63}$'
    or p_expected_revision is null or p_expected_revision < 1 then
    raise exception 'ASSISTANT_MEMORY_REJECTED' using errcode = '23514';
  end if;
  perform public.assistant_memory_lock(uid, p_key);
  select * into active
  from public.assistant_memories
  where user_id = uid and memory_key = p_key and status = 'active'
  for update;
  if not found then
    raise exception 'ASSISTANT_MEMORY_NOT_FOUND' using errcode = 'P0001';
  end if;
  if active.revision is distinct from p_expected_revision then
    raise exception 'ASSISTANT_MEMORY_CONFLICT' using errcode = 'P0001';
  end if;
  update public.assistant_memories
    set status = 'forgotten',
        forgotten_at = pg_catalog.now(),
        revision = revision + 1
    where id = active.id;
  return public.list_assistant_memories(uid);
end;
$$;

-- True when this account forgot that key from that source. An explicit
-- remember does not clear this, so a later guess from the same conversation
-- stays blocked. A null source matches a forgotten row that had no source.
create function public.assistant_memory_suppressed(
  p_user_id uuid,
  p_key text,
  p_source_conversation_id uuid
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid;
begin
  uid := public.assistant_require_account(p_user_id);
  if p_key is null or p_key !~ '^[a-z][a-z0-9_]{0,63}$' then
    raise exception 'ASSISTANT_MEMORY_REJECTED' using errcode = '23514';
  end if;
  return exists (
    select 1 from public.assistant_memories
    where user_id = uid
      and memory_key = p_key
      and status = 'forgotten'
      and source_conversation_id is not distinct from p_source_conversation_id
  );
end;
$$;

alter table public.assistant_memories enable row level security;

create policy "Users read their assistant memories"
  on public.assistant_memories
  for select
  to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.assistant_memories from anon, authenticated;
grant select on public.assistant_memories to authenticated;

revoke all on function public.assistant_memory_lock(uuid, text) from public, anon, authenticated;
revoke all on function public.assistant_memory_source(uuid, uuid, uuid) from public, anon, authenticated;

revoke all on function public.list_assistant_memories(uuid) from public, anon;
revoke all on function public.remember_assistant_memory(uuid, uuid, text, text, text, uuid, uuid, boolean, bigint) from public, anon;
revoke all on function public.forget_assistant_memory(uuid, text, bigint) from public, anon;
revoke all on function public.assistant_memory_suppressed(uuid, text, uuid) from public, anon;

grant execute on function public.list_assistant_memories(uuid) to authenticated;
grant execute on function public.remember_assistant_memory(uuid, uuid, text, text, text, uuid, uuid, boolean, bigint) to authenticated;
grant execute on function public.forget_assistant_memory(uuid, text, bigint) to authenticated;
grant execute on function public.assistant_memory_suppressed(uuid, text, uuid) to authenticated;
