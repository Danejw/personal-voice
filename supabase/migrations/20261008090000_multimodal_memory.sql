-- PR16: additive semantic memory with 1536-dimension Gemini Embedding 2.
-- Apply only after review. This migration makes no external Gemini calls.
create schema if not exists extensions;
create extension if not exists vector with schema extensions;

alter table public.settings add column if not exists assistant_semantic_search boolean not null default false;

create table public.assistant_memory_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  memory_id uuid not null references public.assistant_memories(id) on delete cascade,
  bucket text not null default 'assistant-memory' check (bucket = 'assistant-memory'),
  storage_path text not null check (length(storage_path) between 38 and 1500),
  mime_type text not null check (mime_type in ('image/jpeg','image/png','audio/mpeg','audio/wav','audio/x-wav','video/mp4','video/quicktime','application/pdf')),
  size_bytes bigint not null check (size_bytes between 1 and 7340032),
  created_at timestamptz not null default now(),
  unique(user_id, storage_path),
  unique(id, user_id)
);
alter table public.assistant_memory_assets enable row level security;
create policy "Own active memory assets" on public.assistant_memory_assets
 for all to authenticated
 using (user_id = (select auth.uid()) and exists (
   select 1 from public.assistant_memories m where m.id = memory_id and m.user_id = (select auth.uid()) and m.status = 'active'))
 with check (user_id = (select auth.uid())
   and split_part(storage_path,'/',1) = (select auth.uid())::text
   and exists (select 1 from public.assistant_memories m where m.id = memory_id and m.user_id = (select auth.uid()) and m.status = 'active'));
revoke all on public.assistant_memory_assets from anon;
grant select, insert, delete on public.assistant_memory_assets to authenticated;

