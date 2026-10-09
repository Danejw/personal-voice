-- Durable Assistant session boundaries and reversible conversation archive.
-- No retention scheduler, no automatic deletes, and no rewrite of historical messages.
alter table public.assistant_conversations add column if not exists archived_at timestamptz;

create table if not exists public.assistant_sessions (
  id uuid primary key,
  conversation_id uuid not null references public.assistant_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  end_reason text check (end_reason in ('ended','interrupted','lost')),
  constraint assistant_sessions_end_chk check (
    (ended_at is null and end_reason is null) or (ended_at is not null and end_reason is not null)
  )
);
create index if not exists assistant_sessions_conversation_recent_idx
  on public.assistant_sessions (conversation_id, started_at desc, id desc);
create index if not exists assistant_sessions_user_recent_idx
  on public.assistant_sessions (user_id, started_at desc);

alter table public.assistant_messages add column if not exists session_id uuid
  references public.assistant_sessions(id) on delete set null;
create index if not exists assistant_messages_session_seq_idx
  on public.assistant_messages (session_id, seq) where session_id is not null;

alter table public.assistant_sessions enable row level security;
create policy "Account owns its Assistant sessions"
  on public.assistant_sessions for select to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.assistant_conversations c
      where c.id = conversation_id and c.user_id = (select auth.uid()) and c.deleted_at is null
    )
  );
revoke all on public.assistant_sessions from anon, authenticated;
grant select on public.assistant_sessions to authenticated;

-- Attribute newly appended rows to the same device's open session.
-- Existing rows remain unassigned rather than fabricating historical boundaries.
create function public.assistant_assign_message_session() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.session_id is null then
    select s.id into new.session_id from public.assistant_sessions s
    where s.user_id = new.user_id
      and s.conversation_id = new.conversation_id
      and s.device_id = new.source_device_id
      and s.ended_at is null
      and s.started_at <= now()
    order by s.started_at desc, s.id desc limit 1;
  end if;
  return new;
end;
$$;
create trigger assistant_messages_assign_session
  before insert on public.assistant_messages
  for each row execute function public.assistant_assign_message_session();

-- Start requires the producer lease; a crashed device's previous open session
-- is closed as interrupted when it obtains a new lease and starts again.
create function public.start_assistant_session(
  p_user_id uuid, p_conversation_id uuid, p_device_id uuid, p_session_id uuid
) returns public.assistant_sessions
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid;
  conv public.assistant_conversations;
  created public.assistant_sessions;
begin
  uid := public.assistant_require_account(p_user_id);
  if p_session_id is null or p_device_id is null then
    raise exception 'ASSISTANT_SESSION_REJECTED' using errcode = '23514';
  end if;
  perform public.assistant_lock(p_conversation_id, null);
  select * into conv from public.assistant_conversations where id=p_conversation_id for update;
  if not found or conv.user_id is distinct from uid or conv.deleted_at is not null
     or conv.archived_at is not null
     or conv.lease_device_id is distinct from p_device_id
     or conv.lease_expires_at <= now() then
    raise exception 'ASSISTANT_SESSION_NOT_OWNED' using errcode = '42501';
  end if;
  select * into created from public.assistant_sessions where id=p_session_id;
  if found then
    if created.user_id is distinct from uid or created.conversation_id is distinct from p_conversation_id
       or created.device_id is distinct from p_device_id then
      raise exception 'ASSISTANT_SESSION_CONFLICT' using errcode = '23514';
    end if;
    return created;
  end if;
  update public.assistant_sessions
    set ended_at=now(), end_reason='interrupted'
    where user_id=uid and conversation_id=p_conversation_id
      and device_id=p_device_id and ended_at is null;
  insert into public.assistant_sessions(id,conversation_id,user_id,device_id)
    values(p_session_id,p_conversation_id,uid,p_device_id) returning * into created;
  return created;
end; $$;

create function public.finish_assistant_session(
  p_user_id uuid, p_session_id uuid, p_reason text
) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid;
begin
  uid := public.assistant_require_account(p_user_id);
  if p_reason not in ('ended','interrupted','lost') then
    raise exception 'ASSISTANT_SESSION_REJECTED' using errcode='23514';
  end if;
  update public.assistant_sessions
    set ended_at=now(),end_reason=p_reason
    where id=p_session_id and user_id=uid and ended_at is null;
end; $$;

create function public.list_assistant_sessions(
  p_user_id uuid, p_conversation_id uuid, p_limit integer,
  p_before_started_at timestamptz default null, p_before_id uuid default null
) returns setof public.assistant_sessions
language plpgsql security definer set search_path = '' as $$
begin
  perform public.assistant_fetch_conversation(p_conversation_id,p_user_id,false);
  if p_limit is null or p_limit < 1 or p_limit > 100 or
     (p_before_started_at is null) is distinct from (p_before_id is null) then
    raise exception 'ASSISTANT_PAGE_REJECTED' using errcode='23514';
  end if;
  return query
    select s.* from public.assistant_sessions s
    where s.conversation_id=p_conversation_id
      and (p_before_started_at is null or (s.started_at,s.id) < (p_before_started_at,p_before_id))
    order by s.started_at desc,s.id desc limit p_limit;
