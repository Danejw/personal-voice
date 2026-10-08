-- Invalidate stale indexed source snapshots when their canonical records change.
-- Opt-in source registration remains guarded by the existing account settings.
create function public.assistant_memory_sync_note()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='DELETE' then
  delete from public.assistant_memory_sources where user_id=old.user_id and source_kind='note' and source_record_id=old.id;
  return old;
 end if;
 if exists(select 1 from public.settings s where s.user_id=new.user_id
   and s.assistant_semantic_search and s.assistant_recall_notes) then
  perform public.assistant_memory_upsert_source(new.user_id,'note',new.id,null,
   new.text,md5(new.text||':'||new.updated_at::text));
 end if;
 return new;
end;
$$;
create trigger assistant_memory_note_sync after insert or update of text,updated_at or delete on public.notes
 for each row execute function public.assistant_memory_sync_note();
revoke all on function public.assistant_memory_sync_note() from public,anon,authenticated;

create function public.assistant_memory_sync_note_attachment()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='DELETE' then
  delete from public.assistant_memory_sources where user_id=old.user_id and source_kind='note_attachment' and source_record_id=old.id;
  return old;
 end if;
 if new.size_bytes<=7340032 and new.mime_type in
  ('image/jpeg','image/png','audio/mpeg','audio/wav','video/mp4','video/quicktime','application/pdf')
 and exists (
   select 1 from public.settings s where s.user_id=new.user_id
   and s.assistant_semantic_search and s.assistant_recall_notes
 ) then
  perform public.assistant_memory_upsert_source(new.user_id,'note_attachment',new.id,null,
    left(new.file_name,8000),md5(new.storage_path||':'||new.size_bytes::text||':'||coalesce(new.mime_type,'')));
 end if;
 return new;
end;
$$;
create trigger assistant_memory_note_attachment_sync after insert or delete on public.note_attachments
 for each row execute function public.assistant_memory_sync_note_attachment();
revoke all on function public.assistant_memory_sync_note_attachment() from public,anon,authenticated;

create function public.assistant_memory_sync_dictation()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='DELETE' then
  delete from public.assistant_memory_sources where user_id=old.user_id and source_kind='dictation' and source_record_id=old.id;
 end if;
 return old;
end;
$$;
create trigger assistant_memory_dictation_delete after delete on public.dictations
 for each row execute function public.assistant_memory_sync_dictation();
revoke all on function public.assistant_memory_sync_dictation() from public,anon,authenticated;
