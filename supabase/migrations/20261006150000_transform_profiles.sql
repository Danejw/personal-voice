-- Account-synced custom text transform profiles. Built-ins live in the client and use the same runtime shape.

begin;

create table public.transform_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  instruction text not null check (char_length(btrim(instruction)) between 1 and 20000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index transform_profiles_user_created_idx
  on public.transform_profiles (user_id, created_at);

alter table public.transform_profiles enable row level security;

create policy "Users manage their own transform profiles"
  on public.transform_profiles
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger transform_profiles_touch_updated_at
  before update on public.transform_profiles
  for each row execute function public.touch_updated_at();

grant select, insert, update, delete on public.transform_profiles to authenticated;
revoke all on public.transform_profiles from anon;

comment on table public.transform_profiles is
  'User-created reusable text transformations. Built-in transforms are defined in the client.';

commit;
