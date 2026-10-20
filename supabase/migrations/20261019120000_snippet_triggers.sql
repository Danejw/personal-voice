-- Multiple voice triggers per snippet. The original trigger column remains the
-- comma-separated display text so existing readers keep working.

begin;

create or replace function public.snippet_compact(raw text)
returns text
language sql
immutable
set search_path = public
as $$
  select regexp_replace(
    lower(
      btrim(
        regexp_replace(
          regexp_replace(btrim(coalesce(raw, '')), '[[:space:]]+', ' ', 'g'),
          '[.?!,;:]+$',
          '',
          'g'
        )
      )
    ),
    '[-[:space:]]',
    '',
    'g'
  );
$$;

create or replace function public.snippet_slug(raw text)
returns text
language sql
immutable
set search_path = public
as $$
  select regexp_replace(public.snippet_compact(raw), '[^a-z0-9]', '', 'g');
$$;

-- Same folding the editor uses to drop exact repeats. Hyphen and joined forms stay.
create or replace function public.snippet_normalize_phrase(raw text)
returns text
language sql
immutable
set search_path = public
as $$
  select lower(
    btrim(
      regexp_replace(
        regexp_replace(btrim(coalesce(raw, '')), '[[:space:]]+', ' ', 'g'),
        '[.?!,;:]+$',
        '',
        'g'
      )
    )
  );
$$;

create or replace function public.snippet_triggers_valid(phrases text[])
returns boolean
language sql
immutable
set search_path = public
as $$
  select phrases is not null
    and cardinality(phrases) between 1 and 12
    and not exists (
      select 1
      from unnest(phrases) as phrase
      where phrase is null
        or char_length(phrase) < 1
        or char_length(phrase) > 120
        or phrase <> btrim(phrase)
        or public.snippet_compact(phrase) = ''
    );
$$;

create or replace function public.snippets_enforce_trigger_keys()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  phrase text;
  compact text;
  slug text;
begin
  if not public.snippet_triggers_valid(new.triggers) then
    raise exception 'That snippet contains an invalid or oversized value.' using errcode = '23514';
  end if;

  if exists (
    select 1
    from unnest(new.triggers) as phrase
    group by public.snippet_normalize_phrase(phrase)
    having count(*) > 1
  ) then
    raise exception 'Those voice triggers are duplicates.' using errcode = '23505';
  end if;

  foreach phrase in array new.triggers loop
    compact := public.snippet_compact(phrase);
    if exists (
      select 1
      from public.snippets other
      cross join lateral unnest(other.triggers) as other_phrase
      where other.user_id = new.user_id
        and other.id is distinct from new.id
        and public.snippet_compact(other_phrase) = compact
    ) then
      raise exception 'A snippet with that voice trigger already exists.' using errcode = '23505';
    end if;
  end loop;

  slug := public.snippet_slug(new.triggers[1]);
  if slug <> '' and exists (
    select 1
    from public.snippets other
    where other.user_id = new.user_id
      and other.id is distinct from new.id
      and public.snippet_slug(other.triggers[1]) = slug
  ) then
    raise exception 'A snippet with that voice trigger already exists.' using errcode = '23505';
  end if;

  return new;
end;
$$;

alter table public.snippets
  add column triggers text[];

alter table public.snippets disable trigger snippets_touch_updated_at;

update public.snippets
set triggers = array[trigger]
where triggers is null;

alter table public.snippets enable trigger snippets_touch_updated_at;

alter table public.snippets
  alter column triggers set not null;

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'snippets'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%char_length(trigger)%'
  loop
    execute format('alter table public.snippets drop constraint %I', constraint_name);
  end loop;
end $$;

alter table public.snippets
  add constraint snippets_trigger_check
  check (char_length(trigger) between 1 and 1600 and trigger = btrim(trigger));

alter table public.snippets
  add constraint snippets_triggers_check
  check (public.snippet_triggers_valid(triggers));

create trigger snippets_enforce_trigger_keys
  before insert or update of triggers, user_id on public.snippets
  for each row execute function public.snippets_enforce_trigger_keys();

revoke all on function public.snippet_compact(text) from public, anon;
revoke all on function public.snippet_slug(text) from public, anon;
revoke all on function public.snippet_normalize_phrase(text) from public, anon;
revoke all on function public.snippet_triggers_valid(text[]) from public, anon;
revoke all on function public.snippets_enforce_trigger_keys() from public, anon;

grant execute on function public.snippet_compact(text) to authenticated;
grant execute on function public.snippet_slug(text) to authenticated;
grant execute on function public.snippet_normalize_phrase(text) to authenticated;
grant execute on function public.snippet_triggers_valid(text[]) to authenticated;
grant execute on function public.snippets_enforce_trigger_keys() to authenticated;

comment on column public.snippets.triggers is
  'Spoken phrases for this snippet, in editor order. Equivalent phrases resolve to the same snippet.';

comment on table public.snippets is
  'User-saved voice triggers that expand to deterministic text. One snippet may have several triggers.';

commit;
