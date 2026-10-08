-- PR16 follow-up. Additive graph viewer RPC for installations that have
-- already deployed the first three PR16 migrations. No embedding calls/writes.
-- The client receives no vectors or stale/revoked source content.
create or replace function public.get_assistant_memory_graph(
  p_user_id uuid, p_limit integer default 180
) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  uid uuid;
  payload jsonb;
begin
  uid := public.assistant_require_account(p_user_id);
  if p_limit < 20 or p_limit > 250 then
    raise exception 'INVALID_GRAPH_LIMIT' using errcode = '22023';
  end if;

  with allowed_sources as materialized (
    select s.id, s.source_kind, s.source_record_id, s.memory_id, s.search_text,
           s.state, s.created_at
    from public.assistant_memory_sources s
    where s.user_id = uid and s.state <> 'disabled'
      and public.assistant_memory_source_allowed(uid, s.source_kind, s.source_record_id)
  ),
  -- Existing memory source nodes are prioritized over other indexed content.
  source_nodes as (
    select n.id::text as id, s.source_kind as kind,
      case when s.source_kind = 'memory'
        then coalesce(nullif(m.memory_key, ''), n.label)
        else coalesce(nullif(left(s.search_text, 64), ''), n.label) end as label,
      left(case when s.source_kind = 'memory' then m.value else s.search_text end, 600) as snippet,
      case s.source_kind
        when 'memory' then 'assistant_memories'
        when 'note' then 'notes'
        when 'message' then 'assistant_messages'
        when 'dictation' then 'dictations'
        when 'asset' then 'assistant_memory_assets'
        when 'note_attachment' then 'note_attachments'
      end as table_name,
      s.source_record_id::text as record_id, s.id as source_id,
      s.state as status, s.created_at,
      n.id as real_id
    from public.memory_graph_nodes n
    join allowed_sources s on s.id = n.source_id
    left join public.assistant_memories m
      on s.source_kind = 'memory' and m.id = s.source_record_id
      and m.user_id = uid and m.status = 'active'
    where n.user_id = uid and n.node_kind = 'source'
    order by (s.source_kind = 'memory') desc, s.created_at desc, n.id
    limit p_limit
  ),
  -- Source relationships can exist before embedding. Show each new active
  -- memory as an isolated, visibly pending node until a graph node is made.
  not_yet_graphed as (
    select ('memory:' || m.id::text) as id, 'memory'::text as kind,
      m.memory_key as label, left(m.value, 600) as snippet,
      'assistant_memories'::text as table_name,
      m.id::text as record_id, s.id as source_id,
      coalesce(s.state, 'pending')::text as status, m.created_at,
      null::uuid as real_id
    from public.assistant_memories m
    left join allowed_sources s on s.source_kind = 'memory' and s.source_record_id = m.id
    where m.user_id = uid and m.status = 'active'
      and not exists (
        select 1 from source_nodes existing
        where existing.table_name = 'assistant_memories'
          and existing.record_id = m.id::text
      )
    order by m.created_at desc, m.id
    limit p_limit
  ),
  -- Only expose entity nodes directly connected to an authorized source
  -- already included in this snapshot. Never display orphaned/revoked entities.
  attached_entities as (
    select distinct on (entity.id)
      entity.id::text as id, entity.node_kind as kind,
      entity.label, null::text as snippet,
      'memory_graph_nodes'::text as table_name,
      entity.id::text as record_id, null::uuid as source_id,
      'linked'::text as status, entity.created_at,
      entity.id as real_id
    from public.memory_graph_nodes entity
    join public.memory_graph_edges edge on edge.user_id = uid
      and edge.valid_until is null
      and (edge.from_node_id = entity.id or edge.to_node_id = entity.id)
    join source_nodes n
      on n.real_id = case when edge.from_node_id = entity.id
        then edge.to_node_id else edge.from_node_id end
    where entity.user_id = uid and entity.node_kind <> 'source'
      and (edge.evidence_source_id is null or exists (
        select 1 from allowed_sources evidence where evidence.id = edge.evidence_source_id
      ))
    order by entity.id, entity.created_at desc
    limit 90
  ),
  visible_nodes as (
    select * from source_nodes
    union all select * from not_yet_graphed
    union all select * from attached_entities
  ),
  visible_edges as (
    select e.id::text as id,
      e.from_node_id::text as source,
      e.to_node_id::text as target,
      e.relation, e.confidence,
      e.created_at,
      e.evidence_source_id::text as evidence_id
    from public.memory_graph_edges e
    join visible_nodes a on a.real_id = e.from_node_id
    join visible_nodes b on b.real_id = e.to_node_id
    where e.user_id = uid and e.valid_until is null
      and (e.evidence_source_id is null or exists (
        select 1 from allowed_sources evidence where evidence.id = e.evidence_source_id
      ))
    order by e.created_at desc, e.id
    limit 600
  )
  select jsonb_build_object(
    'nodes', coalesce((select jsonb_agg(jsonb_build_object(
      'id', n.id, 'kind', n.kind, 'label', n.label, 'snippet', n.snippet,
      'tableName', n.table_name, 'recordId', n.record_id,
      'sourceId', n.source_id, 'status', n.status, 'createdAt', n.created_at
    ) order by n.created_at desc) from visible_nodes n), '[]'::jsonb),
    'edges', coalesce((select jsonb_agg(jsonb_build_object(
      'id', e.id, 'source', e.source, 'target', e.target,
      'relation', e.relation, 'confidence', e.confidence,
      'evidenceSourceId', e.evidence_id
    )) from visible_edges e), '[]'::jsonb),
    'activeMemoryCount', (select count(*) from public.assistant_memories m
      where m.user_id = uid and m.status = 'active'),
    'eligibleSourceCount', (select count(*) from allowed_sources),
    'sampleLimit', p_limit
  ) into payload;

  return payload;
end;
$$;

revoke all on function public.get_assistant_memory_graph(uuid, integer)
  from public, anon;
grant execute on function public.get_assistant_memory_graph(uuid, integer)
  to authenticated;
comment on function public.get_assistant_memory_graph(uuid, integer)
  is 'Read-only, account-owned graph visualization snapshot. Filters every source by current recall consent; no embedding data exposed.';
