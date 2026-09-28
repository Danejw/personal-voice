-- Phase 5: per-user dictionary, synced settings, and device records.
-- Every table is owned through user_id and protected by RLS; clients only see their own rows.

create table public.devices (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  platform text not null check (platform in ('windows', 'android')),
  last_seen timestamptz,
  created_at timestamptz not null default now()
);
create index devices_user_id_idx on public.devices (user_id);

create table public.dictionary (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  term text not null check (char_length(term) between 1 and 100 and term = btrim(term)),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- "Persyn" and "persyn" bias recognition identically, so they are one term.
create unique index dictionary_user_term_key on public.dictionary (user_id, lower(term));

create table public.settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  smart_transcription boolean not null default true,
  -- BCP-47 code such as en-US; null means automatic language detection.
  language text check (language ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  updated_at timestamptz not null default now()
);

create function public.touch_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger dictionary_touch_updated_at before update on public.dictionary
  for each row execute function public.touch_updated_at();
create trigger settings_touch_updated_at before update on public.settings
  for each row execute function public.touch_updated_at();

-- Keeps the vocabulary curated; Gemini accepts up to 1,000 terms but works best near 100.
create function public.enforce_dictionary_limit() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.dictionary where user_id = new.user_id) >= 200 then
    raise exception 'Dictionary is limited to 200 terms.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger dictionary_limit before insert on public.dictionary
  for each row execute function public.enforce_dictionary_limit();

alter table public.devices enable row level security;
alter table public.dictionary enable row level security;
alter table public.settings enable row level security;

create policy "Users manage their own devices" on public.devices
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "Users manage their own dictionary" on public.dictionary
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "Users manage their own settings" on public.settings
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on public.devices, public.dictionary, public.settings from anon;
grant select, insert, update, delete on public.devices, public.dictionary, public.settings to authenticated;
revoke execute on function public.touch_updated_at(), public.enforce_dictionary_limit() from public, anon, authenticated;
