-- Personal analytics. One row per device per local day. Clients may only read.
-- Epoch changes and day writes go through security-definer functions that lock the user.

alter table public.settings
  add column if not exists usage_epoch bigint not null default 0;

create table public.usage_days (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  device_id uuid not null,
  day date not null,
  epoch bigint not null,
  counters jsonb not null,
  revision bigint not null check (revision > 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, device_id, day)
);

create index usage_days_user_day_idx on public.usage_days (user_id, day desc, device_id);

alter table public.usage_days enable row level security;

create policy "Users read their own usage days"
  on public.usage_days
  for select
  to authenticated
  using (user_id = (select auth.uid()));

revoke all on table public.usage_days from public, anon, authenticated;
grant select on table public.usage_days to authenticated;

-- Client upserts of settings must not move the epoch. Only clear_usage_analytics sets the bypass.
create or replace function public.protect_usage_epoch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if coalesce(current_setting('app.usage_epoch_write', true), '') is distinct from '1' then
      new.usage_epoch := 0;
    end if;
  elsif tg_op = 'UPDATE' then
    if coalesce(current_setting('app.usage_epoch_write', true), '') is distinct from '1' then
      new.usage_epoch := old.usage_epoch;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists settings_protect_usage_epoch on public.settings;
create trigger settings_protect_usage_epoch
  before insert or update on public.settings
  for each row execute function public.protect_usage_epoch();

create or replace function public.upsert_usage_day(
  p_device_id uuid,
  p_day date,
  p_epoch bigint,
  p_counters jsonb,
  p_revision bigint,
  p_updated_at timestamptz
) returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  uid uuid := auth.uid();
  current_epoch bigint := 0;
begin
  if uid is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext(uid::text));
  select usage_epoch into current_epoch
  from public.settings
  where user_id = uid
  for update;
  if not found then
    current_epoch := 0;
  end if;
  if p_epoch is distinct from current_epoch then
    raise exception 'Usage epoch is stale' using errcode = '42501';
  end if;
  insert into public.usage_days as days (user_id, device_id, day, epoch, counters, revision, updated_at)
  values (uid, p_device_id, p_day, p_epoch, p_counters, p_revision, p_updated_at)
  on conflict (user_id, device_id, day) do update
    set counters = excluded.counters,
        epoch = excluded.epoch,
        revision = excluded.revision,
        updated_at = excluded.updated_at
    where days.revision < excluded.revision;
end;
$$;

create or replace function public.clear_usage_analytics()
returns bigint
language plpgsql
security definer
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
  return next_epoch;
end;
$$;

revoke all on function public.protect_usage_epoch() from public, anon, authenticated;
revoke all on function public.upsert_usage_day(uuid, date, bigint, jsonb, bigint, timestamptz) from public, anon;
revoke all on function public.clear_usage_analytics() from public, anon;
grant execute on function public.upsert_usage_day(uuid, date, bigint, jsonb, bigint, timestamptz) to authenticated;
grant execute on function public.clear_usage_analytics() to authenticated;
