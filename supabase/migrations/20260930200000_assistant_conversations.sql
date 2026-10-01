-- Saved Assistant conversations. Additive. Existing tables are unchanged.
--
-- The Gemini socket and its resumption handle are not this data. Rows store final or
-- interrupted text, sanitized citations (url and title only), and a tool name plus
-- outcome. There is no audio, credential, or tool-argument column.
--
-- Writes go through security-definer functions. Authenticated clients may only select
-- live rows. Delete keeps the conversation id, blanks the title, and removes messages
-- in the same transaction. A later create or append of that id fails, so a retry cannot
-- recreate it. A repeated delete succeeds and does not move the fence again.
--
-- lease_device_id, lease_expires_at, and fence are reserved for a later single-producer
-- lease. This migration does not grant a way to acquire that lease.

create table public.assistant_conversations (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null,
  revision bigint not null default 0 check (revision >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  lease_device_id uuid,
  lease_expires_at timestamptz,
  fence bigint not null default 0 check (fence >= 0),
  constraint assistant_conversations_title_chk check (
    (
      deleted_at is null
      and char_length(title) between 1 and 120
      and title = btrim(title)
    )
    or (deleted_at is not null and title = '')
  ),
  constraint assistant_conversations_lease_chk check (
    (lease_device_id is null and lease_expires_at is null)
    or (lease_device_id is not null and lease_expires_at is not null)
  )
);

create index assistant_conversations_user_recent_idx
  on public.assistant_conversations (user_id, updated_at desc, id desc)
  where deleted_at is null;

create table public.assistant_messages (
  id uuid primary key,
  conversation_id uuid not null references public.assistant_conversations (id) on delete cascade,
  user_id uuid not null,
  role text not null check (role in ('user', 'assistant', 'tool')),
  status text not null check (status in ('final', 'interrupted')),
  body text not null check (char_length(body) between 1 and 100000 and body = btrim(body)),
  seq bigint not null check (seq > 0),
  source_device_id uuid not null,
  created_at timestamptz not null default now(),
  citations jsonb not null default '[]'::jsonb,
  tool_name text,
  tool_outcome text,
  unique (conversation_id, seq),
  constraint assistant_messages_citations_chk check (
    jsonb_typeof(citations) = 'array' and jsonb_array_length(citations) <= 8
  ),
  constraint assistant_messages_tool_chk check (
    (
      role = 'tool'
      and status = 'final'
      and tool_name ~ '^[a-z][a-z0-9_]{0,63}$'
      and tool_outcome is not null
      and char_length(tool_outcome) between 1 and 8000
      and tool_outcome = btrim(tool_outcome)
    )
    or (
      role <> 'tool'
      and tool_name is null
      and tool_outcome is null
    )
  )
);

create index assistant_messages_conversation_seq_idx
  on public.assistant_messages (conversation_id, seq);

create trigger assistant_conversations_touch_updated_at
  before update on public.assistant_conversations
  for each row execute function public.touch_updated_at();

-- Rejects a message whose user_id is not the conversation owner.
create function public.assistant_message_owner() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  owner uuid;
begin
  select user_id into owner
  from public.assistant_conversations
  where id = new.conversation_id;
  if owner is null or owner is distinct from new.user_id then
    raise exception 'ASSISTANT_CONVERSATION_NOT_FOUND' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger assistant_messages_owner
  before insert on public.assistant_messages
  for each row execute function public.assistant_message_owner();

create function public.assistant_require_account(p_user_id uuid) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'ASSISTANT_NOT_SIGNED_IN' using errcode = '42501';
  end if;
  if p_user_id is distinct from uid then
    raise exception 'ASSISTANT_ACCOUNT_MISMATCH' using errcode = '42501';
  end if;
  return uid;
end;
$$;

create function public.assistant_title(p_title text) returns text
language plpgsql
set search_path = ''
as $$
begin
  if p_title is null
    or char_length(p_title) < 1
    or char_length(p_title) > 120
    or p_title is distinct from btrim(p_title) then
    raise exception 'ASSISTANT_CONVERSATION_REJECTED' using errcode = '23514';
  end if;
  return p_title;
end;
$$;

-- Keeps url and title only. Extra keys, non-https URLs, and more than eight items fail.
create function public.assistant_citations(p_citations jsonb) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  item jsonb;
  url text;
  title text;
  built jsonb := '[]'::jsonb;
begin
  if p_citations is null then
    return '[]'::jsonb;
  end if;
  if jsonb_typeof(p_citations) is distinct from 'array' or jsonb_array_length(p_citations) > 8 then
    raise exception 'ASSISTANT_MESSAGE_REJECTED' using errcode = '23514';
  end if;
  for item in select value from jsonb_array_elements(p_citations) as citation(value)
  loop
    if jsonb_typeof(item) is distinct from 'object'
      or exists (
        select 1 from jsonb_object_keys(item) as key where key not in ('url', 'title')
      ) then
      raise exception 'ASSISTANT_MESSAGE_REJECTED' using errcode = '23514';
    end if;
    url := item ->> 'url';
    title := item ->> 'title';
    if url is null or title is null
      or char_length(url) < 9 or char_length(url) > 2000
      or char_length(title) < 1 or char_length(title) > 300
      or url is distinct from btrim(url) or title is distinct from btrim(title)
      or url !~ '^https://[^[:space:]]+$' then
      raise exception 'ASSISTANT_MESSAGE_REJECTED' using errcode = '23514';
    end if;
    built := built || jsonb_build_array(jsonb_build_object('url', url, 'title', title));
  end loop;
  return built;
end;
$$;

create function public.assistant_lock(p_conversation_id uuid, p_message_id uuid) returns void
language plpgsql
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('c:' || p_conversation_id::text));
  if p_message_id is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('m:' || p_message_id::text));
  end if;
