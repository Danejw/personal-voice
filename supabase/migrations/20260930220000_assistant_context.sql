-- Saved context for a new Assistant session.
--
-- A summary covers an exact message prefix: the last sequence included and a
-- fingerprint of those rows. A newer prefix can replace it. The same fingerprint
-- is kept. A different fingerprint must name the fingerprint it replaces, so two
-- writers cannot both win. Deleting the conversation clears the summary.
--
-- context_items holds notes, a selection, a handoff, and screenshot metadata.
-- A screenshot row has no image. Pixels are not stored.

alter table public.assistant_conversations
  add column summary_body text,
  add column summary_through_seq bigint,
  add column summary_fingerprint text,
  add column context_items jsonb not null default '[]'::jsonb;

alter table public.assistant_conversations
  add constraint assistant_summary_shape check (
    (
      summary_body is null
      and summary_through_seq is null
      and summary_fingerprint is null
    )
    or (
      summary_body is not null
      and char_length(btrim(summary_body)) between 1 and 2000
      and summary_body is not distinct from btrim(summary_body)
      and summary_through_seq is not null
      and summary_through_seq >= 1
      and summary_fingerprint is not null
      and summary_fingerprint ~ '^[0-9a-f]{8}$'
    )
  );

alter table public.assistant_conversations
  add constraint assistant_context_items_shape check (
    pg_catalog.jsonb_typeof(context_items) = 'array'
    and pg_catalog.jsonb_array_length(context_items) <= 12
  );

create function public.assistant_context_items(p_items jsonb) returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  item jsonb;
  kind text;
  notes int := 0;
  selections int := 0;
  handoffs int := 0;
  screenshots int := 0;
  body text;
  source text;
  captured text;
begin
  if p_items is null or pg_catalog.jsonb_typeof(p_items) is distinct from 'array'
    or pg_catalog.jsonb_array_length(p_items) > 12 then
    raise exception 'ASSISTANT_CONTEXT_REJECTED' using errcode = '23514';
  end if;
  for item in select value from pg_catalog.jsonb_array_elements(p_items) loop
    if pg_catalog.jsonb_typeof(item) is distinct from 'object'
      or exists (
        select 1 from pg_catalog.jsonb_object_keys(item) as item_key
        where item_key not in ('kind', 'id', 'body', 'captured_at', 'source')
      ) then
      raise exception 'ASSISTANT_CONTEXT_REJECTED' using errcode = '23514';
    end if;
    kind := item->>'kind';
    body := item->>'body';
    source := item->>'source';
    captured := item->>'captured_at';
    if item->>'id' is null or item->>'id' !~ '^[A-Za-z0-9-]{1,80}$'
      or kind is null or captured is null or source is null or body is null
      or char_length(source) > 120
      or captured !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' then
      raise exception 'ASSISTANT_CONTEXT_REJECTED' using errcode = '23514';
    end if;
    if kind = 'screenshot' then
      screenshots := screenshots + 1;
      if body is distinct from '' or source not in ('window', 'screen') then
        raise exception 'ASSISTANT_CONTEXT_REJECTED' using errcode = '23514';
      end if;
    elsif kind in ('note', 'selection', 'handoff') then
      if kind = 'note' then notes := notes + 1; end if;
      if kind = 'selection' then selections := selections + 1; end if;
      if kind = 'handoff' then handoffs := handoffs + 1; end if;
      if char_length(btrim(body)) < 1 or char_length(body) > 8000 or body is distinct from btrim(body) then
        raise exception 'ASSISTANT_CONTEXT_REJECTED' using errcode = '23514';
      end if;
    else
      raise exception 'ASSISTANT_CONTEXT_REJECTED' using errcode = '23514';
    end if;
  end loop;
  if notes > 8 or selections > 1 or handoffs > 1 or screenshots > 1 then
    raise exception 'ASSISTANT_CONTEXT_REJECTED' using errcode = '23514';
  end if;
  return p_items;
end;
$$;

create function public.save_assistant_summary(
  p_user_id uuid,
  p_id uuid,
  p_body text,
  p_through_seq bigint,
  p_fingerprint text,
  p_replaces text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  conv public.assistant_conversations;
  covered bigint;
  top_seq bigint;
begin
  if p_body is null or char_length(btrim(p_body)) < 1 or char_length(p_body) > 2000
    or p_body is distinct from btrim(p_body)
    or p_through_seq is null or p_through_seq < 1
    or p_fingerprint is null or p_fingerprint !~ '^[0-9a-f]{8}$'
    or (p_replaces is not null and p_replaces !~ '^[0-9a-f]{8}$') then
    raise exception 'ASSISTANT_CONVERSATION_REJECTED' using errcode = '23514';
  end if;
  conv := public.assistant_fetch_conversation(p_id, p_user_id, true);
  select count(*)::bigint, max(seq) into covered, top_seq
  from public.assistant_messages
  where conversation_id = conv.id and seq <= p_through_seq;
  if top_seq is distinct from p_through_seq or covered < 1 then
    raise exception 'ASSISTANT_SUMMARY_STALE' using errcode = 'P0001';
  end if;
  if conv.summary_fingerprint is not null and conv.summary_fingerprint = p_fingerprint then
    return pg_catalog.to_jsonb(conv) || pg_catalog.jsonb_build_object('saved', false);
  end if;
  if conv.summary_through_seq is not null and p_through_seq < conv.summary_through_seq then
    raise exception 'ASSISTANT_SUMMARY_STALE' using errcode = 'P0001';
  end if;
  if conv.summary_fingerprint is not null and conv.summary_fingerprint is distinct from p_fingerprint then
    if p_replaces is distinct from conv.summary_fingerprint then
      raise exception 'ASSISTANT_SUMMARY_CONFLICT' using errcode = 'P0001';
    end if;
  end if;
  update public.assistant_conversations
    set summary_body = p_body,
        summary_through_seq = p_through_seq,
        summary_fingerprint = p_fingerprint,
        revision = revision + 1
    where id = conv.id
    returning * into conv;
  return pg_catalog.to_jsonb(conv) || pg_catalog.jsonb_build_object('saved', true);
end;
$$;

create function public.save_assistant_context_items(
  p_user_id uuid,
  p_id uuid,
  p_items jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  conv public.assistant_conversations;
  items jsonb;
begin
  items := public.assistant_context_items(p_items);
  conv := public.assistant_fetch_conversation(p_id, p_user_id, true);
  if conv.context_items = items then
    return pg_catalog.to_jsonb(conv);
  end if;
  update public.assistant_conversations
    set context_items = items,
        revision = revision + 1
    where id = conv.id
    returning * into conv;
  return pg_catalog.to_jsonb(conv);
end;
$$;

create or replace function public.delete_assistant_conversation(p_user_id uuid, p_id uuid) returns void
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
        deleted_at = pg_catalog.now(),
        lease_device_id = null,
        lease_expires_at = null,
        summary_body = null,
        summary_through_seq = null,
        summary_fingerprint = null,
        context_items = '[]'::jsonb,
        fence = fence + 1,
        revision = revision + 1
    where id = conv.id;
end;
$$;

revoke all on function public.assistant_context_items(jsonb) from public, anon, authenticated;
revoke all on function public.save_assistant_summary(uuid, uuid, text, bigint, text, text) from public, anon;
revoke all on function public.save_assistant_context_items(uuid, uuid, jsonb) from public, anon;

grant execute on function public.save_assistant_summary(uuid, uuid, text, bigint, text, text) to authenticated;
grant execute on function public.save_assistant_context_items(uuid, uuid, jsonb) to authenticated;
