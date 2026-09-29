-- Assistant 12: one owned device asks another for a read-only look.
-- The row is deleted after the requester reads it. Nothing here clicks or types.

create table public.device_context_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  requester_device_id uuid not null,
  target_device_id uuid not null,
  version integer not null default 1 check (version = 1),
  kind text not null check (kind in ('presence', 'active_window', 'windows', 'screenshot')),
  status text not null default 'pending' check (status in ('pending', 'answered', 'denied')),
  response text check (response is null or char_length(response) between 1 and 400000),
  error text check (error is null or (char_length(error) between 1 and 500 and error = btrim(error))),
  created_at timestamptz not null default now(),
  answered_at timestamptz
);

create index device_context_requests_target_pending_idx
  on public.device_context_requests (user_id, target_device_id, status, created_at);

alter table public.device_context_requests enable row level security;

create policy "Users manage their own device context requests" on public.device_context_requests
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on public.device_context_requests from anon;
grant select, insert, update, delete on public.device_context_requests to authenticated;