end; $$;

create function public.list_assistant_session_messages(
  p_user_id uuid, p_conversation_id uuid, p_session_id uuid,
  p_after_seq bigint, p_limit integer
) returns setof public.assistant_messages
language plpgsql security definer set search_path = '' as $$
begin
  perform public.assistant_fetch_conversation(p_conversation_id,p_user_id,false);
  if p_after_seq is null or p_after_seq < 0 or p_limit is null or p_limit < 1 or p_limit > 100
     or not exists (select 1 from public.assistant_sessions
                    where id=p_session_id and conversation_id=p_conversation_id and user_id=p_user_id) then
    raise exception 'ASSISTANT_PAGE_REJECTED' using errcode='23514';
  end if;
  return query
    select m.* from public.assistant_messages m
    where m.conversation_id=p_conversation_id and m.session_id=p_session_id
      and m.seq > p_after_seq
    order by m.seq asc limit p_limit;
end; $$;

-- Archiving hides a conversation from the default list, but keeps every message.
-- No user data is modified by merely listing archived rows.
create function public.set_assistant_conversation_archived(
  p_user_id uuid, p_id uuid, p_archived boolean
) returns public.assistant_conversations
language plpgsql security definer set search_path = '' as $$
declare conv public.assistant_conversations;
begin
  perform public.assistant_require_account(p_user_id);
  perform public.assistant_lock(p_id,null);
  select * into conv from public.assistant_conversations
    where id=p_id and user_id=p_user_id and deleted_at is null for update;
  if not found then raise exception 'ASSISTANT_CONVERSATION_NOT_FOUND' using errcode='P0001'; end if;
  if p_archived is null then raise exception 'ASSISTANT_PAGE_REJECTED' using errcode='23514'; end if;
  update public.assistant_conversations
    set archived_at=case when p_archived then coalesce(archived_at,now()) else null end,
        lease_device_id=case when p_archived then null else lease_device_id end,
        lease_expires_at=case when p_archived then null else lease_expires_at end,
        fence=fence + case when p_archived then 1 else 0 end
    where id=p_id returning * into conv;
  return conv;
end; $$;

create or replace function public.list_assistant_conversations(
  p_user_id uuid, p_limit integer, p_before_updated_at timestamptz default null,
  p_before_id uuid default null
) returns setof public.assistant_conversations
language plpgsql security definer set search_path = '' as $$
begin
  perform public.assistant_require_account(p_user_id);
  if p_limit is null or p_limit < 1 or p_limit > 100
    or (p_before_updated_at is null) is distinct from (p_before_id is null) then
    raise exception 'ASSISTANT_PAGE_REJECTED' using errcode='23514';
  end if;
  return query select c.* from public.assistant_conversations c
    where c.user_id=p_user_id and c.deleted_at is null and c.archived_at is null
      and (p_before_updated_at is null or (c.updated_at,c.id) < (p_before_updated_at,p_before_id))
    order by c.updated_at desc,c.id desc limit p_limit;
end; $$;

create function public.list_archived_assistant_conversations(
  p_user_id uuid,p_limit integer,p_before_updated_at timestamptz default null,
  p_before_id uuid default null
) returns setof public.assistant_conversations
language plpgsql security definer set search_path = '' as $$
begin
  perform public.assistant_require_account(p_user_id);
  if p_limit is null or p_limit < 1 or p_limit > 100
    or (p_before_updated_at is null) is distinct from (p_before_id is null) then
    raise exception 'ASSISTANT_PAGE_REJECTED' using errcode='23514';
  end if;
  return query select c.* from public.assistant_conversations c
    where c.user_id=p_user_id and c.deleted_at is null and c.archived_at is not null
      and (p_before_updated_at is null or (c.updated_at,c.id) < (p_before_updated_at,p_before_id))
    order by c.updated_at desc,c.id desc limit p_limit;
end; $$;

revoke all on function public.assistant_assign_message_session() from public,anon,authenticated;
revoke all on function public.start_assistant_session(uuid,uuid,uuid,uuid) from public,anon;
revoke all on function public.finish_assistant_session(uuid,uuid,text) from public,anon;
revoke all on function public.list_assistant_sessions(uuid,uuid,integer,timestamptz,uuid) from public,anon;
revoke all on function public.list_assistant_session_messages(uuid,uuid,uuid,bigint,integer) from public,anon;
revoke all on function public.set_assistant_conversation_archived(uuid,uuid,boolean) from public,anon;
revoke all on function public.list_archived_assistant_conversations(uuid,integer,timestamptz,uuid) from public,anon;
grant execute on function public.start_assistant_session(uuid,uuid,uuid,uuid) to authenticated;
grant execute on function public.finish_assistant_session(uuid,uuid,text) to authenticated;
grant execute on function public.list_assistant_sessions(uuid,uuid,integer,timestamptz,uuid) to authenticated;
grant execute on function public.list_assistant_session_messages(uuid,uuid,uuid,bigint,integer) to authenticated;
grant execute on function public.set_assistant_conversation_archived(uuid,uuid,boolean) to authenticated;
grant execute on function public.list_archived_assistant_conversations(uuid,integer,timestamptz,uuid) to authenticated;