end;
$$;

-- Locks in conversation-id then message-id order when a message id is passed through assistant_lock.
create function public.assistant_fetch_conversation(
  p_id uuid,
  p_user_id uuid,
  p_lock boolean
) returns public.assistant_conversations
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid;
  conv public.assistant_conversations;
begin
  uid := public.assistant_require_account(p_user_id);
  if p_lock then
    perform public.assistant_lock(p_id, null);
    select * into conv from public.assistant_conversations where id = p_id for update;
  else
    select * into conv from public.assistant_conversations where id = p_id;
  end if;
  if not found or conv.user_id is distinct from uid then
    raise exception 'ASSISTANT_CONVERSATION_NOT_FOUND' using errcode = 'P0001';
  end if;
  if conv.deleted_at is not null then
    raise exception 'ASSISTANT_CONVERSATION_DELETED' using errcode = 'P0001';
  end if;
  return conv;
end;
$$;

create function public.assistant_message_matches(
  existing public.assistant_messages,
  p_conversation_id uuid,
  p_role text,
  p_status text,
  p_body text,
  p_source_device_id uuid,
  p_citations jsonb,
  p_tool_name text,
  p_tool_outcome text
) returns boolean
language sql
stable
set search_path = ''
as $$
  select existing.conversation_id is not distinct from p_conversation_id
    and existing.role is not distinct from p_role
    and existing.status is not distinct from p_status
    and existing.body is not distinct from p_body
    and existing.source_device_id is not distinct from p_source_device_id
    and existing.citations is not distinct from p_citations
    and existing.tool_name is not distinct from p_tool_name
    and existing.tool_outcome is not distinct from p_tool_outcome;
$$;

