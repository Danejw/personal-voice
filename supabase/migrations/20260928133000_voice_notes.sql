-- PV1: explicitly saved, synced voice notes. This is not automatic transcript history.

create table public.voice_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  text text not null check (char_length(text) between 1 and 100000 and text = btrim(text)),
  -- Reuses the stable per-account ID stored by each app install. No foreign key: device
  -- registration is best-effort and must not race note creation on a new installation.
  source_device_id uuid not null,
  status text not null default 'inbox' check (status in ('inbox', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index voice_notes_user_status_created_idx
  on public.voice_notes (user_id, status, created_at desc);

create trigger voice_notes_touch_updated_at before update on public.voice_notes
  for each row execute function public.touch_updated_at();

alter table public.voice_notes enable row level security;

create policy "Users manage their own voice notes" on public.voice_notes
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on public.voice_notes from anon;
grant select, insert, update, delete on public.voice_notes to authenticated;
