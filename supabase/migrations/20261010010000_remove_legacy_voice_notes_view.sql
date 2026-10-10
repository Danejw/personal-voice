-- Remove the legacy voice_notes compatibility view after updating Assistant recall.
-- Original voice_notes table was renamed to notes in 20261006080000_notes.sql.
-- This migration never copies, modifies, or deletes saved notes.
-- Requires deployed clients to use public.notes, not the old compatibility view.

begin;

do $$
begin
  if to_regclass('public.notes') is null
    or (select relkind from pg_class where oid = 'public.notes'::regclass) <> 'r' then
    raise exception 'Expected public.notes to be a base table; aborting cleanup';
  end if;
  if to_regclass('public.voice_notes') is null
    or (select relkind from pg_class where oid = 'public.voice_notes'::regclass) <> 'v' then
    raise exception 'Expected public.voice_notes to be a legacy view; aborting cleanup';
  end if;
end;
$$;

-- Keep the signature, account authorization, RLS-sensitive filters, ranking,
-- result structure, grants, and security-definer search_path identical.
create or replace function public.search_assistant_recall(
  p_user_id uuid,
  p_query text,
  p_include_archived boolean
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid;
  query tsquery;
  notes_on boolean := false;
  dictations_on boolean := false;
  cloud_on boolean := false;
begin
  uid := public.assistant_require_account(p_user_id);
  if p_include_archived is null then
    p_include_archived := false;
  end if;
  query := public.assistant_recall_query(p_query);
  if query is null or pg_catalog.numnode(query) = 0 then
    return pg_catalog.jsonb_build_object('kind', 'needs-query', 'hits', '[]'::jsonb);
  end if;
  select
    s.assistant_recall_notes,
    s.assistant_recall_dictations,
    s.cloud_dictation_history
  into notes_on, dictations_on, cloud_on
  from public.settings s
  where s.user_id = uid;
  if not found then
    notes_on := false;
    dictations_on := false;
    cloud_on := false;
  end if;
  return pg_catalog.jsonb_build_object(
    'kind', 'hits',
    'hits', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'source', found.source,
        'id', found.id,
        'conversation_id', found.conversation_id,
        'at', found.saved_at,
        'snippet', found.snippet,
        'rank', found.rank
      ) order by found.rank desc, found.saved_at desc)
      from (
        select source, id, conversation_id, saved_at, snippet, rank
        from (
          select
            'note'::text as source,
            n.id,
            null::uuid as conversation_id,
            n.created_at as saved_at,
            pg_catalog.left(pg_catalog.ts_headline('english', n.text, query, 'MaxFragments=1, MaxWords=24, MinWords=4, StartSel=, StopSel='), 240) as snippet,
            pg_catalog.ts_rank(pg_catalog.to_tsvector('english', n.text), query) as rank
          from public.notes n
          where notes_on
            and n.user_id = uid
            and (p_include_archived or n.status = 'inbox')
            and pg_catalog.to_tsvector('english', n.text) @@ query
          union all
          select
            'dictation'::text,
            d.id,
            null::uuid,
            d.created_at,
            pg_catalog.left(pg_catalog.ts_headline('english', d.text, query, 'MaxFragments=1, MaxWords=24, MinWords=4, StartSel=, StopSel='), 240),
            pg_catalog.ts_rank(pg_catalog.to_tsvector('english', d.text), query)
          from public.dictations d
          where dictations_on
            and cloud_on
            and d.user_id = uid
            and d.outcome = 'success'
            and pg_catalog.to_tsvector('english', d.text) @@ query
          union all
          select
            'conversation'::text,
            m.id,
            m.conversation_id,
            m.created_at,
            pg_catalog.left(pg_catalog.ts_headline('english', m.body, query, 'MaxFragments=1, MaxWords=24, MinWords=4, StartSel=, StopSel='), 240),
            pg_catalog.ts_rank(pg_catalog.to_tsvector('english', m.body), query)
          from public.assistant_messages m
          join public.assistant_conversations c on c.id = m.conversation_id
          where m.user_id = uid
            and c.user_id = uid
            and c.deleted_at is null
            and m.role in ('user', 'assistant')
            and m.status = 'final'
            and pg_catalog.to_tsvector('english', m.body) @@ query
          union all
          select
            'memory'::text,
            mem.id,
            null::uuid,
            mem.updated_at,
            pg_catalog.left(pg_catalog.ts_headline('english', mem.value, query, 'MaxFragments=1, MaxWords=24, MinWords=4, StartSel=, StopSel='), 240),
            pg_catalog.ts_rank(pg_catalog.to_tsvector('english', mem.value), query)
          from public.assistant_memories mem
          where mem.user_id = uid
            and mem.status = 'active'
            and pg_catalog.to_tsvector('english', mem.value) @@ query
        ) matched
        order by rank desc, saved_at desc
        limit 5
      ) found
    ), '[]'::jsonb)
  );
end;
$$;

-- Rename inherited constraint/index labels; underlying table and data stay put.
alter table public.notes rename constraint voice_notes_pkey to notes_pkey;
alter table public.notes rename constraint voice_notes_status_check to notes_status_check;
alter table public.notes rename constraint voice_notes_text_check to notes_text_check;
alter table public.notes rename constraint voice_notes_user_id_fkey to notes_user_id_fkey;
alter index public.voice_notes_fts_idx rename to notes_fts_idx;

-- Intentionally omit CASCADE: any unexpected dependent object aborts the transaction.
drop view public.voice_notes;

-- Ensure the canonical table and retained index exist, and alias is gone.
do $$
begin
  if to_regclass('public.voice_notes') is not null
    or to_regclass('public.notes') is null
    or to_regclass('public.notes_fts_idx') is null then
    raise exception 'Legacy Notes cleanup verification failed';
  end if;
end;
$$;

commit;
