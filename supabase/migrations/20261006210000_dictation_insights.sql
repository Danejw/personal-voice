-- Dictation-only Personal Insights. Raw dictations are compacted only after a durable run exists.

begin;

create table public.insight_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  source_from_created_at timestamptz not null,
  source_through_created_at timestamptz not null,
  dictation_count integer not null check (dictation_count > 0),
  word_count integer not null check (word_count >= 0),
  active_days integer not null check (active_days > 0),
  voice_profile text not null check (char_length(voice_profile) between 1 and 8000 and voice_profile = btrim(voice_profile)),
  catchphrases jsonb not null default '[]'::jsonb,
  usage_facts jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  compacted_at timestamptz,
  compacted_count integer not null default 0 check (compacted_count >= 0),
  check (source_from_created_at <= source_through_created_at)
);

create index insight_runs_user_created_idx
  on public.insight_runs (user_id, created_at desc);

create table public.insight_candidates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  run_id uuid not null references public.insight_runs (id) on delete cascade,
  kind text not null check (kind in ('dictionary', 'snippet', 'transform', 'memory')),
  fingerprint text not null check (char_length(fingerprint) between 1 and 240),
  title text not null check (char_length(title) between 1 and 160 and title = btrim(title)),
  payload jsonb not null,
  evidence_count integer not null check (evidence_count >= 1),
  confidence text not null check (confidence in ('high', 'medium')),
  reason text not null check (char_length(reason) between 1 and 1000 and reason = btrim(reason)),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'dismissed', 'duplicate')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, fingerprint)
);

create index insight_candidates_user_status_idx
  on public.insight_candidates (user_id, status, created_at desc);

create trigger insight_candidates_touch_updated_at
  before update on public.insight_candidates
  for each row execute function public.touch_updated_at();

alter table public.insight_runs enable row level security;
alter table public.insight_candidates enable row level security;

create policy "Users manage their own insight runs" on public.insight_runs
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "Users manage their own insight candidates" on public.insight_candidates
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on public.insight_runs, public.insight_candidates from anon;
grant select, insert, update, delete on public.insight_runs, public.insight_candidates to authenticated;

create function public.compact_insight_run(
  p_user_id uuid,
  p_run_id uuid,
  p_keep_newest integer default 50
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  run_row public.insight_runs;
  removed integer := 0;
begin
  if uid is null or p_user_id is distinct from uid then
    raise exception 'INSIGHTS_ACCOUNT_MISMATCH' using errcode = '42501';
  end if;
  if p_keep_newest < 25 or p_keep_newest > 100 then
    raise exception 'INSIGHTS_KEEP_INVALID' using errcode = '23514';
  end if;

  select * into run_row
  from public.insight_runs
  where id = p_run_id and user_id = uid
  for update;

  if not found then
    raise exception 'INSIGHTS_RUN_NOT_FOUND' using errcode = 'P0001';
  end if;

  delete from public.dictations d
  where d.user_id = uid
    and d.created_at <= run_row.source_through_created_at
    and d.id not in (
      select keep.id
      from public.dictations keep
      where keep.user_id = uid
      order by keep.created_at desc, keep.id desc
      limit p_keep_newest
    );

  get diagnostics removed = row_count;

  update public.insight_runs
  set compacted_at = coalesce(compacted_at, now()),
      compacted_count = compacted_count + removed
  where id = run_row.id;

  return removed;
end;
$$;

revoke all on function public.compact_insight_run(uuid, uuid, integer) from public, anon;
grant execute on function public.compact_insight_run(uuid, uuid, integer) to authenticated;

commit;
