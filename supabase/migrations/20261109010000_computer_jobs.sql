-- PR 2: one owner-readable job record per remote goal, no second event stream.
-- Only the native Windows identity can mutate jobs through device-pairing and this
-- service-role-only RPC. Phone account credentials have SELECT but no write grant.
create table public.computer_jobs (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  requester_device_id uuid not null references public.devices(id) on delete cascade,
  target_device_id uuid not null references public.devices(id) on delete cascade,
  goal text not null check (char_length(goal) between 3 and 1000),
  status text not null default 'pending_ack' check (status in (
    'pending_ack','running','completed','needs_review','blocked','failed','stopped','interrupted'
  )),
  phase text not null default 'observing' check (phase in ('observing','applying','verifying','done')),
  steps integer not null default 0 check (steps between 0 and 240),
  last_action text not null default '' check (char_length(last_action) <= 40),
  result text not null default '' check (char_length(result) <= 1000),
  evidence text check (char_length(evidence) <= 500),
  worker_token uuid,
  lease_until timestamptz,
  heartbeat_at timestamptz,
  stop_requested_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index computer_jobs_active_pc on public.computer_jobs(target_device_id)
  where status in ('pending_ack','running');
create index computer_jobs_latest on public.computer_jobs(user_id,target_device_id,created_at desc);
alter table public.computer_jobs enable row level security;
revoke all on public.computer_jobs from public,anon,authenticated;
grant select on public.computer_jobs to authenticated;
create policy computer_jobs_read on public.computer_jobs for select to authenticated
  using (user_id = (select auth.uid()));

-- Called exclusively after the device-pairing Edge Function verifies a fresh
-- signed Windows-device payload and the user's account. No generic client writes.
create function public.computer_job_mutate(
  p_user_id uuid, p_pc_id uuid, p_args jsonb
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  event_name text := p_args->>'event';
  job_id uuid;
  token uuid;
  job public.computer_jobs;
  req public.device_action_requests;
  next_status text;
  next_phase text;
  next_steps integer;
  next_action text;
  next_result text;
  next_evidence text;
  paired boolean;
begin
  if not exists (select 1 from public.devices d
    where d.id=p_pc_id and d.user_id=p_user_id and d.platform='windows') then
    raise exception 'Computer job device is invalid' using errcode='42501';
  end if;
  if event_name = 'reconcile' then
    -- This action is called only once at Windows app startup, not on every poll.
    select * into job from public.computer_jobs
    where user_id=p_user_id and target_device_id=p_pc_id
      and status in ('pending_ack','running')
    order by created_at desc limit 1 for update;
    if not found then return null; end if;
    select exists(select 1 from public.device_pair_links l
      where l.user_id=p_user_id and l.revoked_at is null
        and l.left_device_id=least(p_pc_id,job.requester_device_id)
        and l.right_device_id=greatest(p_pc_id,job.requester_device_id)) into paired;
    if job.status='running' and job.steps=0 and job.phase='observing'
       and p_args->>'canResume'='true' and paired
       and job.stop_requested_at is null then
      update public.computer_jobs
        set worker_token=pg_catalog.gen_random_uuid(), lease_until=now()+interval '90 seconds',
            heartbeat_at=now(), updated_at=now()
        where id=job.id returning * into job;
      return pg_catalog.jsonb_build_object('resumed',true,'job',to_jsonb(job));
    end if;
    update public.computer_jobs set
      status=case when job.stop_requested_at is not null then 'stopped'
        when job.phase='applying' then 'needs_review' else 'interrupted' end,
      phase='done', worker_token=null, lease_until=null, updated_at=now(),
      result=case when job.stop_requested_at is not null then
        'The task was stopped before Windows restarted. No actions were replayed.'
        when job.phase='applying' then
        'Windows restarted during an action. Its outcome is unknown. Inspect the desktop before resuming.'
        when job.status='pending_ack' then
        'Windows restarted before acknowledging the goal. No desktop actions were started.'
        else 'Windows restarted. Inspect the current desktop before continuing; actions were not replayed.' end
    where id=job.id returning * into job;
    return pg_catalog.jsonb_build_object('resumed',false,'job',to_jsonb(job));
  end if;
  if p_args->>'requestId' is null or p_args->>'requestId' !~
    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    raise exception 'Invalid job ID' using errcode='22023';
  end if;
  job_id := (p_args->>'requestId')::uuid;
  if event_name='create' then
    select r.* into req from public.device_action_requests r
      join public.device_auto_action_claims c on c.request_id=r.id
      where r.id=job_id and r.user_id=p_user_id and r.target_device_id=p_pc_id
        and c.user_id=p_user_id and c.pc_device_id=p_pc_id
        and r.action='start_computer_goal' and r.status='pending'
        and r.version=2 and r.expires_at>now()
      for update of r;
    if not found then raise exception 'Original signed goal is not claimable' using errcode='42501'; end if;
    if not exists(select 1 from public.device_pair_links l
      where l.user_id=p_user_id and l.revoked_at is null
        and l.left_device_id=least(p_pc_id,req.requester_device_id)
        and l.right_device_id=greatest(p_pc_id,req.requester_device_id)) then
      raise exception 'Pairing revoked' using errcode='42501';
    end if;
    insert into public.computer_jobs(id,user_id,requester_device_id,target_device_id,goal)
      values(job_id,p_user_id,req.requester_device_id,p_pc_id,req.argument)
      on conflict (id) do nothing;
    select * into job from public.computer_jobs
      where id=job_id and user_id=p_user_id and target_device_id=p_pc_id;
    if job.status <> 'pending_ack' then
      raise exception 'Goal already started' using errcode='23514';
    end if;
    return to_jsonb(job);
  end if;
  select * into job from public.computer_jobs
    where id=job_id and user_id=p_user_id and target_device_id=p_pc_id for update;
  if not found then raise exception 'Computer job not found' using errcode='22023'; end if;
  select exists(select 1 from public.device_pair_links l
    where l.user_id=p_user_id and l.revoked_at is null
      and l.left_device_id=least(p_pc_id,job.requester_device_id)
      and l.right_device_id=greatest(p_pc_id,job.requester_device_id)) into paired;
  if not paired then raise exception 'Pairing revoked' using errcode='42501'; end if;
  if event_name='cancel_pending' then
    if job.status<>'pending_ack' then raise exception 'Goal already started' using errcode='23514'; end if;
    update public.computer_jobs set status='stopped',phase='done',
      result='The goal was not acknowledged on Windows.',updated_at=now()
      where id=job_id returning * into job;
    return to_jsonb(job);
  end if;
  if event_name='activate' then
    if job.status<>'pending_ack' then raise exception 'Goal already active' using errcode='23514'; end if;
    update public.computer_jobs set status='running',phase='observing',
      worker_token=pg_catalog.gen_random_uuid(),lease_until=now()+interval '90 seconds',
      heartbeat_at=now(),updated_at=now() where id=job_id returning * into job;
    return to_jsonb(job);
  end if;
  if p_args->>'token' is null or p_args->>'token' !~
    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    raise exception 'Missing worker lease' using errcode='42501';
  end if;
  token := (p_args->>'token')::uuid;
  if job.status<>'running' or job.worker_token is distinct from token
      or job.lease_until <= now() then
    raise exception 'Worker lease revoked or expired' using errcode='42501';
  end if;
  if event_name='request_stop' then
    update public.computer_jobs set stop_requested_at=coalesce(stop_requested_at,now()),
      updated_at=now() where id=job_id returning * into job;
    return to_jsonb(job);
  end if;
  if event_name='heartbeat' then
    update public.computer_jobs set heartbeat_at=now(),
      lease_until=now()+interval '90 seconds',updated_at=now()
      where id=job_id returning * into job;
    return to_jsonb(job);
  end if;
  if event_name<>'checkpoint' then raise exception 'Unknown job event' using errcode='22023'; end if;
  next_status := p_args->>'status';
  next_phase := p_args->>'phase';
  if next_status not in ('running','completed','needs_review','blocked','failed','stopped','interrupted')
      or next_phase not in ('observing','applying','verifying','done')
      or p_args->>'steps' !~ '^[0-9]{1,3}$' then
    raise exception 'Invalid checkpoint' using errcode='23514';
  end if;
  next_steps := (p_args->>'steps')::integer;
  next_action := coalesce(p_args->>'lastAction','');
  next_result := coalesce(p_args->>'result','');
  next_evidence := nullif(p_args->>'evidence','');
  if next_steps < job.steps or next_steps>240
      or pg_catalog.char_length(next_action)>40 or pg_catalog.char_length(next_result)>1000
      or pg_catalog.char_length(coalesce(next_evidence,''))>500
      or (next_status='completed' and pg_catalog.char_length(coalesce(next_evidence,''))<12)
      or (next_status<>'running' and next_phase<>'done')
      or (next_status='running' and next_phase='done')
      or (next_phase='applying' and next_steps<>job.steps)
      or (next_status='running' and next_steps>job.steps+1)
      or (next_steps>job.steps and job.phase<>'applying') then
    raise exception 'Unsafe checkpoint' using errcode='23514';
  end if;
  update public.computer_jobs set
    status=next_status, phase=next_phase, steps=next_steps,
    last_action=next_action, result=next_result, evidence=next_evidence,
    worker_token=case when next_status='running' then token else null end,
    lease_until=case when next_status='running' then now()+interval '90 seconds' else null end,
    heartbeat_at=now(),updated_at=now()
  where id=job_id returning * into job;
  return to_jsonb(job);
end;
$$;
revoke all on function public.computer_job_mutate(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.computer_job_mutate(uuid,uuid,jsonb) to service_role;
