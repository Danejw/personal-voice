-- Remote Dictation: short-lived exact-transcript delivery to one owned device.
-- Rows are claimed once, inserted immediately, acknowledged, then deleted by the sender.
-- Not handoffs. Not Assistant remote computer actions.

create table public.remote_dictation_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  source_device_id uuid not null,
  target_device_id uuid not null,
  text text not null check (char_length(text) between 1 and 100000 and text = btrim(text)),
  status text not null default 'pending' check (status in ('pending', 'processing', 'inserted', 'failed')),
  error text check (error is null or (char_length(error) between 1 and 500 and error = btrim(error))),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  completed_at timestamptz,
  check (source_device_id <> target_device_id),
  check (expires_at > created_at)
);

create index remote_dictation_requests_target_pending_idx
  on public.remote_dictation_requests (user_id, target_device_id, status, created_at);

create index remote_dictation_requests_source_idx
  on public.remote_dictation_requests (user_id, source_device_id, created_at desc);

alter table public.remote_dictation_requests enable row level security;

-- Clients use SECURITY DEFINER RPCs. Direct table access is denied.
revoke all on public.remote_dictation_requests from anon, authenticated;

alter table public.remote_dictation_requests replica identity full;

do $publication$
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.remote_dictation_requests;
    exception
      when duplicate_object then null;
    end;
  end if;
end
$publication$;

create or replace function public.create_remote_dictation_request(
  p_source_device_id uuid,
  p_target_device_id uuid,
  p_text text,
  p_ttl_seconds integer default 6
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  cleaned text := btrim(coalesce(p_text, ''));
  ttl integer := coalesce(p_ttl_seconds, 6);
  new_id uuid;
begin
  if uid is null then
    raise exception 'REMOTE_DICTATION_UNAUTHORIZED' using errcode = '42501';
  end if;
  if p_source_device_id is null or p_target_device_id is null then
    raise exception 'REMOTE_DICTATION_REJECTED' using errcode = '23514';
  end if;
  if p_source_device_id = p_target_device_id then
    raise exception 'REMOTE_DICTATION_SAME_DEVICE' using errcode = '23514';
  end if;
  if cleaned = '' or char_length(cleaned) > 100000 then
    raise exception 'REMOTE_DICTATION_TEXT' using errcode = '23514';
  end if;
  if ttl < 3 or ttl > 15 then
    raise exception 'REMOTE_DICTATION_TTL' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.devices d
    where d.id = p_source_device_id and d.user_id = uid
  ) then
    raise exception 'REMOTE_DICTATION_SOURCE' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.devices d
    where d.id = p_target_device_id and d.user_id = uid
  ) then
    raise exception 'REMOTE_DICTATION_TARGET' using errcode = '23514';
  end if;

  insert into public.remote_dictation_requests (
    user_id, source_device_id, target_device_id, text, expires_at
  ) values (
    uid,
    p_source_device_id,
    p_target_device_id,
    cleaned,
    pg_catalog.now() + (ttl * interval '1 second')
  )
  returning id into new_id;

  return new_id;
end;
$$;

