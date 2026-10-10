-- Extend Phase C Assistant Insights with a durable, user-owned communication-style profile.
-- This is additive: preserve earlier analysis runs, suggestions and saved playbook drafts.
begin;

alter table public.assistant_insight_runs
  add column voice_profile text
    check (voice_profile is null or length(voice_profile) between 40 and 6000),
  add column communication_tips jsonb not null default '[]'::jsonb
    check (jsonb_typeof(communication_tips) = 'array' and jsonb_array_length(communication_tips) <= 4);

comment on column public.assistant_insight_runs.voice_profile is
  'A bounded narrative description of observed communication style, generated on explicit Assistant Insights analysis; not a personality diagnosis.';

comment on column public.assistant_insight_runs.communication_tips is
  'Optional short, source-grounded guidance for effective Assistant communication; never automatically changes settings.';

commit;
