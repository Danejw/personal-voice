-- Platform-scoped preferences (hotkeys, etc.): one row per (user, OS family).
-- Windows installs share Windows prefs; Android never receives Windows hotkeys.

create table public.platform_preferences (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  platform text not null check (platform in ('windows', 'android', 'macos', 'ios', 'linux')),
  prefs jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, platform)
);

create trigger platform_preferences_touch_updated_at before update on public.platform_preferences
  for each row execute function public.touch_updated_at();

alter table public.platform_preferences enable row level security;

create policy "Users manage their own platform preferences" on public.platform_preferences
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on public.platform_preferences from anon;
grant select, insert, update, delete on public.platform_preferences to authenticated;

-- Future OS installs share the same allowed set as platform_preferences.
alter table public.devices drop constraint devices_platform_check;
alter table public.devices add constraint devices_platform_check
  check (platform in ('windows', 'android', 'macos', 'ios', 'linux'));
