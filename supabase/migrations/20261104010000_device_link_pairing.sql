-- DeviceLink phase 1: same-account, one-time pairing invitations and explicit approval.
-- A registered device is NOT implicitly paired, and pairing does NOT grant remote-control access.
-- All tables are private to SECURITY DEFINER RPCs. The sender/receiver verify signed proofs.
create table public.device_pair_identities (
  device_id uuid primary key references public.devices(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  public_jwk jsonb not null,
  created_at timestamptz not null default now(),
  constraint device_pair_identity_jwk check (
    public_jwk->>'kty' = 'EC' and public_jwk->>'crv' = 'P-256'
    and (public_jwk->>'x') ~ '^[A-Za-z0-9_-]{43}$'
    and (public_jwk->>'y') ~ '^[A-Za-z0-9_-]{43}$'
    and jsonb_typeof(public_jwk) = 'object'
    and not (public_jwk ? 'd')
    and public_jwk - 'kty' - 'crv' - 'x' - 'y' = '{}'::jsonb
  )
);
create index device_pair_identities_owner on public.device_pair_identities(user_id);

create table public.device_pair_invitations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  issuer_device_id uuid not null references public.devices(id) on delete cascade,
  code_digest bytea not null,
  claimant_device_id uuid references public.devices(id) on delete cascade,
  claim_signature text,
  approval_signature text,
  status text not null default 'open'
    check (status in ('open', 'claimed', 'approved', 'cancelled')),
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '5 minutes'),
  check (claimant_device_id is null or claimant_device_id <> issuer_device_id)
);
create index device_pair_invite_owner on public.device_pair_invitations(user_id, issuer_device_id, created_at desc);

create table public.device_pair_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  attempted_at timestamptz not null default now()
);
create index device_pair_attempts_recent on public.device_pair_attempts(user_id, attempted_at desc);

-- A unique signed request ID prevents cross-network retries from replaying operations.
create table public.device_pair_proofs (
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid not null references public.devices(id) on delete cascade,
  nonce uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, device_id, nonce)
);
create index device_pair_proofs_created on public.device_pair_proofs (created_at);

create table public.device_pair_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  left_device_id uuid not null references public.devices(id) on delete cascade,
  right_device_id uuid not null references public.devices(id) on delete cascade,
  invite_id uuid not null unique references public.device_pair_invitations(id) on delete cascade,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (user_id, left_device_id, right_device_id),
  check (left_device_id::text < right_device_id::text)
);
create index device_pair_links_owner on public.device_pair_links(user_id, revoked_at);

alter table public.device_pair_identities enable row level security;
alter table public.device_pair_invitations enable row level security;
alter table public.device_pair_attempts enable row level security;
alter table public.device_pair_links enable row level security;
alter table public.device_pair_proofs enable row level security;
revoke all on public.device_pair_identities, public.device_pair_invitations,
  public.device_pair_attempts, public.device_pair_links, public.device_pair_proofs from public, anon, authenticated;
-- The Edge Function uses the service-role client to read identities and persist proof nonces.
grant select, insert, update, delete on public.device_pair_identities,
  public.device_pair_invitations, public.device_pair_attempts,
  public.device_pair_links, public.device_pair_proofs to service_role;

