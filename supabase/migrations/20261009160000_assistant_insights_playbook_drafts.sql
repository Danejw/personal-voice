-- Phase C: separately reviewable Assistant usage Insights.
-- No raw conversation text, prompts, assistant outputs, or model traces retained.
-- Personal playbook drafts have NO executor or link into the system tool playbooks.
begin;

create table public.assistant_insight_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  user_message_count integer not null check (user_message_count between 1 and 100),
  conversation_count integer not null check (conversation_count between 1 and 12),
  created_at timestamptz not null default now()
);
create index assistant_insight_runs_user_created_idx on public.assistant_insight_runs(user_id,created_at desc);
alter table public.assistant_insight_runs enable row level security;
create policy "Users manage their own Assistant Insight runs" on public.assistant_insight_runs
  for all to authenticated using (user_id=(select auth.uid()))
  with check (user_id=(select auth.uid()));

create table public.assistant_insight_candidates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  fingerprint text not null check (length(fingerprint) between 4 and 120),
  kind text not null check (kind in ('workflow','adaptation','goal')),
  title text not null check (length(title) between 3 and 120),
  reason text not null check (length(reason) between 10 and 800),
  next_step text not null check (length(next_step) between 5 and 800),
  proposed_steps jsonb not null default '[]'::jsonb
    check (jsonb_typeof(proposed_steps)='array' and jsonb_array_length(proposed_steps)<=8),
  evidence_message_ids uuid[] not null
    check (cardinality(evidence_message_ids) between 2 and 6),
  status text not null default 'pending'
    check (status in ('pending','saved','dismissed','muted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,fingerprint),
  unique(id,user_id)
);
create index assistant_insight_candidates_user_status_idx
  on public.assistant_insight_candidates(user_id,status,created_at desc);
alter table public.assistant_insight_candidates enable row level security;
create policy "Users manage their own Assistant Insight candidates" on public.assistant_insight_candidates
  for all to authenticated using (user_id=(select auth.uid()))
  with check (user_id=(select auth.uid()));

-- Explicitly saved drafts are *data*, never executable commands.
create table public.assistant_personal_playbook_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  source_candidate_id uuid not null,
  title text not null check (length(title) between 3 and 120),
  steps jsonb not null check (jsonb_typeof(steps)='array' and jsonb_array_length(steps) between 1 and 8),
  status text not null default 'draft' check (status='draft'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,source_candidate_id),
  foreign key(source_candidate_id,user_id) references public.assistant_insight_candidates(id,user_id) on delete cascade
);
create index assistant_personal_playbook_drafts_user_idx
  on public.assistant_personal_playbook_drafts(user_id,created_at desc);
alter table public.assistant_personal_playbook_drafts enable row level security;
create policy "Users manage their own Personal Playbook drafts" on public.assistant_personal_playbook_drafts
  for all to authenticated using (user_id=(select auth.uid()))
  with check (user_id=(select auth.uid()));

revoke all on public.assistant_insight_runs,public.assistant_insight_candidates,
  public.assistant_personal_playbook_drafts from anon;
grant select,insert,update,delete on public.assistant_insight_runs,
  public.assistant_insight_candidates,public.assistant_personal_playbook_drafts to authenticated;
commit;
