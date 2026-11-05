-- PR 3: signed Android controls, using the same one-time claim and Windows identity.
alter table public.device_action_requests drop constraint if exists device_action_requests_action_check;
alter table public.device_action_requests add constraint device_action_requests_action_check
  check (action in (
    'open_app','press_shortcut','insert_text','move_pointer','click_pointer',
    'double_click_pointer','right_click_pointer','drag_pointer',
    'start_computer_goal','computer_goal_status','stop_computer_goal',
    'pause_computer_goal','resume_computer_goal','redirect_computer_goal'
  ));
alter table public.computer_jobs add column control_state text not null default 'active'
  check (control_state in ('active','paused'));
alter table public.computer_jobs add column instruction_revision integer not null default 0
  check (instruction_revision >= 0);

create or replace function public.remote_auto_claim(p_user_id uuid, p_pc_id uuid, p_request_id uuid)
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
    or (r.action in ('computer_goal_status','stop_computer_goal','pause_computer_goal','resume_computer_goal') and r.argument='current')
    or (r.action='redirect_computer_goal' and length(r.argument) between 3 and 1000 and r.argument=trim(r.argument))
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

-- Only Windows can commit control state. Every change must refer to a fresh,
-- already-claimed signed phone request from this job's original paired requester.
create function public.computer_job_control(p_user_id uuid, p_pc_id uuid, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  cmd public.device_action_requests;
  job public.computer_jobs;
begin
  select r.* into cmd from public.device_action_requests r
  join public.device_auto_action_claims c on c.request_id=r.id
  where r.id=p_request_id and r.user_id=p_user_id and r.target_device_id=p_pc_id
    and c.user_id=p_user_id and c.pc_device_id=p_pc_id
    and r.status='pending' and r.version=2 and r.expires_at>now()
    and r.action in ('pause_computer_goal','resume_computer_goal','redirect_computer_goal')
  for update of r;
  if not found then raise exception 'Control request not authorized' using errcode='42501'; end if;
  select * into job from public.computer_jobs j
    where j.user_id=p_user_id and j.target_device_id=p_pc_id and j.status='running'
      and j.requester_device_id=cmd.requester_device_id
    for update;
  if not found or job.stop_requested_at is not null then
    raise exception 'No active goal for the paired requester' using errcode='23514';
  end if;
  if not exists(select 1 from public.device_pair_links l
      where l.user_id=p_user_id and l.revoked_at is null
        and l.left_device_id=least(p_pc_id,cmd.requester_device_id)
        and l.right_device_id=greatest(p_pc_id,cmd.requester_device_id)) then
    raise exception 'Pairing revoked' using errcode='42501';
  end if;
  if cmd.action='pause_computer_goal' then
    if cmd.argument<>'current' then raise exception 'Invalid pause request' using errcode='22023'; end if;
    update public.computer_jobs set control_state='paused',updated_at=now()
      where id=job.id returning * into job;
  elsif cmd.action='resume_computer_goal' then
    if cmd.argument<>'current' then raise exception 'Invalid resume request' using errcode='22023'; end if;
    update public.computer_jobs set control_state='active',updated_at=now()
      where id=job.id returning * into job;
  else
    if job.control_state<>'paused' or job.phase<>'observing'
      or char_length(cmd.argument) not between 3 and 1000
      or cmd.argument<>trim(cmd.argument) then
      raise exception 'Pause the goal at a safe observation checkpoint before redirecting' using errcode='23514';
    end if;
    update public.computer_jobs set goal=cmd.argument,
      instruction_revision=instruction_revision+1, result='',evidence=null,updated_at=now()
      where id=job.id returning * into job;
  end if;
  return to_jsonb(job);
end;
$$;
revoke all on function public.computer_job_control(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.computer_job_control(uuid,uuid,uuid) to service_role;
