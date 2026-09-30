-- Opt-in account history. Off until settings.cloud_dictation_history is true.
-- Final text only. No audio.

alter table public.settings
  add column cloud_dictation_history boolean not null default false;

create table public.dictations (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  text text not null check (char_length(text) between 1 and 100000 and text = btrim(text)),
  destination text not null check (destination in ('active-field', 'voice-note', 'send-to-device')),
  outcome text not null check (outcome in ('success', 'failure')),
  source_device_id uuid not null,
  created_at timestamptz not null
);

create index dictations_user_created_idx
  on public.dictations (user_id, created_at desc);

alter table public.dictations enable row level security;

create policy "Users manage their own dictations" on public.dictations
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on public.dictations from anon;
grant select, insert, delete on public.dictations to authenticated;
