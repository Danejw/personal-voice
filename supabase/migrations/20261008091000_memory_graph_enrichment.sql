-- PR16 graph enrichment: evidence-backed entities and conservative similarity edges.
-- Source nodes remain the only system-generated graph members until indexing succeeds.

create function public.assistant_memory_auto_links()
returns trigger language plpgsql security definer set search_path='' as $$
declare src public.assistant_memory_sources%rowtype; other record; origin public.assistant_memory_sources%rowtype;
begin
 if new.node_kind<>'source' then return new; end if;
 select * into src from public.assistant_memory_sources where id=new.source_id and user_id=new.user_id;
 if not found or not public.assistant_memory_source_allowed(new.user_id,src.source_kind,src.source_record_id) then return new; end if;

 -- Evidence-based links to the saved Assistant message, if that source has been indexed with consent.
 if src.source_kind='memory' then
  select s.* into origin from public.assistant_memories m
    join public.assistant_memory_sources s on s.source_kind='message' and s.source_record_id=m.source_message_id
     and s.user_id=m.user_id
   where m.id=src.source_record_id and m.user_id=new.user_id;
  if found then
   insert into public.memory_graph_edges(user_id,from_node_id,to_node_id,relation,evidence_source_id)
   select new.user_id,new.id,n.id,'derived_from',origin.id
    from public.memory_graph_nodes n where n.user_id=new.user_id and n.source_id=origin.id
      and public.assistant_memory_source_allowed(new.user_id,origin.source_kind,origin.source_record_id)
   on conflict(user_id,from_node_id,to_node_id,relation) do nothing;
  end if;
 end if;
 -- An attachment belongs to its parent memory, not a second duplicate memory.
 if src.source_kind='asset' then
   insert into public.memory_graph_edges(user_id,from_node_id,to_node_id,relation,evidence_source_id)
   select new.user_id,new.id,memnode.id,'attached_to',src.id
   from public.assistant_memory_sources memsrc
   join public.memory_graph_nodes memnode on memnode.source_id=memsrc.id and memnode.user_id=new.user_id
   where memsrc.source_kind='memory' and memsrc.source_record_id=src.memory_id
     and memsrc.user_id=new.user_id
   on conflict(user_id,from_node_id,to_node_id,relation) do nothing;
 elsif src.source_kind='memory' then
   insert into public.memory_graph_edges(user_id,from_node_id,to_node_id,relation,evidence_source_id)
   select new.user_id,assetnode.id,new.id,'attached_to',a.id
   from public.assistant_memory_sources a
   join public.memory_graph_nodes assetnode on assetnode.source_id=a.id and assetnode.user_id=new.user_id
   where a.source_kind='asset' and a.memory_id=src.memory_id and a.user_id=new.user_id
     and public.assistant_memory_source_allowed(new.user_id,a.source_kind,a.source_record_id)
   on conflict(user_id,from_node_id,to_node_id,relation) do nothing;
 end if;

 -- Near neighbors are linked only as 'related_to', NEVER as verified facts.
 -- Symmetric similarity is not evidence of support, identity, or causation.
 for other in
   select n.id as node_id, s.id as source_id
   from public.assistant_memory_embeddings own
   join public.assistant_memory_embeddings e on e.user_id=new.user_id and e.id<>own.id
     and e.model=own.model and e.dimensions=own.dimensions and e.source_id<>src.id
   join public.assistant_memory_sources s on s.id=e.source_id and s.user_id=new.user_id and s.state='ready'
   join public.memory_graph_nodes n on n.source_id=s.id and n.user_id=new.user_id
   where own.source_id=src.id and own.user_id=new.user_id and own.fingerprint=src.fingerprint
     and public.assistant_memory_source_allowed(new.user_id,s.source_kind,s.source_record_id)
     and 1-(own.embedding <=> e.embedding) >= 0.86
   order by own.embedding <=> e.embedding limit 4
 loop
   insert into public.memory_graph_edges(user_id,from_node_id,to_node_id,relation,evidence_source_id,confidence)
   values(new.user_id,new.id,other.node_id,'related_to',src.id,0.86)
   on conflict(user_id,from_node_id,to_node_id,relation) do nothing;
 end loop;
 return new;
end;
$$;
create trigger assistant_memory_auto_graph after insert on public.memory_graph_nodes
 for each row when (new.node_kind='source') execute function public.assistant_memory_auto_links();
revoke all on function public.assistant_memory_auto_links() from public,anon,authenticated;

-- Gemini-generated entity candidates must quote exact words from a source;
-- the account and existence of the source are validated on the server.
create function public.assistant_memory_link_entity(p_user_id uuid,p_source_id uuid,
 p_kind text,p_label text,p_evidence text)
returns boolean language plpgsql security definer set search_path='' as $$
declare uid uuid; src public.assistant_memory_sources%rowtype; node_id uuid; entity_id uuid; key text;
begin
 uid:=public.assistant_require_account(p_user_id);
 if p_kind not in ('person','project','organization','goal','concept','decision','event')
 or length(trim(p_label))<2 or length(p_label)>120 or length(p_evidence)<2
 or length(p_evidence)>240 then return false; end if;
 select * into src from public.assistant_memory_sources
  where id=p_source_id and user_id=uid and state='ready';
 if not found or not public.assistant_memory_source_allowed(uid,src.source_kind,src.source_record_id)
 or strpos(lower(src.search_text),lower(trim(p_evidence)))=0
 or strpos(lower(p_evidence),lower(trim(p_label)))=0
 then return false; end if;
 select id into node_id from public.memory_graph_nodes where source_id=src.id and user_id=uid;
 if node_id is null then return false; end if;
 key:=lower(regexp_replace(trim(p_label),'\s+',' ','g'));
 insert into public.memory_graph_nodes(user_id,node_kind,canonical_key,label)
 values(uid,p_kind,key,trim(p_label))
 on conflict(user_id,node_kind,canonical_key) where canonical_key is not null
 do update set label=excluded.label
 returning id into entity_id;
 insert into public.memory_graph_edges(user_id,from_node_id,to_node_id,relation,evidence_source_id,confidence)
 values(uid,node_id,entity_id,'related_to',src.id,0.7)
 on conflict(user_id,from_node_id,to_node_id,relation) do nothing;
 return true;
end;
$$;
revoke all on function public.assistant_memory_link_entity(uuid,uuid,text,text,text) from public,anon;
grant execute on function public.assistant_memory_link_entity(uuid,uuid,text,text,text) to authenticated;

-- Forgotten memories must invalidate their associated attachment sources and graph nodes.
create function public.assistant_memory_invalidate_dependents()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.status='active' and new.status<>'active' then
   delete from public.assistant_memory_sources
    where user_id=new.user_id and memory_id=new.id and source_kind='asset';
 end if;
 return new;
end;
$$;
create trigger assistant_memory_dependents_clear after update of status on public.assistant_memories
 for each row execute function public.assistant_memory_invalidate_dependents();
revoke all on function public.assistant_memory_invalidate_dependents() from public,anon,authenticated;
