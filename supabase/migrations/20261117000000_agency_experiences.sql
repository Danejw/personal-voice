-- Agency MCP phase 1: operational experiences (not personal memories or analytics).
-- Additive, owner-scoped, no automatic sharing. Apply only after review.
begin;

create table public.agency_experiences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  idempotency_key uuid not null,
  objective text not null check (length(btrim(objective)) between 5 and 500),
  attempted_action text not null check (length(btrim(attempted_action)) between 5 and 1000),
  environment text not null check (length(btrim(environment)) between 2 and 120),
  reported_outcome text not null check (reported_outcome in ('success','failure','uncertain')),
  verification_status text not null default 'unverified'
    check (verification_status in ('unverified','verified','disputed')),
  observation text not null check (length(btrim(observation)) between 5 and 1500),
  workaround text check (workaround is null or length(btrim(workaround)) between 5 and 1000),
  source_platform text not null check (length(btrim(source_platform)) between 2 and 80),
  source_tool text check (source_tool is null or length(btrim(source_tool)) between 2 and 120),
  agent_id text check (agent_id is null or length(btrim(agent_id)) between 2 and 120),
  evidence_refs jsonb not null default '[]'::jsonb
    check (
      jsonb_typeof(evidence_refs) = 'array'
      and jsonb_array_length(evidence_refs) <= 8
      and pg_column_size(evidence_refs) <= 4500
    ),
  created_at timestamptz not null default now(),
  search_text tsvector generated always as
    (to_tsvector('english', objective || ' ' || attempted_action || ' ' || environment ||
       ' ' || observation || ' ' || coalesce(workaround, '') || ' ' || source_platform)) stored,
  constraint agency_experiences_one_request unique (user_id, idempotency_key)
);

create index agency_experiences_owner_recent_idx
  on public.agency_experiences(user_id, created_at desc, id desc);
create index agency_experiences_search_idx
  on public.agency_experiences using gin(search_text);

alter table public.agency_experiences enable row level security;
create policy "Owner reads agency experiences"
  on public.agency_experiences for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Owner records agency experiences"
  on public.agency_experiences for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and verification_status = 'unverified'
    and (
      select count(*) from jsonb_array_elements_text(evidence_refs) as e(value)
      where length(value) between 1 and 500
    ) = jsonb_array_length(evidence_refs)
  );

revoke all on public.agency_experiences from public, anon, authenticated;
grant select, insert on public.agency_experiences to authenticated;

-- No UPDATE/DELETE permissions: corrections and verification are future audited workflows.
-- Never treat agent-reported success as independent verification.
commit;