insert into storage.buckets (id,name,public,file_size_limit)
values ('assistant-memory','assistant-memory',false,7340032)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;
create policy "Read personal memory files" on storage.objects for select to authenticated
 using (bucket_id = 'assistant-memory' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Upload personal memory files" on storage.objects for insert to authenticated
 with check (bucket_id = 'assistant-memory' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Delete personal memory files" on storage.objects for delete to authenticated
 using (bucket_id = 'assistant-memory' and (storage.foldername(name))[1] = (select auth.uid())::text);

create table public.assistant_memory_sources (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 source_kind text not null check (source_kind in ('memory','note','message','dictation','asset')),
 source_record_id uuid not null,
 memory_id uuid references public.assistant_memories(id) on delete cascade,
 search_text text not null default '' check (length(search_text) <= 8000),
 fingerprint text not null check (fingerprint ~ '^[0-9a-f]{32}$'),
 state text not null default 'pending' check (state in ('pending','processing','ready','error','disabled')),
 attempts int not null default 0 check (attempts between 0 and 8),
 retry_after timestamptz,
 leased_until timestamptz,
 lease_token uuid,
 updated_at timestamptz not null default now(),
 created_at timestamptz not null default now(),
 unique(user_id,source_kind,source_record_id),
 unique(id,user_id)
);
create index assistant_memory_sources_claim_idx on public.assistant_memory_sources(user_id,state,retry_after,created_at);
create index assistant_memory_sources_fts_idx on public.assistant_memory_sources using gin (to_tsvector('english',search_text));
alter table public.assistant_memory_sources enable row level security;
create policy "Own memory source metadata" on public.assistant_memory_sources for select to authenticated
 using (user_id = (select auth.uid()));
revoke all on public.assistant_memory_sources from anon, authenticated;
grant select on public.assistant_memory_sources to authenticated;

create table public.assistant_memory_embeddings (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 source_id uuid not null,
 modality text not null check (modality in ('text','image','audio','video','pdf')),
 chunk_index int not null default 0 check (chunk_index >= 0),
 model text not null default 'gemini-embedding-2' check (model = 'gemini-embedding-2'),
 dimensions int not null default 1536 check (dimensions = 1536),
 fingerprint text not null check (fingerprint ~ '^[0-9a-f]{32}$'),
 embedding extensions.vector(1536) not null,
 created_at timestamptz not null default now(),
 unique(source_id,modality,chunk_index,model,dimensions),
 foreign key (source_id,user_id) references public.assistant_memory_sources(id,user_id) on delete cascade
);
create index assistant_memory_embeddings_hnsw on public.assistant_memory_embeddings
 using hnsw (embedding extensions.vector_cosine_ops);
create index assistant_memory_embeddings_user_idx on public.assistant_memory_embeddings(user_id,source_id);
alter table public.assistant_memory_embeddings enable row level security;
create policy "Own vector metadata" on public.assistant_memory_embeddings for select to authenticated
 using (user_id = (select auth.uid()));
revoke all on public.assistant_memory_embeddings from anon, authenticated;
grant select on public.assistant_memory_embeddings to authenticated;

create table public.memory_graph_nodes (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 node_kind text not null check (node_kind in ('source','person','project','organization','goal','concept','decision','event')),
 source_id uuid,
 canonical_key text,
 label text not null check (length(label) between 1 and 240),
 created_at timestamptz not null default now(),
 unique(id,user_id),
 foreign key(source_id,user_id) references public.assistant_memory_sources(id,user_id) on delete cascade,
 constraint graph_node_identity check (
   (node_kind='source' and source_id is not null and canonical_key is null)
   or (node_kind<>'source' and source_id is null and canonical_key is not null and length(canonical_key) between 2 and 120))
);
create unique index graph_source_unique on public.memory_graph_nodes(user_id,source_id) where source_id is not null;
create unique index graph_entity_unique on public.memory_graph_nodes(user_id,node_kind,canonical_key) where canonical_key is not null;
alter table public.memory_graph_nodes enable row level security;
create policy "Own graph nodes" on public.memory_graph_nodes for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.memory_graph_nodes from anon, authenticated;
grant select on public.memory_graph_nodes to authenticated;

create table public.memory_graph_edges (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 from_node_id uuid not null,
 to_node_id uuid not null,
 relation text not null check (relation in ('related_to','derived_from','supports','contradicts','supersedes','belongs_to','works_on','has_goal','decided','mentioned_in','attached_to')),
 evidence_source_id uuid,
 confidence real not null default 1 check(confidence >= 0 and confidence <= 1),
 valid_from timestamptz not null default now(),
 valid_until timestamptz,
 created_at timestamptz not null default now(),
 unique(user_id,from_node_id,to_node_id,relation),
 foreign key(from_node_id,user_id) references public.memory_graph_nodes(id,user_id) on delete cascade,
 foreign key(to_node_id,user_id) references public.memory_graph_nodes(id,user_id) on delete cascade,
 foreign key(evidence_source_id,user_id) references public.assistant_memory_sources(id,user_id) on delete cascade,
 check(from_node_id<>to_node_id),
 check(valid_until is null or valid_until >= valid_from)
);
create index graph_edges_forward on public.memory_graph_edges(user_id,from_node_id);
create index graph_edges_reverse on public.memory_graph_edges(user_id,to_node_id);
alter table public.memory_graph_edges enable row level security;
create policy "Own graph edges" on public.memory_graph_edges for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.memory_graph_edges from anon, authenticated;
grant select on public.memory_graph_edges to authenticated;

-- Every returned source must still be eligible, even if a background job races a deletion.
create function public.assistant_memory_source_allowed(p_uid uuid,p_kind text,p_record uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select case p_kind
 when 'memory' then exists (select 1 from public.assistant_memories m where m.id=p_record and m.user_id=p_uid and m.status='active')
 when 'asset' then exists (
  select 1 from public.assistant_memory_assets a join public.assistant_memories m on m.id=a.memory_id
  where a.id=p_record and a.user_id=p_uid and m.user_id=p_uid and m.status='active')
 when 'note' then exists (
  select 1 from public.notes n join public.settings s on s.user_id=n.user_id
  where n.id=p_record and n.user_id=p_uid and s.assistant_semantic_search and s.assistant_recall_notes)
 when 'message' then exists (
  select 1 from public.assistant_messages m join public.assistant_conversations c on c.id=m.conversation_id
  join public.settings s on s.user_id=m.user_id
  where m.id=p_record and m.user_id=p_uid and c.user_id=p_uid and c.deleted_at is null
  and m.status='final' and m.role='user' and s.assistant_semantic_search)
 when 'dictation' then exists (
  select 1 from public.dictations d join public.settings s on s.user_id=d.user_id
  where d.id=p_record and d.user_id=p_uid and d.outcome='success'
  and s.assistant_semantic_search and s.cloud_dictation_history and s.assistant_recall_dictations)
 else false end;
$$;
revoke all on function public.assistant_memory_source_allowed(uuid,text,uuid) from public,anon,authenticated;

-- Called only by trusted memory triggers, not a public registration endpoint.
create function public.assistant_memory_upsert_source(p_uid uuid,p_kind text,p_id uuid,p_memory uuid,p_text text,p_fingerprint text)
returns void language plpgsql security definer set search_path='' as $$
begin
 insert into public.assistant_memory_sources(user_id,source_kind,source_record_id,memory_id,search_text,fingerprint)
 values(p_uid,p_kind,p_id,p_memory,left(coalesce(p_text,''),8000),p_fingerprint)
 on conflict (user_id,source_kind,source_record_id)
 do update set search_text=excluded.search_text,memory_id=excluded.memory_id,
 fingerprint=excluded.fingerprint,state='pending',attempts=0,retry_after=null,leased_until=null,lease_token=null,updated_at=now()
 where public.assistant_memory_sources.fingerprint is distinct from excluded.fingerprint
    or public.assistant_memory_sources.state='disabled';
end;
$$;
revoke all on function public.assistant_memory_upsert_source(uuid,text,uuid,uuid,text,text) from public,anon,authenticated;

create function public.assistant_memory_sync_row() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.status='active' then
   perform public.assistant_memory_upsert_source(new.user_id,'memory',new.id,new.id,new.value,
     md5(new.value || ':' || new.revision::text));
 else
   delete from public.assistant_memory_sources where user_id=new.user_id and source_kind='memory' and source_record_id=new.id;
 end if;
 return new;
end;
$$;
create trigger assistant_memory_index_sync after insert or update of status,value,revision on public.assistant_memories
 for each row execute function public.assistant_memory_sync_row();
-- No paid backfill is executed by this migration.

create function public.assistant_memory_asset_sync() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='DELETE' then
  delete from public.assistant_memory_sources where user_id=old.user_id and source_kind='asset' and source_record_id=old.id;
  return old;
 end if;
 perform public.assistant_memory_upsert_source(new.user_id,'asset',new.id,new.memory_id,'',
   md5(new.storage_path || ':' || new.size_bytes::text || ':' || new.mime_type));
 return new;
end;
$$;
create trigger assistant_memory_asset_index after insert or delete on public.assistant_memory_assets
 for each row execute function public.assistant_memory_asset_sync();

-- The user can opt into other saved content; no implicit source indexing.
create function public.assistant_memory_queue_sources(p_user_id uuid,p_limit int default 80)
returns int language plpgsql security definer set search_path='' as $$
declare uid uuid; row record; n int:=0;
begin
 uid:=public.assistant_require_account(p_user_id);
 if p_limit<1 or p_limit>100 then raise exception 'INVALID_LIMIT'; end if;
 for row in
  select kind,id,memory_id,body,fingerprint from (
   select 'memory'::text kind,m.id,m.id memory_id,m.value body,md5(m.value||':'||m.revision::text) fingerprint,m.updated_at ts
    from public.assistant_memories m where m.user_id=uid and m.status='active'
   union all
   select 'note', n.id,null::uuid,left(n.text,8000),md5(n.text||':'||n.updated_at::text),n.updated_at
    from public.notes n join public.settings s on s.user_id=n.user_id
    where n.user_id=uid and s.assistant_semantic_search and s.assistant_recall_notes
   union all
   select 'message',m.id,null::uuid,left(m.body,8000),md5(m.body),m.created_at
    from public.assistant_messages m join public.assistant_conversations c on c.id=m.conversation_id
    join public.settings s on s.user_id=m.user_id
    where m.user_id=uid and m.role='user' and m.status='final' and c.deleted_at is null and s.assistant_semantic_search
   union all
   select 'dictation',d.id,null::uuid,left(d.text,8000),md5(d.text),d.created_at
    from public.dictations d join public.settings s on s.user_id=d.user_id
    where d.user_id=uid and d.outcome='success' and s.assistant_semantic_search and s.cloud_dictation_history and s.assistant_recall_dictations
  ) eligible
  left join public.assistant_memory_sources old on old.user_id=uid and old.source_kind=eligible.kind and old.source_record_id=eligible.id
  where old.id is null or old.fingerprint is distinct from eligible.fingerprint or old.state='disabled'
  order by eligible.ts desc limit p_limit
 loop
  perform public.assistant_memory_upsert_source(uid,row.kind,row.id,row.memory_id,row.body,row.fingerprint);
  n:=n+1;
 end loop;
 -- Old source rows are not searchable if their permissions were later revoked (source_allowed).
 return n;
end;
$$;

create function public.assistant_memory_claim_batch(p_user_id uuid,p_limit int default 4)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid; result jsonb;
begin
 uid:=public.assistant_require_account(p_user_id);
 if p_limit<1 or p_limit>8 then raise exception 'INVALID_LIMIT'; end if;
 with eligible as (
  select s.id from public.assistant_memory_sources s
  where s.user_id=uid and s.attempts<8
   and (s.state in ('pending','error') or (s.state='processing' and s.leased_until<now()))
   and (s.retry_after is null or s.retry_after<=now())
   and public.assistant_memory_source_allowed(uid,s.source_kind,s.source_record_id)
  order by s.created_at limit p_limit for update skip locked
 ), claimed as (
  update public.assistant_memory_sources s set state='processing',attempts=s.attempts+1,
   leased_until=now()+interval '2 minutes',lease_token=gen_random_uuid(),updated_at=now()
   from eligible e where s.id=e.id
   returning s.*
 )
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'kind',c.source_kind,
  'recordId',c.source_record_id,'text',c.search_text,'fingerprint',c.fingerprint,'leaseToken',c.lease_token,
  'assetPath',a.storage_path,'mimeType',a.mime_type)), '[]'::jsonb)
 into result from claimed c left join public.assistant_memory_assets a
   on c.source_kind='asset' and a.id=c.source_record_id and a.user_id=uid;
 return result;
