-- Account-synced deterministic voice-to-text expansions.

begin;

create table public.snippets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  trigger text not null check (char_length(trigger) between 1 and 120 and trigger = btrim(trigger)),
  normalized_trigger text generated always as (
    lower(
      btrim(
        regexp_replace(
          regexp_replace(btrim(trigger), '\\s+', ' ', 'g'),
          '[.?!,;:]+$',
          '',
          'g'
        )
      )
    )
  ) stored,
  content text not null check (char_length(content) between 1 and 20000 and content = btrim(content)),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(normalized_trigger) > 0)
);

create unique index snippets_user_trigger_idx
  on public.snippets (user_id, normalized_trigger);

create index snippets_user_updated_idx
  on public.snippets (user_id, updated_at desc);

create trigger snippets_touch_updated_at
  before update on public.snippets
  for each row execute function public.touch_updated_at();

alter table public.snippets enable row level security;

create policy "Users manage their own snippets" on public.snippets
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on public.snippets from anon;
grant select, insert, update, delete on public.snippets to authenticated;

comment on table public.snippets is
  'User-saved exact whole-utterance voice triggers that expand to deterministic text.';

commit;
