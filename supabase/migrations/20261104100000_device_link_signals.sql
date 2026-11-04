-- DeviceLink remote wake hints: NOT commands. Business actions remain authoritative
-- in their existing claim-and-ack tables. No text/audio/pixels/cursor histories.
create table public.device_link_signals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  sender_device_id uuid not null references public.devices(id) on delete cascade,
  target_device_id uuid not null references public.devices(id) on delete cascade,
  request_id uuid not null,
  family text not null check (family in ('remote-dictation','computer-action','remote-read')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 seconds'),
  unique (user_id, sender_device_id, target_device_id, request_id),
  check (sender_device_id <> target_device_id)
);
create index device_link_signals_target on public.device_link_signals
  (user_id, target_device_id, created_at desc);
alter table public.device_link_signals enable row level security;
revoke all on public.device_link_signals from public, anon, authenticated;
grant select on public.device_link_signals to authenticated;
grant select, insert, delete on public.device_link_signals to service_role;

create policy "Read signed-in account wake hints" on public.device_link_signals
for select to authenticated
using ((select auth.uid()) = user_id
  and created_at > now() - interval '1 minute'
  and expires_at > now());

-- This RPC is never exposed to logged-in clients; verified native device
-- signatures and active pairing are checked by the Edge Function before use.
create function public.device_link_send_signal(
  p_user_id uuid, p_sender uuid, p_target uuid, p_request uuid, p_family text
) returns boolean language plpgsql security definer set search_path = '' as $$
declare left_id uuid; right_id uuid;
begin
  if p_user_id is null or p_sender = p_target or p_family not in
    ('remote-dictation','computer-action','remote-read') then return false; end if;
  left_id := least(p_sender,p_target);
  right_id := greatest(p_sender,p_target);
  if not exists (
    select 1 from public.device_pair_links l
    join public.devices a on a.id=p_sender and a.user_id=p_user_id
    join public.devices b on b.id=p_target and b.user_id=p_user_id
    where l.user_id=p_user_id and l.left_device_id=left_id
      and l.right_device_id=right_id and l.revoked_at is null
  ) then return false; end if;
  insert into public.device_link_signals
    (user_id,sender_device_id,target_device_id,request_id,family)
    values(p_user_id,p_sender,p_target,p_request,p_family)
    on conflict (user_id,sender_device_id,target_device_id,request_id) do nothing;
  return true;
end; $$;
revoke all on function public.device_link_send_signal(uuid,uuid,uuid,uuid,text)
from public, anon, authenticated;
grant execute on function public.device_link_send_signal(uuid,uuid,uuid,uuid,text)
to service_role;

-- Realtime sends only a wake hint; the receiver reads the authoritative request.
alter publication supabase_realtime add table public.device_link_signals;
