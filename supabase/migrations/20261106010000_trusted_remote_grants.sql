-- Trusted remote control is a separately approved, short-lived Windows-PC grant.
-- Neither an account JWT nor an Android client can create or extend a grant.
-- Only the existing native-signature-verified device-pairing Edge Function
-- can write the rows, using its service role after verifying the PC key.

create table public.device_trusted_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  pc_device_id uuid not null references public.devices(id) on delete cascade,
  phone_device_id uuid not null references public.devices(id) on delete cascade,
  scopes text[] not null default array['open_app','press_shortcut']::text[],
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  stopped_at timestamptz,
  constraint trusted_distinct_devices check (pc_device_id <> phone_device_id),
  constraint trusted_scope_check check (scopes = array['open_app','press_shortcut']::text[]),
  constraint trusted_lifetime_check check (expires_at > created_at and expires_at <= created_at + interval '15 minutes')
);
create index device_trusted_grants_active_idx
  on public.device_trusted_grants (pc_device_id, phone_device_id, expires_at) where stopped_at is null;
alter table public.device_trusted_grants enable row level security;
revoke all on public.device_trusted_grants from anon,authenticated;
grant select on public.device_trusted_grants to authenticated;
create policy trusted_grants_read on public.device_trusted_grants
  for select to authenticated using (user_id = (select auth.uid()));

-- Atomic once-only receiver claims. Contains metadata only, never arguments.
-- A claim is never leased/retried: a crash gives an honest timeout rather
-- than risking duplicate changes on reconnect or a second concurrent poll.
create table public.device_trusted_claims (
  request_id uuid primary key references public.device_action_requests(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  grant_id uuid not null references public.device_trusted_grants(id) on delete cascade,
  claimed_at timestamptz not null default now()
);
create index device_trusted_claims_rate on public.device_trusted_claims(grant_id,claimed_at);
alter table public.device_trusted_claims enable row level security;
revoke all on public.device_trusted_claims from anon,authenticated;
grant select on public.device_trusted_claims to authenticated;
create policy trusted_claims_read on public.device_trusted_claims
  for select to authenticated using (user_id = (select auth.uid()));

-- Service-role-only routines invoked *after* verified OS device signature.
-- Check pairing revocation, exact device IDs, and the RPC's action allowlist.
create function public.trusted_remote_claim(
  p_user_id uuid, p_pc_id uuid, p_request_id uuid
) returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  g record;
  inserted uuid;
begin
  select * into r from public.device_action_requests
    where id=p_request_id and user_id=p_user_id and target_device_id=p_pc_id
      and status='pending' and version=2 and expires_at>now()
    for update;
  if not found then return false; end if;

  -- Only the two fixed apps and non-modifying navigation shortcuts qualify.
  if not (
    (r.action='open_app' and lower(r.argument) in ('notepad','calculator'))
    or (r.action='press_shortcut' and lower(r.argument) in ('escape','tab'))
  ) then return false; end if;

  select * into g from public.device_trusted_grants
    where user_id=p_user_id and pc_device_id=p_pc_id
      and phone_device_id=r.requester_device_id
      and stopped_at is null and expires_at>now()
      and r.action=any(scopes)
    order by created_at desc limit 1 for update;
  if not found then return false; end if;

  if not exists (
    select 1 from public.device_pair_links l
    where l.user_id=p_user_id and l.revoked_at is null
      and l.left_device_id=least(p_pc_id,r.requester_device_id)
      and l.right_device_id=greatest(p_pc_id,r.requester_device_id)
  ) then return false; end if;

  -- Serialize accepted operations for this grant and enforce a small ceiling.
  if (select count(*) from public.device_trusted_claims c
      where c.grant_id=g.id and c.claimed_at > now()-interval '1 minute') >= 10
  then return false; end if;

  insert into public.device_trusted_claims(request_id,user_id,grant_id)
    values(p_request_id,p_user_id,g.id)
    on conflict (request_id) do nothing
    returning request_id into inserted;
  return inserted is not null;
end;
$$;
revoke all on function public.trusted_remote_claim(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.trusted_remote_claim(uuid,uuid,uuid) to service_role;
comment on function public.trusted_remote_claim(uuid,uuid,uuid) is
  'Service-role-only single execution claim after native Windows identity proof; no arguments or secrets are logged.';

-- The receiver's second, fresh verification occurs just before native work.
create function public.trusted_remote_validate(
  p_user_id uuid, p_pc_id uuid, p_request_id uuid
) returns boolean language sql stable security definer set search_path = ''
as $$
  select exists(
    select 1 from public.device_trusted_claims c
    join public.device_trusted_grants g on g.id=c.grant_id
    join public.device_action_requests r on r.id=c.request_id
    join public.device_pair_links l on l.user_id=g.user_id
      and l.left_device_id=least(g.pc_device_id,g.phone_device_id)
      and l.right_device_id=greatest(g.pc_device_id,g.phone_device_id)
    where c.request_id=p_request_id and c.user_id=p_user_id
      and g.user_id=p_user_id and g.pc_device_id=p_pc_id
      and r.user_id=p_user_id and r.target_device_id=p_pc_id
      and r.requester_device_id=g.phone_device_id
      and r.status='pending' and r.expires_at>now() and r.version=2
      and g.stopped_at is null and g.expires_at>now()
      and l.revoked_at is null
  );
$$;
revoke all on function public.trusted_remote_validate(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.trusted_remote_validate(uuid,uuid,uuid) to service_role;

-- Server-side constraints apply even if a service client attempts to forge
-- a grant without passing through the verified Edge Function's checks.
create function public.trusted_grant_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists(
    select 1 from public.devices p where p.id=new.pc_device_id
      and p.user_id=new.user_id and p.platform='windows'
  ) or not exists(
    select 1 from public.devices d where d.id=new.phone_device_id and d.user_id=new.user_id
      and d.platform='android'
  ) or not exists (
    select 1 from public.device_pair_links l where l.user_id=new.user_id
      and l.revoked_at is null and l.left_device_id=least(new.pc_device_id,new.phone_device_id)
      and l.right_device_id=greatest(new.pc_device_id,new.phone_device_id)
  ) then raise exception 'TRUSTED_GRANT_REQUIRES_PAIR' using errcode='23514'; end if;
  if tg_op='UPDATE' and (
    old.id is distinct from new.id or old.user_id is distinct from new.user_id
    or old.pc_device_id is distinct from new.pc_device_id
    or old.phone_device_id is distinct from new.phone_device_id
    or old.scopes is distinct from new.scopes or old.expires_at is distinct from new.expires_at
    or (old.stopped_at is not null and new.stopped_at is distinct from old.stopped_at)
  ) then raise exception 'TRUSTED_GRANT_IMMUTABLE' using errcode='22023'; end if;
  return new;
end;
$$;
create trigger trusted_grants_guard before insert or update on public.device_trusted_grants
  for each row execute function public.trusted_grant_guard();
