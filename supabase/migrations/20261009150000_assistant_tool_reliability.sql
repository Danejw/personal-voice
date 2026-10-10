-- Phase B: privacy-preserving Assistant tool-attempt analytics.
-- Requires 20261009140000_assistant_usage_analytics.sql (Phase A).
-- This table does NOT store prompts, tool arguments, response text or execution targets.
begin;

create table public.assistant_tool_attempts (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid not null,
  epoch bigint not null,
  occurred_at timestamptz not null,
  local_day date not null,
  tool text not null check (tool ~ '^[a-z][a-z0-9_]{0,79}$'),
  family text not null check (family in ('text','devices','visual','session','windows','memory','analytics','harness','unknown')),
  outcome text not null check (outcome in ('observed','acknowledged','reference','incomplete','failed','cancelled','blocked')),
  failure_kind text check (failure_kind in ('cancelled','busy','invalid_arguments','stale_target','offline','unavailable','transient','unknown')),
  elapsed_ms integer not null check (elapsed_ms between 0 and 3600000),
  -- Reserved for external verification; never set from a tool's own acknowledgement.
  goal_verified boolean,
  created_at timestamptz not null default now(),
  check (goal_verified is null)
);
create index assistant_tool_attempts_user_day_idx
  on public.assistant_tool_attempts(user_id,local_day desc);
create index assistant_tool_attempts_user_tool_idx
  on public.assistant_tool_attempts(user_id,tool,local_day desc);
alter table public.assistant_tool_attempts enable row level security;
create policy "Users read their own Assistant tool metrics"
  on public.assistant_tool_attempts for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.assistant_tool_attempts from public,anon,authenticated;
grant select on public.assistant_tool_attempts to authenticated;

create function public.write_assistant_tool_attempt(
  p_id uuid,
  p_device_id uuid,
  p_epoch bigint,
  p_occurred_at timestamptz,
  p_local_day date,
  p_tool text,
  p_family text,
  p_outcome text,
  p_failure_kind text,
  p_elapsed_ms integer
) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  current_epoch bigint;
  consent boolean;
begin
  if uid is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext(uid::text));
  select s.usage_epoch, s.usage_intelligence into current_epoch,consent
  from public.settings s where s.user_id = uid for update;
  if not found or not consent or current_epoch is distinct from p_epoch then
    raise exception 'Usage disabled or epoch stale' using errcode = '42501';
  end if;
  if p_occurred_at > now() + interval '5 minutes'
     or p_occurred_at < now() - interval '14 days'
     or p_local_day is null
     or p_tool !~ '^[a-z][a-z0-9_]{0,79}$'
     or p_family not in ('text','devices','visual','session','windows','memory','analytics','harness','unknown')
     or p_outcome not in ('observed','acknowledged','reference','incomplete','failed','cancelled','blocked')
     or (p_failure_kind is not null and p_failure_kind not in
         ('cancelled','busy','invalid_arguments','stale_target','offline','unavailable','transient','unknown'))
     or p_elapsed_ms is null or p_elapsed_ms < 0 or p_elapsed_ms > 3600000 then
    raise exception 'Invalid Assistant tool metric' using errcode = '23514';
  end if;
  insert into public.assistant_tool_attempts
    (id,user_id,device_id,epoch,occurred_at,local_day,tool,family,outcome,failure_kind,elapsed_ms)
  values
    (p_id,uid,p_device_id,p_epoch,p_occurred_at,p_local_day,p_tool,p_family,p_outcome,p_failure_kind,p_elapsed_ms)
  on conflict (id) do nothing;
end;
$$;

-- Keep a single clear action atomic across dictation, Assistant turns and tools.
create or replace function public.clear_usage_analytics()
returns bigint language plpgsql security definer
set search_path = public,auth
as $$
declare
  uid uuid := auth.uid();
  next_epoch bigint;
begin
  if uid is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext(uid::text));
  perform set_config('app.usage_epoch_write','1',true);
  insert into public.settings(user_id,smart_transcription,language,usage_intelligence,usage_epoch)
  values(uid,true,null,true,0)
  on conflict(user_id) do nothing;
  update public.settings set usage_epoch = usage_epoch + 1 where user_id = uid
    returning usage_epoch into next_epoch;
  delete from public.usage_days where user_id = uid;
  delete from public.assistant_usage_events where user_id = uid;
  delete from public.assistant_tool_attempts where user_id = uid;
  return next_epoch;
end;
$$;

revoke all on function public.write_assistant_tool_attempt(uuid,uuid,bigint,timestamptz,date,text,text,text,text,integer)
  from public,anon;
grant execute on function public.write_assistant_tool_attempt(uuid,uuid,bigint,timestamptz,date,text,text,text,text,integer)
  to authenticated;
commit;
