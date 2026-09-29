-- Assistant 14: one owned device asks another to run an allowlisted action.
-- Shell is not a permitted action. The row is deleted after the requester reads it.

create table public.device_action_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  requester_device_id uuid not null,
  target_device_id uuid not null,
  version integer not null default 1 check (version = 1),
  action text not null check (action in ('open_app', 'press_shortcut', 'insert_text')),
  argument text not null check (char_length(argument) between 1 and 2000 and argument = btrim(argument)),
  status text not null default 'pending' check (status in ('pending', 'answered', 'denied')),
  result text check (result is null or (char_length(result) between 1 and 2000 and result = btrim(result))),
  error text check (error is null or (char_length(error) between 1 and 500 and error = btrim(error))),
  created_at timestamptz not null default now(),
  answered_at timestamptz
);

create index device_action_requests_target_pending_idx
  on public.device_action_requests (user_id, target_device_id, status, created_at);

alter table public.device_action_requests enable row level security;

create policy "Users manage their own device action requests" on public.device_action_requests
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on public.device_action_requests from anon;
grant select, insert, update, delete on public.device_action_requests to authenticated;
