-- PV3: intentionally send text between devices through Supabase.

create table public.handoffs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  text text not null check (char_length(text) between 1 and 100000 and text = btrim(text)),
  source_device_id uuid not null,
  -- Null makes the handoff available to every other device owned by this user.
  target_device_id uuid,
  created_at timestamptz not null default now(),
  consumed_at timestamptz
);

create index handoffs_user_target_pending_idx
  on public.handoffs (user_id, target_device_id, consumed_at, created_at desc);

alter table public.handoffs enable row level security;

create policy "Users manage their own handoffs" on public.handoffs
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on public.handoffs from anon;
grant select, insert, update, delete on public.handoffs to authenticated;
