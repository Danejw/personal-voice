-- Stable AI-assisted titles and conservative reusable note groups.

begin;

create table public.note_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120 and name = btrim(name)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index note_groups_user_name_ci_idx
  on public.note_groups (user_id, lower(name));

create index note_groups_user_updated_idx
  on public.note_groups (user_id, updated_at desc);

create trigger note_groups_touch_updated_at before update on public.note_groups
  for each row execute function public.touch_updated_at();

alter table public.note_groups enable row level security;

create policy "Users manage their own note groups" on public.note_groups
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on public.note_groups from anon;
grant select, insert, update, delete on public.note_groups to authenticated;

alter table public.notes
  add column title text
    check (title is null or (char_length(title) between 1 and 120 and title = btrim(title))),
  add column title_source text
    check (title_source is null or title_source in ('auto', 'manual')),
  add column group_id uuid references public.note_groups (id) on delete set null,
  add column group_source text
    check (group_source is null or group_source in ('auto', 'manual')),
  add column organized_at timestamptz;

alter table public.notes
  add constraint notes_title_source_pair check (
    (title is null and title_source is null)
    or (title is not null and title_source is not null)
  ),
  add constraint notes_group_source_pair check (
    (group_id is null and (group_source is null or group_source = 'manual'))
    or (group_id is not null and group_source is not null)
  );

create index notes_user_group_created_idx
  on public.notes (user_id, group_id, created_at desc);

comment on table public.note_groups is
  'Stable reusable visual sections for account notes. AI should prefer an existing group and only create a new one for a clear cluster of related notes.';

comment on column public.notes.title is
  'Concise scan title. Automatically generated only while null; manual edits are preserved.';
comment on column public.notes.organized_at is
  'Last time the organizer considered this note. Null means it still needs an organization pass.';

commit;