create function public.create_assistant_conversation(
  p_user_id uuid,
  p_id uuid,
  p_title text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid;
  stored_title text;
  conv public.assistant_conversations;
begin
  uid := public.assistant_require_account(p_user_id);
  stored_title := public.assistant_title(p_title);
  perform public.assistant_lock(p_id, null);
  select * into conv from public.assistant_conversations where id = p_id for update;
  if found then
    if conv.user_id is distinct from uid then
      raise exception 'ASSISTANT_CONVERSATION_NOT_FOUND' using errcode = 'P0001';
    end if;
    if conv.deleted_at is not null then
      raise exception 'ASSISTANT_CONVERSATION_DELETED' using errcode = 'P0001';
    end if;
    return to_jsonb(conv) || jsonb_build_object('created', false);
  end if;
  insert into public.assistant_conversations (id, user_id, title)
  values (p_id, uid, stored_title)
  returning * into conv;
  return to_jsonb(conv) || jsonb_build_object('created', true);
exception
  when unique_violation then
    select * into conv from public.assistant_conversations where id = p_id;
    if not found or conv.user_id is distinct from uid then
      raise exception 'ASSISTANT_CONVERSATION_NOT_FOUND' using errcode = 'P0001';
    end if;
    if conv.deleted_at is not null then
      raise exception 'ASSISTANT_CONVERSATION_DELETED' using errcode = 'P0001';
    end if;
    return to_jsonb(conv) || jsonb_build_object('created', false);
end;
$$;

create function public.rename_assistant_conversation(
  p_user_id uuid,
  p_id uuid,
  p_title text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_title text;
  conv public.assistant_conversations;
begin
  next_title := public.assistant_title(p_title);
  conv := public.assistant_fetch_conversation(p_id, p_user_id, true);
  if conv.title is distinct from next_title then
    update public.assistant_conversations
      set title = next_title,
          revision = revision + 1
      where id = conv.id
      returning * into conv;
  end if;
  return to_jsonb(conv);
end;
$$;

-- Idempotent. The first call blanks the title, drops messages, and increments fence.
create function public.delete_assistant_conversation(p_user_id uuid, p_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid;
  conv public.assistant_conversations;
begin
  uid := public.assistant_require_account(p_user_id);
  perform public.assistant_lock(p_id, null);
  select * into conv from public.assistant_conversations where id = p_id for update;
  if not found or conv.user_id is distinct from uid then
    raise exception 'ASSISTANT_CONVERSATION_NOT_FOUND' using errcode = 'P0001';
  end if;
  if conv.deleted_at is not null then
    return;
  end if;
  delete from public.assistant_messages where conversation_id = conv.id;
  update public.assistant_conversations
    set title = '',
        deleted_at = now(),
        lease_device_id = null,
        lease_expires_at = null,
        fence = fence + 1,
        revision = revision + 1
    where id = conv.id;
end;
$$;

create function public.append_assistant_message(
  p_user_id uuid,
  p_conversation_id uuid,
  p_message_id uuid,
  p_role text,
  p_status text,
  p_body text,
  p_source_device_id uuid,
  p_citations jsonb,
  p_tool_name text,
  p_tool_outcome text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  conv public.assistant_conversations;
  existing public.assistant_messages;
  stored public.assistant_messages;
  citations jsonb;
  next_seq bigint;
  new_revision bigint;
begin
  if p_role not in ('user', 'assistant', 'tool')
    or p_status not in ('final', 'interrupted')
    or p_body is null
    or char_length(p_body) < 1
    or char_length(p_body) > 100000
    or p_body is distinct from btrim(p_body)
    or p_source_device_id is null
    or (p_role = 'tool' and p_status is distinct from 'final')
    or (p_role = 'tool' and (p_tool_name is null or p_tool_outcome is null))
    or (p_role <> 'tool' and (p_tool_name is not null or p_tool_outcome is not null))
    or (p_tool_name is not null and p_tool_name !~ '^[a-z][a-z0-9_]{0,63}$')
    or (
      p_tool_outcome is not null and (
        char_length(p_tool_outcome) < 1
        or char_length(p_tool_outcome) > 8000
        or p_tool_outcome is distinct from btrim(p_tool_outcome)
      )
    ) then
    raise exception 'ASSISTANT_MESSAGE_REJECTED' using errcode = '23514';
  end if;
  citations := public.assistant_citations(p_citations);
  conv := public.assistant_fetch_conversation(p_conversation_id, p_user_id, true);
  perform public.assistant_lock(p_conversation_id, p_message_id);
  select * into existing from public.assistant_messages where id = p_message_id;
  if found then
    if not public.assistant_message_matches(
      existing,
      p_conversation_id,
      p_role,
      p_status,
      p_body,
      p_source_device_id,
      citations,
      p_tool_name,
      p_tool_outcome
    ) then
      raise exception 'ASSISTANT_MESSAGE_CONFLICT' using errcode = 'P0001';
    end if;
    return to_jsonb(existing) || jsonb_build_object('appended', false, 'revision', conv.revision);
  end if;
  select coalesce(max(seq), 0) + 1 into next_seq
  from public.assistant_messages
  where conversation_id = conv.id;
  insert into public.assistant_messages (
    id, conversation_id, user_id, role, status, body, seq, source_device_id, citations, tool_name, tool_outcome
  ) values (
    p_message_id, conv.id, conv.user_id, p_role, p_status, p_body, next_seq, p_source_device_id,
    citations, p_tool_name, p_tool_outcome
  )
  returning * into stored;
  update public.assistant_conversations
    set revision = revision + 1
    where id = conv.id
    returning revision into new_revision;
  return to_jsonb(stored) || jsonb_build_object('appended', true, 'revision', new_revision);
exception
  when unique_violation then
    select * into existing from public.assistant_messages where id = p_message_id;
    if not found then
      raise exception 'ASSISTANT_MESSAGE_REJECTED' using errcode = '23514';
    end if;
    if not public.assistant_message_matches(
      existing,
      p_conversation_id,
      p_role,
      p_status,
      p_body,
      p_source_device_id,
      citations,
      p_tool_name,
      p_tool_outcome
    ) then
      raise exception 'ASSISTANT_MESSAGE_CONFLICT' using errcode = 'P0001';
    end if;
    return to_jsonb(existing) || jsonb_build_object('appended', false, 'revision', conv.revision);
end;
$$;

create function public.get_assistant_conversation(p_user_id uuid, p_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  conv public.assistant_conversations;
begin
  conv := public.assistant_fetch_conversation(p_id, p_user_id, false);
  return to_jsonb(conv);
end;
$$;

create function public.list_assistant_conversations(
  p_user_id uuid,
  p_limit integer,
  p_before_updated_at timestamptz default null,
  p_before_id uuid default null
) returns setof public.assistant_conversations
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid;
begin
  uid := public.assistant_require_account(p_user_id);
  if p_limit is null or p_limit < 1 or p_limit > 100
    or (p_before_updated_at is null) is distinct from (p_before_id is null) then
    raise exception 'ASSISTANT_PAGE_REJECTED' using errcode = '23514';
  end if;
  return query
  select conversations.*
  from public.assistant_conversations as conversations
  where conversations.user_id = uid
    and conversations.deleted_at is null
    and (
      p_before_updated_at is null
      or (conversations.updated_at, conversations.id) < (p_before_updated_at, p_before_id)
    )
  order by conversations.updated_at desc, conversations.id desc
  limit p_limit;
end;
$$;

create function public.list_assistant_messages(
  p_user_id uuid,
  p_conversation_id uuid,
  p_after_seq bigint,
  p_limit integer
) returns setof public.assistant_messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  conv public.assistant_conversations;
begin
  if p_after_seq is null or p_after_seq < 0 or p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'ASSISTANT_PAGE_REJECTED' using errcode = '23514';
  end if;
  conv := public.assistant_fetch_conversation(p_conversation_id, p_user_id, false);
  return query
  select messages.*
  from public.assistant_messages as messages
  where messages.conversation_id = conv.id
    and messages.seq > p_after_seq
  order by messages.seq asc
  limit p_limit;
end;
$$;

alter table public.assistant_conversations enable row level security;
alter table public.assistant_messages enable row level security;

create policy "Users read their live assistant conversations"
  on public.assistant_conversations
  for select
  to authenticated
  using (user_id = (select auth.uid()) and deleted_at is null);

create policy "Users read messages in their live assistant conversations"
  on public.assistant_messages
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.assistant_conversations as conversations
      where conversations.id = conversation_id
        and conversations.user_id = (select auth.uid())
        and conversations.deleted_at is null
    )
  );

revoke all on public.assistant_conversations, public.assistant_messages from anon, authenticated;
grant select on public.assistant_conversations, public.assistant_messages to authenticated;

revoke all on function public.assistant_message_owner() from public, anon, authenticated;
revoke all on function public.assistant_require_account(uuid) from public, anon, authenticated;
revoke all on function public.assistant_title(text) from public, anon, authenticated;
revoke all on function public.assistant_citations(jsonb) from public, anon, authenticated;
revoke all on function public.assistant_lock(uuid, uuid) from public, anon, authenticated;
revoke all on function public.assistant_fetch_conversation(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.assistant_message_matches(public.assistant_messages, uuid, text, text, text, uuid, jsonb, text, text) from public, anon, authenticated;

revoke all on function public.create_assistant_conversation(uuid, uuid, text) from public, anon;
revoke all on function public.rename_assistant_conversation(uuid, uuid, text) from public, anon;
revoke all on function public.delete_assistant_conversation(uuid, uuid) from public, anon;
revoke all on function public.append_assistant_message(uuid, uuid, uuid, text, text, text, uuid, jsonb, text, text) from public, anon;
revoke all on function public.get_assistant_conversation(uuid, uuid) from public, anon;
revoke all on function public.list_assistant_conversations(uuid, integer, timestamptz, uuid) from public, anon;
revoke all on function public.list_assistant_messages(uuid, uuid, bigint, integer) from public, anon;

grant execute on function public.create_assistant_conversation(uuid, uuid, text) to authenticated;
grant execute on function public.rename_assistant_conversation(uuid, uuid, text) to authenticated;
grant execute on function public.delete_assistant_conversation(uuid, uuid) to authenticated;
grant execute on function public.append_assistant_message(uuid, uuid, uuid, text, text, text, uuid, jsonb, text, text) to authenticated;
grant execute on function public.get_assistant_conversation(uuid, uuid) to authenticated;
grant execute on function public.list_assistant_conversations(uuid, integer, timestamptz, uuid) to authenticated;
grant execute on function public.list_assistant_messages(uuid, uuid, bigint, integer) to authenticated;
