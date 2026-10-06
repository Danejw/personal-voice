-- Account-synced custom text transforms. Built-in transforms remain client-defined and immutable.

begin;

create table public.transform_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80 and name = btrim(name)),
  instruction text not null check (char_length(instruction) between 1 and 20000 and instruction = btrim(instruction)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index transform_profiles_user_name_idx
  on public.transform_profiles (user_id, lower(name));

create index transform_profiles_user_updated_idx
  on public.transform_profiles (user_id, updated_at desc);

create trigger transform_profiles_touch_updated_at
  before update on public.transform_profiles
  for each row execute function public.touch_updated_at();

alter table public.transform_profiles enable row level security;

create policy "Users manage their own transform profiles" on public.transform_profiles
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on public.transform_profiles from anon;
grant select, insert, update, delete on public.transform_profiles to authenticated;

comment on table public.transform_profiles is
  'User-created reusable text rewrite instructions. Built-in profiles such as Polish and Prompt Engineer live in the client.';

commit;