end;
$$;

create function public.assistant_memory_complete_embedding(p_user_id uuid,p_source_id uuid,p_fingerprint text,
 p_modality text,p_values text,p_lease_token uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare uid uuid; src public.assistant_memory_sources%rowtype; vec extensions.vector(1536);
begin
 uid:=public.assistant_require_account(p_user_id);
 if p_modality not in ('text','image','audio','video','pdf') then raise exception 'INVALID_MODALITY'; end if;
 select * into src from public.assistant_memory_sources
  where id=p_source_id and user_id=uid for update;
 if not found or src.state<>'processing' or src.leased_until<now()
    or src.fingerprint<>p_fingerprint or src.lease_token is distinct from p_lease_token
    or not public.assistant_memory_source_allowed(uid,src.source_kind,src.source_record_id)
 then return false; end if;
 vec:=p_values::extensions.vector(1536);
 insert into public.assistant_memory_embeddings(user_id,source_id,modality,fingerprint,embedding)
 values(uid,src.id,p_modality,p_fingerprint,vec)
 on conflict(source_id,modality,chunk_index,model,dimensions)
 do update set embedding=excluded.embedding,fingerprint=excluded.fingerprint,created_at=now();
 update public.assistant_memory_sources set state='ready',leased_until=null,lease_token=null,retry_after=null,updated_at=now() where id=src.id;
 insert into public.memory_graph_nodes(user_id,node_kind,source_id,label)
 values(uid,'source',src.id,left(coalesce(nullif(src.search_text,''),src.source_kind||' asset'),240))
 on conflict(user_id,source_id) where source_id is not null do update set label=excluded.label;
 return true;
end;
$$;

create function public.assistant_memory_fail_embedding(p_user_id uuid,p_source_id uuid,p_fingerprint text,p_lease_token uuid)
returns void language plpgsql security definer set search_path='' as $$
declare uid uuid;
begin
 uid:=public.assistant_require_account(p_user_id);
 update public.assistant_memory_sources set state='error',leased_until=null,lease_token=null,
  retry_after=now()+make_interval(secs=>least(3600, 15*power(2,least(attempts,7)))::int),updated_at=now()
 where user_id=uid and id=p_source_id and fingerprint=p_fingerprint and lease_token=p_lease_token and state='processing';
end;
$$;

create function public.assistant_memory_link_nodes(p_user_id uuid,p_from uuid,p_to uuid,p_relation text,p_evidence uuid default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare uid uuid;
begin
 uid:=public.assistant_require_account(p_user_id);
 if p_relation not in ('related_to','derived_from','supports','contradicts','supersedes','belongs_to',
   'works_on','has_goal','decided','mentioned_in','attached_to') or p_from=p_to then return false; end if;
 if not exists (select 1 from public.memory_graph_nodes n join public.assistant_memory_sources s on s.id=n.source_id
     where n.id=p_from and n.user_id=uid and public.assistant_memory_source_allowed(uid,s.source_kind,s.source_record_id))
  or not exists (select 1 from public.memory_graph_nodes n join public.assistant_memory_sources s on s.id=n.source_id
     where n.id=p_to and n.user_id=uid and public.assistant_memory_source_allowed(uid,s.source_kind,s.source_record_id))
 then return false; end if;
 if p_evidence is not null and not exists(select 1 from public.assistant_memory_sources s
     where s.id=p_evidence and s.user_id=uid and public.assistant_memory_source_allowed(uid,s.source_kind,s.source_record_id))
 then return false; end if;
 insert into public.memory_graph_edges(user_id,from_node_id,to_node_id,relation,evidence_source_id)
 values(uid,p_from,p_to,p_relation,p_evidence)
 on conflict(user_id,from_node_id,to_node_id,relation) do update set evidence_source_id=excluded.evidence_source_id, valid_until=null;
 return true;
end;
$$;

-- Hybrid search: vector/keyword candidates with explicit source checks on each hit.
create function public.search_assistant_memory_hybrid(p_user_id uuid,p_query text,p_query_vector text default null,p_limit int default 6)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare uid uuid; qvec extensions.vector(1536); hits jsonb; cleaned text;
begin
 uid:=public.assistant_require_account(p_user_id);
 if p_limit<1 or p_limit>12 or length(p_query)>300 or length(trim(p_query))<2 then return '[]'::jsonb; end if;
 if p_query_vector is not null then qvec:=p_query_vector::extensions.vector(1536); end if;
 cleaned:=trim(p_query);
 with ranked as (
  select s.id, s.source_kind,s.source_record_id,s.memory_id,s.search_text,s.created_at,
  case when qvec is not null and e.embedding is not null then 1-(e.embedding <=> qvec) else 0 end semantic,
  ts_rank_cd(to_tsvector('english',s.search_text),plainto_tsquery('english',cleaned)) keyword
  from public.assistant_memory_sources s
  left join public.assistant_memory_embeddings e on e.source_id=s.id and e.user_id=uid and e.fingerprint=s.fingerprint
  where s.user_id=uid and s.state='ready'
   and public.assistant_memory_source_allowed(uid,s.source_kind,s.source_record_id)
 ), scored as (
  select distinct on(id) *, (semantic*0.75+least(keyword,1)*0.25) score
  from ranked where semantic>0.20 or keyword>0
  order by id,(semantic*0.75+least(keyword,1)*0.25) desc
 ), winners as (
  select * from scored order by score desc,created_at desc limit p_limit
 )
 select coalesce(jsonb_agg(jsonb_build_object('sourceId',w.id,'sourceType',w.source_kind,
   'recordId',w.source_record_id,'memoryId',w.memory_id,'snippet',left(w.search_text,500),
   'score',w.score,'createdAt',w.created_at,
   'relations',coalesce((
    select jsonb_agg(jsonb_build_object('relation',edge.relation,'relatedSourceId',other.source_id))
    from public.memory_graph_nodes n join public.memory_graph_edges edge
      on edge.user_id=uid and edge.valid_until is null and (edge.from_node_id=n.id or edge.to_node_id=n.id)
    join public.memory_graph_nodes other on other.id=case when edge.from_node_id=n.id then edge.to_node_id else edge.from_node_id end
    join public.assistant_memory_sources other_s on other_s.id=other.source_id and other_s.user_id=uid
    where n.source_id=w.id and n.user_id=uid
     and public.assistant_memory_source_allowed(uid,other_s.source_kind,other_s.source_record_id)
   ),'[]'::jsonb))), '[]'::jsonb) into hits from winners w;
 return hits;
end;
$$;

revoke all on function public.assistant_memory_queue_sources(uuid,int),
 public.assistant_memory_claim_batch(uuid,int),
 public.assistant_memory_complete_embedding(uuid,uuid,text,text,text,uuid),
 public.assistant_memory_fail_embedding(uuid,uuid,text,uuid),
 public.assistant_memory_link_nodes(uuid,uuid,uuid,text,uuid),
 public.search_assistant_memory_hybrid(uuid,text,text,int)
 from public,anon;
grant execute on function public.assistant_memory_queue_sources(uuid,int),
 public.assistant_memory_claim_batch(uuid,int),
 public.assistant_memory_complete_embedding(uuid,uuid,text,text,text,uuid),
 public.assistant_memory_fail_embedding(uuid,uuid,text,uuid),
 public.assistant_memory_link_nodes(uuid,uuid,uuid,text,uuid),
 public.search_assistant_memory_hybrid(uuid,text,text,int)
 to authenticated;
