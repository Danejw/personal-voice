-- Private, generic file attachments for editable Notes.

create table public.note_attachments (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  note_id uuid not null references public.notes (id) on delete cascade,
  storage_path text not null check (char_length(storage_path) between 1 and 1500),
  file_name text not null check (char_length(file_name) between 1 and 500),
  mime_type text check (mime_type is null or char_length(mime_type) <= 255),
  size_bytes bigint not null check (size_bytes between 0 and 104857600),
  created_at timestamptz not null default now()
);

create index note_attachments_note_created_idx
  on public.note_attachments (note_id, created_at);

alter table public.note_attachments enable row level security;

create policy "Users manage their own note attachments" on public.note_attachments
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.notes
      where notes.id = note_attachments.note_id
        and notes.user_id = (select auth.uid())
    )
  );

revoke all on public.note_attachments from anon;
grant select, insert, delete on public.note_attachments to authenticated;

insert into storage.buckets (id, name, public, file_size_limit)
values ('note-attachments', 'note-attachments', false, 104857600)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit;

create policy "Users read their own note attachment objects" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'note-attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "Users upload their own note attachment objects" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'note-attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "Users delete their own note attachment objects" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'note-attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
