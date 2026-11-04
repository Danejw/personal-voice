-- Signed, short-lived remote voice requests. Existing version-1 requests are
-- deliberately not trusted by the new receiver and may be cancelled/expired.
alter table public.device_action_requests
  add column request_signature text,
  add column response_signature text,
  add column expires_at timestamptz not null default (now() + interval '30 seconds');
alter table public.device_context_requests
  add column request_signature text,
  add column response_signature text,
  add column expires_at timestamptz not null default (now() + interval '30 seconds');

create index device_action_pending_expiry on public.device_action_requests
  (target_device_id, expires_at) where status='pending';
create index device_context_pending_expiry on public.device_context_requests
  (target_device_id, expires_at) where status='pending';

-- An account session alone cannot create a trusted remote request. Its target
-- and requester must be two different devices with an active pairing.
-- This function is only used in an RLS policy. Because device_pair_links is
-- private to the service role, its lookup needs a narrow SECURITY DEFINER.
create or replace function public.remote_voice_pair_valid(p_uid uuid,p_requester uuid,p_target uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_uid=(select auth.uid()) and p_requester<>p_target
    and exists (
      select 1 from public.device_pair_links l
        where l.user_id=p_uid and l.revoked_at is null
          and l.left_device_id=least(p_requester,p_target)
          and l.right_device_id=greatest(p_requester,p_target)
    ) and exists (select 1 from public.devices d where d.id=p_requester and d.user_id=p_uid)
      and exists (select 1 from public.devices d where d.id=p_target and d.user_id=p_uid);
$$;
revoke all on function public.remote_voice_pair_valid(uuid,uuid,uuid) from public,anon;
grant execute on function public.remote_voice_pair_valid(uuid,uuid,uuid) to authenticated;

-- Prevent rewriting a signed command after inserting it, and make responding
-- one-way. The client independently verifies request and response signatures.
create function public.remote_voice_immutable_request() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if old.user_id is distinct from new.user_id
    or old.requester_device_id is distinct from new.requester_device_id
    or old.target_device_id is distinct from new.target_device_id
    or old.version is distinct from new.version
    or old.created_at is distinct from new.created_at
    or old.expires_at is distinct from new.expires_at
    or old.request_signature is distinct from new.request_signature
    then raise exception 'REMOTE_VOICE_IMMUTABLE' using errcode='22023'; end if;
  if tg_table_name='device_action_requests' then
    if (to_jsonb(old)->>'action') is distinct from (to_jsonb(new)->>'action')
      or (to_jsonb(old)->>'argument') is distinct from (to_jsonb(new)->>'argument')
      then raise exception 'REMOTE_VOICE_IMMUTABLE' using errcode='22023'; end if;
  else
    if (to_jsonb(old)->>'kind') is distinct from (to_jsonb(new)->>'kind')
      then raise exception 'REMOTE_VOICE_IMMUTABLE' using errcode='22023'; end if;
  end if;
  if old.status <> 'pending' or new.status not in ('answered','denied')
      or now() > old.expires_at or new.response_signature is null
      or new.response_signature !~ '^[A-Za-z0-9_-]{86}$' then
    raise exception 'REMOTE_VOICE_EXPIRED_OR_FINAL' using errcode='22023';
  end if;
  return new;
end; $$;
create trigger remote_voice_action_immutable before update on public.device_action_requests
  for each row execute function public.remote_voice_immutable_request();
create trigger remote_voice_context_immutable before update on public.device_context_requests
  for each row execute function public.remote_voice_immutable_request();

drop policy if exists "Users manage their own device action requests" on public.device_action_requests;
drop policy if exists "Users manage their own device context requests" on public.device_context_requests;

create policy remote_voice_action_read on public.device_action_requests
  for select to authenticated using (user_id=(select auth.uid()));
create policy remote_voice_context_read on public.device_context_requests
  for select to authenticated using (user_id=(select auth.uid()));

create policy remote_voice_action_insert on public.device_action_requests
  for insert to authenticated with check (
    user_id=(select auth.uid()) and version=2 and status='pending'
    and request_signature ~ '^[A-Za-z0-9_-]{86}$'
    and expires_at<=now()+interval '31 seconds'
    and expires_at>now()
    and public.remote_voice_pair_valid(user_id,requester_device_id,target_device_id));
create policy remote_voice_context_insert on public.device_context_requests
  for insert to authenticated with check (
    user_id=(select auth.uid()) and version=2 and status='pending'
    and request_signature ~ '^[A-Za-z0-9_-]{86}$'
    and expires_at<=now()+interval '31 seconds'
    and expires_at>now()
    and public.remote_voice_pair_valid(user_id,requester_device_id,target_device_id));
create policy remote_voice_action_update on public.device_action_requests
  for update to authenticated
  using (user_id=(select auth.uid()) and status='pending'
    and public.remote_voice_pair_valid(user_id,requester_device_id,target_device_id))
  with check (user_id=(select auth.uid())
    and public.remote_voice_pair_valid(user_id,requester_device_id,target_device_id));
create policy remote_voice_context_update on public.device_context_requests
  for update to authenticated
  using (user_id=(select auth.uid()) and status='pending'
    and public.remote_voice_pair_valid(user_id,requester_device_id,target_device_id))
  with check (user_id=(select auth.uid())
    and public.remote_voice_pair_valid(user_id,requester_device_id,target_device_id));
create policy remote_voice_action_delete on public.device_action_requests
  for delete to authenticated using (user_id=(select auth.uid()));
create policy remote_voice_context_delete on public.device_context_requests
  for delete to authenticated using (user_id=(select auth.uid()));

comment on function public.remote_voice_pair_valid(uuid,uuid,uuid) is
  'Narrow RLS helper for paired device ownership; signature validation is performed by clients against OS-protected device keys.';
