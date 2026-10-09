-- Assistant Usage Analytics / Phase A.
-- Canonical, text-free events. Kept separate from dictation usage_days.
-- Writes share the usage_epoch lock used by clear_usage_analytics.

begin;

create table public.assistant_usage_events (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  device_id uuid not null,
  session_id uuid not null,
  conversation_id uuid,
  occurred_at timestamptz not null,
  local_day date not null,
  epoch bigint not null,
  kind text not null check (kind in ('session_started','user_turn','assistant_turn','active_interval','session_ended')),
  modality text check (modality in ('voice','typed','unknown')),
  duration_ms integer check (duration_ms is null or duration_ms between 0 and 120000),
  end_reason text check (end_reason in ('explicit','idle','signout','error')),
  created_at timestamptz not null default now(),
  check ((kind = 'active_interval') = (duration_ms is not null)),
  check ((kind = 'user_turn') = (modality is not null)),
  check ((kind = 'session_ended') = (end_reason is not null))
);
create index assistant_usage_events_user_day_idx
  on public.assistant_usage_events (user_id, local_day desc);
create index assistant_usage_events_user_session_idx
  on public.assistant_usage_events (user_id, session_id);
alter table public.assistant_usage_events enable row level security;
create policy "Users read their own Assistant usage" on public.assistant_usage_events
  for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.assistant_usage_events from public, anon, authenticated;
grant select on public.assistant_usage_events to authenticated;

-- Atomic ownership, privacy preference, epoch and retry/deduplication guard.
create function public.write_assistant_usage_event(
  p_id uuid,
  p_device_id uuid,
  p_session_id uuid,
  p_conversation_id uuid,
  p_occurred_at timestamptz,
  p_local_day date,
  p_epoch bigint,
  p_kind text,
  p_modality text default null,
  p_duration_ms integer default null,
  p_end_reason text default null
) returns void language plpgsql security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  current_epoch bigint := 0;
  allow_usage boolean := false;
begin
  if uid is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext(uid::text));
  select s.usage_epoch, s.usage_intelligence
    into current_epoch, allow_usage
    from public.settings s
    where s.user_id = uid
    for update;
  if not found then
    raise exception 'Usage settings unavailable' using errcode = '42501';
  end if;
  if not allow_usage or p_epoch is distinct from current_epoch then
    raise exception 'Usage disabled or epoch stale' using errcode = '42501';
  end if;
  if p_occurred_at > now() + interval '5 minutes'
     or p_occurred_at < now() - interval '14 days' then
    raise exception 'Usage timestamp outside allowed window' using errcode = '23514';
  end if;
  if p_kind not in ('session_started','user_turn','assistant_turn','active_interval','session_ended')
     or (p_kind = 'user_turn') is distinct from (p_modality is not null)
     or (p_kind = 'active_interval') is distinct from (p_duration_ms is not null)
     or (p_kind = 'session_ended') is distinct from (p_end_reason is not null)
     or (p_modality is not null and p_modality not in ('voice','typed','unknown'))
     or (p_end_reason is not null and p_end_reason not in ('explicit','idle','signout','error'))
     or (p_duration_ms is not null and (p_duration_ms < 0 or p_duration_ms > 120000)) then
    raise exception 'Invalid Assistant usage event' using errcode = '23514';
  end if;
  insert into public.assistant_usage_events
    (id,user_id,device_id,session_id,conversation_id,occurred_at,local_day,epoch,
      kind,modality,duration_ms,end_reason)
  values
    (p_id,uid,p_device_id,p_session_id,p_conversation_id,p_occurred_at,p_local_day,p_epoch,
      p_kind,p_modality,p_duration_ms,p_end_reason)
  on conflict (id) do nothing;
end;
$$;

-- A single account-level clear operation MUST invalidate assistant events too.
create or replace function public.clear_usage_analytics()
returns bigint language plpgsql security definer
set search_path = public, auth
as $$
declare
  uid uuid := auth.uid();
  next_epoch bigint;
begin
  if uid is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext(uid::text));
  perform set_config('app.usage_epoch_write', '1', true);
  insert into public.settings (user_id, smart_transcription, language, usage_intelligence, usage_epoch)
  values (uid, true, null, true, 0)
  on conflict (user_id) do nothing;
  update public.settings
    set usage_epoch = usage_epoch + 1
    where user_id = uid
    returning usage_epoch into next_epoch;
  delete from public.usage_days where user_id = uid;
  delete from public.assistant_usage_events where user_id = uid;
  return next_epoch;
end;
$$;

revoke all on function public.write_assistant_usage_event(uuid,uuid,uuid,uuid,timestamptz,date,bigint,text,text,integer,text)
  from public,anon;
grant execute on function public.write_assistant_usage_event(uuid,uuid,uuid,uuid,timestamptz,date,bigint,text,text,integer,text)
  to authenticated;
commit;
