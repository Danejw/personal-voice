-- Look up saved lines for "what did I say?".
--
-- Voice notes and synced dictations stay off until this account turns each
-- source on. Turning on dictation search does not turn on dictation sync and
-- does not upload older device history. Conversations and active memories are
-- already Assistant data. Forgotten memories are not returned. The original
-- note, dictation, or conversation can still match.
--
-- English full-text search is enough for names, plurals, and dated excerpts.
-- A close pair is returned together so the answer can ask which one. Nothing
-- here inserts a memory.

alter table public.settings
  add column assistant_recall_notes boolean not null default false,
  add column assistant_recall_dictations boolean not null default false;

create index voice_notes_fts_idx
  on public.voice_notes using gin (to_tsvector('english', text));

create index dictations_fts_idx
  on public.dictations using gin (to_tsvector('english', text));

create index assistant_messages_fts_idx
  on public.assistant_messages using gin (to_tsvector('english', body));

create index assistant_memories_fts_idx
  on public.assistant_memories using gin (to_tsvector('english', value));

create function public.assistant_recall_query(p_query text) returns tsquery
language plpgsql
immutable
set search_path = ''
as $$
declare
  cleaned text;
begin
  if p_query is null or pg_catalog.char_length(pg_catalog.btrim(p_query)) > 200 then
    return null;
  end if;
  cleaned := pg_catalog.lower(pg_catalog.btrim(p_query));
  cleaned := pg_catalog.regexp_replace(cleaned, '[^a-z0-9 ]', ' ', 'g');
  cleaned := pg_catalog.regexp_replace(
    cleaned,
    '\m(a|an|the|about|and|or|did|do|i|me|my|you|what|that|this|it|say|said|remember|recall|was|were|to|of|for|in|on|please|find|look|up|have|has|had|we)\M',
    ' ',
    'g'
  );
  cleaned := pg_catalog.btrim(pg_catalog.regexp_replace(cleaned, '\s+', ' ', 'g'));
  if cleaned = '' then
    return null;
  end if;
  return pg_catalog.plainto_tsquery('english', cleaned);
end;
$$;

create function public.search_assistant_recall(
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
          from public.voice_notes n
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

revoke all on function public.assistant_recall_query(text) from public, anon, authenticated;
revoke all on function public.search_assistant_recall(uuid, text, boolean) from public, anon;
grant execute on function public.search_assistant_recall(uuid, text, boolean) to authenticated;
