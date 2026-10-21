-- Opt-in clipboard history for the signed-in account.
-- Clients upload only after the user turns sync on. Tombstones propagate deletion.
-- A permanent clear removes the rows and records clipboard_resets.cleared_at.

begin;

create table public.clipboard_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('text', 'url', 'image')),
  text text check (text is null or (char_length(text) between 1 and 100000)),
  content_hash text not null check (char_length(content_hash) between 16 and 128),
  source_app text check (source_app is null or char_length(source_app) between 1 and 300),
  source_process text check (source_process is null or char_length(source_process) between 1 and 160),
  source_device_id uuid references public.devices (id) on delete set null,
  pinned boolean not null default false,
  copy_count integer not null default 1 check (copy_count >= 0),
  last_copied_at timestamptz,
  image_path text check (image_path is null or char_length(image_path) between 1 and 1500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (
    deleted_at is not null
    or (kind in ('text', 'url') and text is not null)
    or (kind = 'image')
  )
);

create unique index clipboard_entries_live_hash_idx
  on public.clipboard_entries (user_id, content_hash)
  where deleted_at is null;

create index clipboard_entries_user_updated_idx
  on public.clipboard_entries (user_id, updated_at desc);

alter table public.clipboard_entries enable row level security;

create policy "Users manage their own clipboard history" on public.clipboard_entries
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (
      source_device_id is null
      or exists (
        select 1
        from public.devices
        where devices.id = clipboard_entries.source_device_id
          and devices.user_id = (select auth.uid())
      )
    )
  );

revoke all on public.clipboard_entries from anon;
grant select, insert, update, delete on public.clipboard_entries to authenticated;

comment on table public.clipboard_entries is
  'Opt-in account clipboard history. Text is cleared on delete. updated_at is client-supplied so devices can merge.';

create table public.clipboard_resets (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  cleared_at timestamptz not null default now()
);

alter table public.clipboard_resets enable row level security;

create policy "Users manage their own clipboard reset" on public.clipboard_resets
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on public.clipboard_resets from anon;
grant select, insert, update, delete on public.clipboard_resets to authenticated;

comment on table public.clipboard_resets is
  'Timestamp of the last permanent clipboard-history clear for this account.';

insert into storage.buckets (id, name, public, file_size_limit)
values ('clipboard-images', 'clipboard-images', false, 10485760)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit;

create policy "Users read their own clipboard images" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'clipboard-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "Users upload their own clipboard images" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'clipboard-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "Users update their own clipboard images" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'clipboard-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'clipboard-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "Users delete their own clipboard images" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'clipboard-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

commit;
