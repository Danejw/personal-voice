-- Private, account-owned spatial worlds. No public or anonymous read access.
create table public.spatial_environments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  scene_config jsonb not null default '{"kind":"terrain","palette":"cyan"}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, id),
  constraint spatial_scene_config check (
    jsonb_typeof(scene_config) = 'object'
    and scene_config ? 'kind' and scene_config ? 'palette'
    and scene_config->>'kind' = 'terrain'
    and scene_config->>'palette' in ('cyan','violet','amber')
  )
);
create index spatial_environments_owner_idx on public.spatial_environments(owner_id, created_at);
alter table public.spatial_environments enable row level security;
create policy "Owners manage their environments" on public.spatial_environments
  for all to authenticated using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create table public.spatial_environment_selection (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  environment_id uuid not null,
  constraint selection_owned_environment foreign key (owner_id, environment_id)
    references public.spatial_environments(owner_id, id) on delete cascade
);
alter table public.spatial_environment_selection enable row level security;
create policy "Owners manage their active environment" on public.spatial_environment_selection
  for all to authenticated using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- A placeholder for future interactive, typed spatial objects. Objects are not yet executable code.
create table public.spatial_environment_objects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  environment_id uuid not null,
  kind text not null check (kind in ('model','agent-link','note')),
  transform jsonb not null default '{"position":[0,0,0],"rotation":[0,0,0],"scale":[1,1,1]}'::jsonb,
  configuration jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint object_owned_environment foreign key (owner_id, environment_id)
    references public.spatial_environments(owner_id, id) on delete cascade
);
create index spatial_objects_environment_idx on public.spatial_environment_objects(owner_id, environment_id);
alter table public.spatial_environment_objects enable row level security;
create policy "Owners manage their objects" on public.spatial_environment_objects
  for all to authenticated using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

revoke all on public.spatial_environments, public.spatial_environment_selection, public.spatial_environment_objects from anon;
grant select, insert, update, delete on public.spatial_environments, public.spatial_environment_selection, public.spatial_environment_objects to authenticated;