-- Registration is immutable for a device ID. If a keystore is lost, remove/re-register
-- the device with a new ID; the old keys cannot be overwritten through this RPC.
create function public.pair_register_identity(p_user_id uuid, p_device_id uuid, p_public_jwk jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare uid uuid := p_user_id;
begin
  if uid is null or not exists (
    select 1 from public.devices where id = p_device_id and user_id = uid
  ) then raise exception 'PAIR_DEVICE_REQUIRED' using errcode = '42501'; end if;
  insert into public.device_pair_identities(device_id, user_id, public_jwk)
  values (p_device_id, uid, p_public_jwk)
  on conflict (device_id) do nothing;
  if not exists (
    select 1 from public.device_pair_identities
    where device_id = p_device_id and user_id = uid and public_jwk = p_public_jwk
  ) then raise exception 'PAIR_KEY_CHANGED' using errcode = '42501'; end if;
  return true;
end; $$;

-- Codes are returned to the inviter only and never stored as plaintext.
create function public.pair_create_invite(p_user_id uuid, p_device_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := p_user_id;
  digits text; new_id uuid; expiry timestamptz; rng bytea;
begin
  if uid is null or not exists (
    select 1 from public.device_pair_identities where device_id = p_device_id and user_id = uid
  ) then raise exception 'PAIR_IDENTITY_REQUIRED' using errcode = '42501'; end if;
  -- A fresh one-time code; only a small bounded number of invitations per account.
  if (select count(*) from public.device_pair_invitations
      where user_id = uid and created_at > now() - interval '10 minutes') >= 6
  then raise exception 'PAIR_INVITE_LIMIT' using errcode = '42901'; end if;
  rng := pg_catalog.decode(pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', ''), 'hex');
  digits := lpad(((get_byte(rng, 0)::bigint * 16777216
    + get_byte(rng, 1)::bigint * 65536
    + get_byte(rng, 2)::bigint * 256
    + get_byte(rng, 3)::bigint) % 100000000)::text, 8, '0');
  insert into public.device_pair_invitations(user_id, issuer_device_id, code_digest)
  values (uid, p_device_id, pg_catalog.sha256(pg_catalog.convert_to(digits, 'UTF8')))
  returning id, expires_at into new_id, expiry;
  return jsonb_build_object('id',new_id,'code',digits,'expires_at',expiry);
end; $$;

-- Before code comparison record the attempt, including incorrect guesses. User-level
-- throttling keeps guessing bounded across all claimed device IDs in the account.
create function public.pair_claim_invite(p_user_id uuid, p_device_id uuid, p_code text, p_signature text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := p_user_id; inv public.device_pair_invitations;
begin
  if uid is null or not exists (
    select 1 from public.device_pair_identities where user_id = uid and device_id = p_device_id
  ) then raise exception 'PAIR_IDENTITY_REQUIRED' using errcode = '42501'; end if;
  -- Serialize attempts per account before checking the limit to prevent racing claims.
  perform 1 from auth.users where id=uid for update;
  if (select count(*) from public.device_pair_attempts
    where user_id = uid and attempted_at > now() - interval '10 minutes') >= 5
  then return jsonb_build_object('error','rate_limited'); end if;
  insert into public.device_pair_attempts(user_id) values(uid);
  if p_code !~ '^[0-9]{8}$' or p_signature !~ '^[A-Za-z0-9_-]{86}$'
  then return jsonb_build_object('error','invalid'); end if;
  select * into inv from public.device_pair_invitations
  where user_id = uid and status = 'open' and expires_at > now()
    and code_digest = pg_catalog.sha256(pg_catalog.convert_to(p_code, 'UTF8'))
  order by created_at desc limit 1 for update;
  if not found then return jsonb_build_object('error','invalid'); end if;
  if inv.issuer_device_id = p_device_id then return jsonb_build_object('error','invalid'); end if;
  update public.device_pair_invitations
    set status = 'claimed', claimant_device_id = p_device_id, claim_signature = p_signature
    where id = inv.id;
  return jsonb_build_object('id',inv.id,'issuer_device_id',inv.issuer_device_id,
    'claimant_device_id',p_device_id);
end; $$;

create function public.pair_get_invite(p_user_id uuid, p_id uuid, p_device_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := p_user_id; inv public.device_pair_invitations;
  issuer_key jsonb; claimant_key jsonb;
begin
  select * into inv from public.device_pair_invitations
  where id = p_id and user_id = uid
    and (issuer_device_id = p_device_id or claimant_device_id = p_device_id);
  if not found then return null; end if;
  select public_jwk into issuer_key from public.device_pair_identities
    where device_id=inv.issuer_device_id and user_id=uid;
  select public_jwk into claimant_key from public.device_pair_identities
    where device_id=inv.claimant_device_id and user_id=uid;
  return jsonb_build_object('id',inv.id,'status',inv.status,
    'issuer_device_id',inv.issuer_device_id,'claimant_device_id',inv.claimant_device_id,
    'issuer_key',issuer_key,'claimant_key',claimant_key,
    'claim_signature',inv.claim_signature,'approval_signature',inv.approval_signature,
    'expires_at',inv.expires_at);
end; $$;

-- Desktop only approves after verifying the claimant's public-key signature.
-- The approval proof is also checked by the joining device before it reports paired.
create function public.pair_approve_invite(p_user_id uuid, p_id uuid, p_device_id uuid, p_signature text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare uid uuid := p_user_id; inv public.device_pair_invitations;
  a uuid; b uuid;
begin
  if p_signature !~ '^[A-Za-z0-9_-]{80,100}$' then return false; end if;
  select * into inv from public.device_pair_invitations
   where id=p_id and user_id=uid and issuer_device_id=p_device_id and status='claimed'
     and expires_at > now() for update;
  if not found or inv.claimant_device_id is null then return false; end if;
  a:=least(inv.issuer_device_id,inv.claimant_device_id);
  b:=greatest(inv.issuer_device_id,inv.claimant_device_id);
  insert into public.device_pair_links(user_id,left_device_id,right_device_id,invite_id)
    values(uid,a,b,inv.id)
    on conflict (user_id,left_device_id,right_device_id)
    do update set invite_id=excluded.invite_id, revoked_at=null, created_at=now();
  update public.device_pair_invitations
    set status='approved', approval_signature=p_signature where id=p_id;
  return true;
end; $$;

create function public.pair_cancel_invite(p_user_id uuid, p_id uuid, p_device_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.device_pair_invitations set status='cancelled'
  where id=p_id and user_id=p_user_id and status in ('open','claimed')
    and issuer_device_id=p_device_id;
  return found;
end; $$;

create function public.pair_list_links(p_user_id uuid, p_device_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := p_user_id;
begin
  if uid is null or not exists (select 1 from public.device_pair_identities
    where device_id=p_device_id and user_id=uid) then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id',l.id,'peer_device_id',case when l.left_device_id=p_device_id
      then l.right_device_id else l.left_device_id end,
    'invite_id',l.invite_id,'approval_signature',i.approval_signature,
    'claim_signature',i.claim_signature,'issuer_device_id',i.issuer_device_id,
    'claimant_device_id',i.claimant_device_id,
    'issuer_key',(select public_jwk from public.device_pair_identities where device_id=i.issuer_device_id),
    'claimant_key',(select public_jwk from public.device_pair_identities where device_id=i.claimant_device_id),
    'created_at',l.created_at))
    from public.device_pair_links l
    join public.device_pair_invitations i on i.id=l.invite_id
    where l.user_id=uid and l.revoked_at is null
      and (l.left_device_id=p_device_id or l.right_device_id=p_device_id)), '[]'::jsonb);
end; $$;

create function public.pair_revoke_link(p_user_id uuid, p_link_id uuid, p_device_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.device_pair_links set revoked_at=now()
  where id=p_link_id and user_id=p_user_id
    and (left_device_id=p_device_id or right_device_id=p_device_id)
    and revoked_at is null;
  return found;
end; $$;

-- Only the server-side Edge Function, after verifying JWT + native device proof,
-- can call the privileged pairing RPCs. An authenticated browser cannot bypass proof checks.
revoke all on function
  public.pair_register_identity(uuid,uuid,jsonb),
  public.pair_create_invite(uuid,uuid),
  public.pair_claim_invite(uuid,uuid,text,text),
  public.pair_get_invite(uuid,uuid,uuid),
  public.pair_approve_invite(uuid,uuid,uuid,text),
  public.pair_cancel_invite(uuid,uuid,uuid),
  public.pair_list_links(uuid,uuid),
  public.pair_revoke_link(uuid,uuid,uuid) from public, anon, authenticated;

grant execute on function
  public.pair_register_identity(uuid,uuid,jsonb),
  public.pair_create_invite(uuid,uuid),
  public.pair_claim_invite(uuid,uuid,text,text),
  public.pair_get_invite(uuid,uuid,uuid),
  public.pair_approve_invite(uuid,uuid,uuid,text),
  public.pair_cancel_invite(uuid,uuid,uuid),
  public.pair_list_links(uuid,uuid),
  public.pair_revoke_link(uuid,uuid,uuid) to service_role;