create or replace function public.claim_remote_dictation_request(
  p_id uuid,
  p_target_device_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  req public.remote_dictation_requests;
begin
  if uid is null or p_id is null or p_target_device_id is null then
    return null;
  end if;

  select * into req
  from public.remote_dictation_requests r
  where r.id = p_id
    and r.user_id = uid
    and r.target_device_id = p_target_device_id
  for update;

  if not found then
    return null;
  end if;
  if req.status <> 'pending' then
    return null;
  end if;
  if req.expires_at <= pg_catalog.now() then
    update public.remote_dictation_requests
      set status = 'failed',
          error = 'Request expired.',
          completed_at = pg_catalog.now()
      where id = req.id and status = 'pending';
    return null;
  end if;

  update public.remote_dictation_requests
    set status = 'processing'
    where id = req.id and status = 'pending'
    returning * into req;

  if not found then
    return null;
  end if;

  return pg_catalog.jsonb_build_object(
    'id', req.id,
    'user_id', req.user_id,
    'source_device_id', req.source_device_id,
    'target_device_id', req.target_device_id,
    'text', req.text,
    'status', req.status,
    'error', req.error,
    'created_at', req.created_at,
    'expires_at', req.expires_at,
    'completed_at', req.completed_at
  );
end;
$$;

create or replace function public.complete_remote_dictation_request(
  p_id uuid,
  p_target_device_id uuid,
  p_ok boolean,
  p_error text default null
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  req public.remote_dictation_requests;
  cleaned_error text := nullif(btrim(coalesce(p_error, '')), '');
begin
  if uid is null or p_id is null or p_target_device_id is null or p_ok is null then
    return false;
  end if;
  if cleaned_error is not null and char_length(cleaned_error) > 500 then
    cleaned_error := left(cleaned_error, 500);
  end if;

  select * into req
  from public.remote_dictation_requests r
  where r.id = p_id
    and r.user_id = uid
    and r.target_device_id = p_target_device_id
  for update;

  if not found then
    return false;
  end if;
  if req.status <> 'processing' then
    return false;
  end if;

  -- Success may not land after expiry. Failure may still acknowledge a timed-out claim.
  if p_ok and req.expires_at <= pg_catalog.now() then
    update public.remote_dictation_requests
      set status = 'failed',
          error = 'Request expired before insertion.',
          completed_at = pg_catalog.now()
      where id = req.id and status = 'processing';
    return false;
  end if;

  update public.remote_dictation_requests
    set status = case when p_ok then 'inserted' else 'failed' end,
        error = case when p_ok then null else coalesce(cleaned_error, 'Insertion failed.') end,
        completed_at = pg_catalog.now()
    where id = req.id and status = 'processing';

  return found;
end;
$$;

create or replace function public.get_remote_dictation_request(
  p_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  req public.remote_dictation_requests;
begin
  if uid is null or p_id is null then
    return null;
  end if;
  select * into req
  from public.remote_dictation_requests r
  where r.id = p_id and r.user_id = uid;
  if not found then
    return null;
  end if;
  return pg_catalog.jsonb_build_object(
    'id', req.id,
    'user_id', req.user_id,
    'source_device_id', req.source_device_id,
    'target_device_id', req.target_device_id,
    'text', req.text,
    'status', req.status,
    'error', req.error,
    'created_at', req.created_at,
    'expires_at', req.expires_at,
    'completed_at', req.completed_at
  );
end;
$$;

create or replace function public.list_pending_remote_dictation_requests(
  p_target_device_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null or p_target_device_id is null then
    return '[]'::jsonb;
  end if;
  -- Expire stale pending rows before listing so catch-up cannot paste late.
  update public.remote_dictation_requests
    set status = 'failed',
        error = 'Request expired.',
        completed_at = pg_catalog.now()
    where user_id = uid
      and target_device_id = p_target_device_id
      and status = 'pending'
      and expires_at <= pg_catalog.now();

  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', r.id,
      'user_id', r.user_id,
      'source_device_id', r.source_device_id,
      'target_device_id', r.target_device_id,
      'text', r.text,
      'status', r.status,
      'error', r.error,
      'created_at', r.created_at,
      'expires_at', r.expires_at,
      'completed_at', r.completed_at
    ) order by r.created_at)
    from public.remote_dictation_requests r
    where r.user_id = uid
      and r.target_device_id = p_target_device_id
      and r.status = 'pending'
      and r.expires_at > pg_catalog.now()
  ), '[]'::jsonb);
end;
$$;

create or replace function public.delete_remote_dictation_request(
  p_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null or p_id is null then
    return;
  end if;
  delete from public.remote_dictation_requests
  where id = p_id and user_id = uid;
end;
$$;

revoke all on function public.create_remote_dictation_request(uuid, uuid, text, integer) from public, anon;
revoke all on function public.claim_remote_dictation_request(uuid, uuid) from public, anon;
revoke all on function public.complete_remote_dictation_request(uuid, uuid, boolean, text) from public, anon;
revoke all on function public.get_remote_dictation_request(uuid) from public, anon;
revoke all on function public.list_pending_remote_dictation_requests(uuid) from public, anon;
revoke all on function public.delete_remote_dictation_request(uuid) from public, anon;

grant execute on function public.create_remote_dictation_request(uuid, uuid, text, integer) to authenticated;
grant execute on function public.claim_remote_dictation_request(uuid, uuid) to authenticated;
grant execute on function public.complete_remote_dictation_request(uuid, uuid, boolean, text) to authenticated;
grant execute on function public.get_remote_dictation_request(uuid) to authenticated;
grant execute on function public.list_pending_remote_dictation_requests(uuid) to authenticated;
grant execute on function public.delete_remote_dictation_request(uuid) to authenticated;
