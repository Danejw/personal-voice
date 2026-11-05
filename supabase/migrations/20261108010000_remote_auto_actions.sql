-- Explicit Windows "Allow remote actions" authorizes routine signed requests from paired devices.
-- Claims are single-use, server-atomic and require a freshly verified native PC identity
-- at the device-pairing Edge Function. Disabling the PC switch takes effect locally.
create table public.device_auto_action_claims (
  request_id uuid primary key references public.device_action_requests(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  pc_device_id uuid not null references public.devices(id) on delete cascade,
  claimed_at timestamptz not null default now()
);
create index device_auto_action_claims_recent_idx
  on public.device_auto_action_claims(pc_device_id, claimed_at);
alter table public.device_auto_action_claims enable row level security;
revoke all on public.device_auto_action_claims from public, anon, authenticated;

create function public.remote_auto_claim(p_user_id uuid, p_pc_id uuid, p_request_id uuid)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  inserted uuid;
begin
  if exists (select 1 from public.device_auto_action_claims
             where request_id = p_request_id and user_id = p_user_id and pc_device_id = p_pc_id) then
    return 'already';
  end if;
  select * into r from public.device_action_requests
    where id = p_request_id and user_id = p_user_id and target_device_id = p_pc_id
      and status = 'pending' and version = 2 and expires_at > now()
    for update;
  if not found then return 'none'; end if;
  if not exists (select 1 from public.devices d where d.id=p_pc_id and d.user_id=p_user_id and d.platform='windows') then
    return 'none';
  end if;
  if not exists (
    select 1 from public.device_pair_links l
    where l.user_id=p_user_id and l.revoked_at is null
      and l.left_device_id=least(p_pc_id,r.requester_device_id)
      and l.right_device_id=greatest(p_pc_id,r.requester_device_id)
  ) then return 'none'; end if;
  if not (
    (r.action in ('move_pointer','click_pointer','double_click_pointer','right_click_pointer')
      and r.argument ~ '^(0|[1-9][0-9]{0,2}),(0|[1-9][0-9]{0,2})$')
    or (r.action='drag_pointer' and r.argument ~ '^(0|[1-9][0-9]{0,2}),(0|[1-9][0-9]{0,2}),(0|[1-9][0-9]{0,2}),(0|[1-9][0-9]{0,2})$')
    or (r.action='open_app' and length(r.argument) between 1 and 120
      and r.argument ~ '^[a-zA-Z0-9][a-zA-Z0-9 _().+&''-]*$'
      and lower(regexp_replace(r.argument,'[.]exe$','','i')) not in
        ('cmd','powershell','pwsh','wscript','cscript','mshta','rundll32','regsvr32','reg','schtasks','wmic','bash','sh','wsl','python','py','node','npm','npx'))
    or (r.action='press_shortcut' and r.argument in ('copy','paste','select-all','undo','escape','tab'))
    or (r.action='insert_text' and length(trim(r.argument)) between 1 and 500)
    or (r.action='start_computer_goal' and length(r.argument) between 3 and 1000 and r.argument=trim(r.argument))
    or (r.action in ('computer_goal_status','stop_computer_goal') and r.argument='current')
  ) then return 'none'; end if;
  if (select count(*) from public.device_auto_action_claims c
       where c.pc_device_id=p_pc_id and c.claimed_at>now()-interval '1 minute') >= 120
  then return 'none'; end if;
  insert into public.device_auto_action_claims(request_id,user_id,pc_device_id)
    values (p_request_id,p_user_id,p_pc_id)
    on conflict (request_id) do nothing returning request_id into inserted;
  if inserted is null then return 'already'; end if;
  return 'claimed';
end;
$$;
revoke all on function public.remote_auto_claim(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.remote_auto_claim(uuid,uuid,uuid) to service_role;

create function public.remote_auto_validate(p_user_id uuid, p_pc_id uuid, p_request_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.device_auto_action_claims c
    join public.device_action_requests r on r.id=c.request_id
    join public.device_pair_links l on l.user_id=r.user_id
      and l.left_device_id=least(r.target_device_id,r.requester_device_id)
      and l.right_device_id=greatest(r.target_device_id,r.requester_device_id)
    where c.request_id=p_request_id and c.user_id=p_user_id and c.pc_device_id=p_pc_id
      and r.user_id=p_user_id and r.target_device_id=p_pc_id
      and r.status='pending' and r.version=2 and r.expires_at>now()
      and l.revoked_at is null
  );
$$;
revoke all on function public.remote_auto_validate(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.remote_auto_validate(uuid,uuid,uuid) to service_role;

create function public.remote_auto_seen(p_user_id uuid, p_pc_id uuid, p_request_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.device_auto_action_claims c
    where c.request_id=p_request_id and c.user_id=p_user_id and c.pc_device_id=p_pc_id
  );
$$;
revoke all on function public.remote_auto_seen(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.remote_auto_seen(uuid,uuid,uuid) to service_role;
