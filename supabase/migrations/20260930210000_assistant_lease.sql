-- Single producer for a saved Assistant conversation.
--
-- A lease is an expiring device id plus a fence. Renewing on the same device
-- keeps the fence. Taking the conversation from anyone else, including an
-- expired holder, moves the fence. Assistant and tool rows must carry that
-- fence and the current holder. A user line does not, so a device can still
-- save what the person said after it loses the lease.
--
-- An append of a message id that is already stored with the same content
-- succeeds even after the fence moves. That is the retry of a commit that
-- landed before the disconnect. Realtime is a hint to re-read; the rows are
-- the history.

alter table public.assistant_conversations replica identity full;
alter table public.assistant_messages replica identity full;

do $publication$
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.assistant_conversations;
    exception
      when duplicate_object then null;
    end;
    begin
      alter publication supabase_realtime add table public.assistant_messages;
    exception
      when duplicate_object then null;
    end;
  end if;
end
$publication$;

create function public.claim_assistant_conversation(
  p_user_id uuid,
  p_id uuid,
  p_device_id uuid,
  p_ttl_seconds integer,
  p_takeover boolean
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  conv public.assistant_conversations;
  held_by_other boolean;
  next_fence bigint;
begin
  if p_device_id is null or p_takeover is null
    or p_ttl_seconds is null or p_ttl_seconds < 15 or p_ttl_seconds > 120 then
    raise exception 'ASSISTANT_CONVERSATION_REJECTED' using errcode = '23514';
  end if;
  conv := public.assistant_fetch_conversation(p_id, p_user_id, true);
  held_by_other := conv.lease_device_id is not null
    and conv.lease_device_id is distinct from p_device_id
    and conv.lease_expires_at > pg_catalog.now();
  if held_by_other and not p_takeover then
    return pg_catalog.to_jsonb(conv) || pg_catalog.jsonb_build_object('acquired', false);
  end if;
  next_fence := case
    when conv.lease_device_id is not distinct from p_device_id then conv.fence
    else conv.fence + 1
  end;
  update public.assistant_conversations
    set lease_device_id = p_device_id,
        lease_expires_at = pg_catalog.now() + (p_ttl_seconds * interval '1 second'),
        fence = next_fence,
        revision = revision + 1
    where id = conv.id
    returning * into conv;
  return pg_catalog.to_jsonb(conv) || pg_catalog.jsonb_build_object('acquired', true);
end;
$$;

create function public.release_assistant_conversation(
  p_user_id uuid,
  p_id uuid,
  p_device_id uuid,
  p_fence bigint
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  conv public.assistant_conversations;
begin
  if p_device_id is null or p_fence is null or p_fence < 0 then
    raise exception 'ASSISTANT_CONVERSATION_REJECTED' using errcode = '23514';
  end if;
  conv := public.assistant_fetch_conversation(p_id, p_user_id, true);
  if conv.lease_device_id is distinct from p_device_id or conv.fence is distinct from p_fence then
    return;
  end if;
  update public.assistant_conversations
    set lease_device_id = null,
        lease_expires_at = null,
        revision = revision + 1
    where id = conv.id;
end;
$$;

drop function public.append_assistant_message(uuid, uuid, uuid, text, text, text, uuid, jsonb, text, text);

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
  p_tool_outcome text,
  p_fence bigint default null
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
    return pg_catalog.to_jsonb(existing) || pg_catalog.jsonb_build_object('appended', false, 'revision', conv.revision);
  end if;
  if p_role in ('assistant', 'tool') then
    if p_fence is null
      or p_fence is distinct from conv.fence
      or conv.lease_device_id is distinct from p_source_device_id
      or conv.lease_expires_at is null
      or conv.lease_expires_at <= pg_catalog.now() then
      raise exception 'ASSISTANT_LEASE_LOST' using errcode = 'P0001';
    end if;
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
  return pg_catalog.to_jsonb(stored) || pg_catalog.jsonb_build_object('appended', true, 'revision', new_revision);
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
    return pg_catalog.to_jsonb(existing) || pg_catalog.jsonb_build_object('appended', false, 'revision', conv.revision);
end;
$$;

revoke all on function public.claim_assistant_conversation(uuid, uuid, uuid, integer, boolean) from public, anon;
revoke all on function public.release_assistant_conversation(uuid, uuid, uuid, bigint) from public, anon;
revoke all on function public.append_assistant_message(uuid, uuid, uuid, text, text, text, uuid, jsonb, text, text, bigint) from public, anon;

grant execute on function public.claim_assistant_conversation(uuid, uuid, uuid, integer, boolean) to authenticated;
grant execute on function public.release_assistant_conversation(uuid, uuid, uuid, bigint) to authenticated;
grant execute on function public.append_assistant_message(uuid, uuid, uuid, text, text, text, uuid, jsonb, text, text, bigint) to authenticated;
