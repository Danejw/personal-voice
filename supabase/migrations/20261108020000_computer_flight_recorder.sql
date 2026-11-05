-- A minimal, append-only, user-owned flight recorder for cross-device Computer Use.
-- No screenshots, prompts, typed text, action coordinates, or raw exception messages.
create table public.computer_task_events (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  trace_id uuid not null,
  device_id uuid not null references public.devices(id) on delete cascade,
  actor text not null check (actor in ('android', 'windows')),
  stage text not null check (stage in (
    'queued', 'received', 'authorized', 'started', 'screen', 'model', 'acted',
    'acknowledged', 'verified', 'unverified', 'stopped', 'blocked', 'failed', 'timeout'
  )),
  action_kind text check (action_kind ~ '^[a-z_]{1,32}$'),
  step integer check (step between 0 and 240),
  failure_code text check (failure_code in (
    'network', 'auth', 'locked', 'timeout', 'model', 'tool', 'capture',
    'verification', 'unknown', 'refused', 'cancelled', 'unavailable'
  )),
  occurred_at timestamptz not null default now(),
  recorded_at timestamptz not null default now(),
  constraint computer_task_events_timestamp_check check (occurred_at <= recorded_at + interval '5 minutes')
);

create index computer_task_events_recent on public.computer_task_events
  (user_id, occurred_at desc, id desc);
create index computer_task_events_trace on public.computer_task_events
  (user_id, trace_id, occurred_at asc, id asc);

alter table public.computer_task_events enable row level security;
revoke all on public.computer_task_events from public, anon, authenticated;
grant select, insert, delete on public.computer_task_events to authenticated;

create policy computer_task_events_read on public.computer_task_events
  for select to authenticated using (user_id = (select auth.uid()));
create policy computer_task_events_insert on public.computer_task_events
  for insert to authenticated with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.devices d
      where d.id = computer_task_events.device_id
        and d.user_id = computer_task_events.user_id
        and d.platform = computer_task_events.actor
    )
  );
create policy computer_task_events_delete on public.computer_task_events
  for delete to authenticated using (user_id = (select auth.uid()));

comment on table public.computer_task_events is
  'Append-only, per-account Computer Use diagnostics. Events are observational, not signed proofs of execution.';
