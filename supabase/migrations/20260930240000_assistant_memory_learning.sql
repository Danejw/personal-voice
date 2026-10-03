-- Opt-in learning from saved Assistant user turns. Off until the account turns it on.
--
-- Only finalized user messages written after that moment are read. Voice notes
-- and dictation history are not read. A clear first-person statement can become
-- an active extracted memory. Anything uncertain stays a candidate and is not
-- sent to a new session. An explicit memory is never replaced. A forgotten key
-- is not learned again. The same message and extractor version is stored once.

alter table public.settings
  add column assistant_memory_learning boolean not null default false,
  add column assistant_learning_since timestamptz;

create function public.settings_touch_learning() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.assistant_memory_learning then
      new.assistant_learning_since := pg_catalog.now();
    end if;
    return new;
  end if;
  if new.assistant_memory_learning and old.assistant_memory_learning is distinct from true then
    new.assistant_learning_since := pg_catalog.now();
  end if;
  return new;
end;
$$;

create trigger settings_touch_learning
  before insert or update on public.settings
  for each row execute function public.settings_touch_learning();

alter table public.assistant_memories drop constraint assistant_memories_status_check;

alter table public.assistant_memories
  add constraint assistant_memories_status_check
  check (status in ('active', 'superseded', 'forgotten', 'candidate'));

alter table public.assistant_memories
  add column confidence text,
  add column category text,
  add column extractor_version text,
  alter column id set default gen_random_uuid(),
  add constraint assistant_memories_learning_chk check (
    (confidence is null or confidence in ('high', 'low'))
    and (category is null or category in ('preference', 'fact', 'project'))
    and (extractor_version is null or extractor_version ~ '^[a-z0-9-]{1,40}$')
  );

create table public.assistant_memory_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  message_id uuid not null,
  source_fingerprint text not null,
  extractor_version text not null,
  created_at timestamptz not null default now(),
  unique (message_id, source_fingerprint, extractor_version)
);

create index assistant_memory_jobs_user_idx
  on public.assistant_memory_jobs (user_id, message_id);

alter table public.assistant_memory_jobs enable row level security;

create policy "Users read their memory jobs"
  on public.assistant_memory_jobs
  for select
  to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.assistant_memory_jobs from anon, authenticated;
grant select on public.assistant_memory_jobs to authenticated;

create function public.assistant_learning_rejected(p_text text) returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  lower text := pg_catalog.lower(pg_catalog.btrim(p_text));
  marker text;
begin
  if lower is null or lower = '' then
    return true;
  end if;
  foreach marker in array array[
    'draft', 'hypothetically', 'what if', 'suppose', 'for example', 'if i ',
    'she said', 'he said', 'they said', 'my friend', 'email', 'tell them',
    'write to', 'say to', 'screenshot', 'camera photo', 'camera context'
  ]
  loop
    if pg_catalog.strpos(lower, marker) > 0 then
      return true;
    end if;
  end loop;
  if pg_catalog.strpos(p_text, chr(34)) > 0
    or pg_catalog.strpos(p_text, chr(8220)) > 0
    or pg_catalog.strpos(p_text, chr(8221)) > 0 then
    return true;
  end if;
  if lower ~ '(he|she|they) prefers' then
    return true;
  end if;
  return false;
end;
$$;

create function public.assistant_learning_scan(p_text text) returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  part text;
  found jsonb := '[]'::jsonb;
  seen text[] := array[]::text[];
  proposal jsonb;
  project_name text;
  loose text;
  loose_key text;
begin
  if p_text is null or pg_catalog.char_length(pg_catalog.btrim(p_text)) > 2000
    or public.assistant_learning_rejected(p_text) then
    return '[]'::jsonb;
  end if;
  for part in
    select pg_catalog.btrim(piece)
    from pg_catalog.regexp_split_to_table(pg_catalog.btrim(p_text), '[.!?]\s+') as piece
  loop
    proposal := null;
    if part ~* '^(please remember that )?i prefer short answers\.?$' then
      proposal := pg_catalog.jsonb_build_object(
        'key', 'answer_length', 'value', 'Prefer short answers.', 'kind', 'preference',
        'category', 'preference', 'confidence', 'high', 'disposition', 'active', 'evidence', part
      );
    elsif part ~* '^(please remember that )?i prefer (detailed|long) answers\.?$' then
      proposal := pg_catalog.jsonb_build_object(
        'key', 'answer_length', 'value', 'Prefer detailed answers.', 'kind', 'preference',
        'category', 'preference', 'confidence', 'high', 'disposition', 'active', 'evidence', part
      );
    elsif part ~* '^(please remember that )?my name is [A-Za-z][A-Za-z'' -]{0,40}\.?$' then
      proposal := pg_catalog.jsonb_build_object(
        'key', 'name',
        'value', pg_catalog.regexp_replace(pg_catalog.btrim(pg_catalog.regexp_replace(part, '^.*my name is ', '', 'i')), '[.?]$', ''),
        'kind', 'fact', 'category', 'fact', 'confidence', 'high', 'disposition', 'active', 'evidence', part
      );
    elsif part ~* '^(please remember that )?i( am|''m) working on [A-Za-z0-9][A-Za-z0-9'' -]{0,60}\.?$' then
      project_name := pg_catalog.regexp_replace(pg_catalog.regexp_replace(pg_catalog.btrim(pg_catalog.regexp_replace(part, '^.*working on ', '', 'i')), '^(the|a|an) ', '', 'i'), '[.?]$', '');
      if project_name <> '' then
      proposal := pg_catalog.jsonb_build_object(
        'key', 'project_' || pg_catalog.left(pg_catalog.regexp_replace(pg_catalog.lower(project_name), '[^a-z0-9]+', '_', 'g'), 48),
        'value', project_name, 'kind', 'fact', 'category', 'project',
        'confidence', 'high', 'disposition', 'active', 'evidence', part
      );
      end if;
    elsif part ~* '^(please remember that )?(i think|i might|maybe)\M'
      and part ~* 'prefer short answers'
      and part !~* '(he|she|they)' then
      proposal := pg_catalog.jsonb_build_object(
        'key', 'answer_length', 'value', 'Prefer short answers.', 'kind', 'preference',
        'category', 'preference', 'confidence', 'low', 'disposition', 'candidate', 'evidence', part
      );
    elsif part ~* '^i prefer [a-z][a-z ]{1,40}\.?$'
      and part !~* '^i prefer (short answers|detailed answers|long answers)\.?$' then
      loose := pg_catalog.btrim(pg_catalog.regexp_replace(part, '^i prefer |[.?]$', '', 'i'));
      loose_key := 'prefer_' || pg_catalog.left(pg_catalog.replace(loose, ' ', '_'), 40);
      if loose_key ~ '^[a-z][a-z0-9_]{0,63}$' then
        proposal := pg_catalog.jsonb_build_object(
          'key', loose_key, 'value', 'Prefers ' || loose || '.', 'kind', 'preference',
          'category', 'preference', 'confidence', 'low', 'disposition', 'candidate', 'evidence', part
        );
      end if;
    end if;
    if proposal is not null and not (proposal->>'key' = any (seen)) and pg_catalog.jsonb_array_length(found) < 3 then
      seen := seen || (proposal->>'key');
      found := found || pg_catalog.jsonb_build_array(proposal);
    end if;
  end loop;
  return found;
end;
$$;

create function public.list_assistant_learning_batch(p_user_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid;
begin
  uid := public.assistant_require_account(p_user_id);
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', m.id,
      'conversation_id', m.conversation_id,
      'body', m.body,
      'seq', m.seq
    ) order by m.created_at, m.id)
    from (
      select m.id, m.conversation_id, m.body, m.seq, m.created_at
      from public.assistant_messages m
      join public.assistant_conversations c on c.id = m.conversation_id
      join public.settings s on s.user_id = m.user_id
      where m.user_id = uid
        and m.role = 'user'
        and m.status = 'final'
        and c.deleted_at is null
        and s.assistant_memory_learning
        and s.assistant_learning_since is not null
        and m.created_at >= s.assistant_learning_since
        and not exists (
          select 1 from public.assistant_memory_jobs j
          where j.message_id = m.id
            and j.extractor_version = 'memory-learn-1'
            and j.source_fingerprint = pg_catalog.md5(pg_catalog.btrim(m.body))
        )
      order by m.created_at, m.id
      limit 8
    ) m
  ), '[]'::jsonb);
end;
$$;

create function public.commit_assistant_learning(p_user_id uuid, p_batch jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid;
  item jsonb;
  message_id uuid;
  evidence text;
  msg public.assistant_messages;
  conv_deleted timestamptz;
  learning boolean;
  learning_since timestamptz;
  fingerprint text;
  proposals jsonb;
  proposal jsonb;
  active public.assistant_memories;
  active_found boolean;
  disposition text;
  next_revision bigint;
  applied text[] := array[]::text[];
begin
  uid := public.assistant_require_account(p_user_id);
  if p_batch is null or pg_catalog.jsonb_typeof(p_batch) is distinct from 'array'
    or pg_catalog.jsonb_array_length(p_batch) > 8 then
    raise exception 'ASSISTANT_MEMORY_REJECTED' using errcode = '23514';
  end if;
  for item in select value from pg_catalog.jsonb_array_elements(p_batch) loop
    message_id := (item->>'id')::uuid;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('learn:' || message_id::text));
    select m.* into msg
    from public.assistant_messages m
    where m.id = message_id and m.user_id = uid and m.role = 'user' and m.status = 'final';
    if not found then
      continue;
    end if;
    select c.deleted_at, s.assistant_memory_learning, s.assistant_learning_since
      into conv_deleted, learning, learning_since
    from public.assistant_conversations c
    join public.settings s on s.user_id = uid
    where c.id = msg.conversation_id and c.user_id = uid;
    fingerprint := pg_catalog.md5(pg_catalog.btrim(msg.body));
    if exists (
      select 1 from public.assistant_memory_jobs j
      where j.message_id = msg.id and j.source_fingerprint = fingerprint and j.extractor_version = 'memory-learn-1'
    ) then
      continue;
    end if;
      if conv_deleted is not null or learning is distinct from true or learning_since is null
      or msg.created_at < learning_since or public.assistant_learning_rejected(msg.body) then
      insert into public.assistant_memory_jobs (user_id, message_id, source_fingerprint, extractor_version)
      values (uid, msg.id, fingerprint, 'memory-learn-1')
      on conflict (message_id, source_fingerprint, extractor_version) do nothing;
      continue;
    end if;
    proposals := public.assistant_learning_scan(msg.body);
    if item ? 'evidences' and pg_catalog.jsonb_typeof(item->'evidences') = 'array' then
      for evidence in select value from pg_catalog.jsonb_array_elements_text(item->'evidences') loop
        if pg_catalog.char_length(evidence) between 1 and 500
          and pg_catalog.strpos(msg.body, evidence) > 0
          and not public.assistant_learning_rejected(evidence) then
          proposals := proposals || public.assistant_learning_scan(evidence);
        end if;
      end loop;
    end if;
    for proposal in select value from pg_catalog.jsonb_array_elements(proposals) loop
      select * into active
      from public.assistant_memories
      where user_id = uid and memory_key = proposal->>'key' and status = 'active'
      for update;
      active_found := found;
      if proposal->>'key' = any (applied) then
        continue;
      end if;
      applied := applied || (proposal->>'key');
      disposition := proposal->>'disposition';
      if exists (
        select 1 from public.assistant_memories
        where user_id = uid and memory_key = proposal->>'key' and status = 'forgotten'
      ) then
        continue;
      end if;
      if active_found and active.value = proposal->>'value' then
        continue;
      end if;
      if active_found and active.origin = 'explicit' then
        disposition := 'candidate';
      end if;
      next_revision := case when active_found then active.revision + 1 else 1 end;
      if active_found and active.origin = 'extracted' and disposition = 'active' then
        update public.assistant_memories set status = 'superseded' where id = active.id;
      end if;
      if disposition = 'candidate' or not active_found or (active_found and active.origin = 'extracted') then
        insert into public.assistant_memories (
          user_id, kind, memory_key, value, scope, status, origin,
          source_conversation_id, source_message_id, revision,
          confidence, category, extractor_version
        ) values (
          uid, proposal->>'kind', proposal->>'key', proposal->>'value',
          'account', case when disposition = 'active' then 'active' else 'candidate' end, 'extracted',
          msg.conversation_id, msg.id, next_revision,
          proposal->>'confidence', proposal->>'category', 'memory-learn-1'
        );
      end if;
    end loop;
    insert into public.assistant_memory_jobs (user_id, message_id, source_fingerprint, extractor_version)
    values (uid, msg.id, fingerprint, 'memory-learn-1')
    on conflict (message_id, source_fingerprint, extractor_version) do nothing;
  end loop;
  return public.list_assistant_memories(uid);
end;
$$;

create function public.settle_assistant_memory_candidate(
  p_user_id uuid,
  p_id uuid,
  p_keep boolean
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid;
  row public.assistant_memories;
  active public.assistant_memories;
begin
  uid := public.assistant_require_account(p_user_id);
  if p_keep is null then
    raise exception 'ASSISTANT_MEMORY_REJECTED' using errcode = '23514';
  end if;
  select * into row
  from public.assistant_memories
  where id = p_id and user_id = uid and status = 'candidate'
  for update;
  if not found then
    raise exception 'ASSISTANT_MEMORY_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not p_keep then
    update public.assistant_memories
      set status = 'forgotten', forgotten_at = pg_catalog.now(), revision = revision + 1
      where id = row.id;
    return public.list_assistant_memories(uid);
  end if;
  select * into active
  from public.assistant_memories
  where user_id = uid and memory_key = row.memory_key and status = 'active'
  for update;
  if found and active.origin = 'explicit' then
    update public.assistant_memories set status = 'superseded' where id = row.id;
    return public.list_assistant_memories(uid);
  end if;
  if found and active.origin = 'extracted' then
    update public.assistant_memories set status = 'superseded' where id = active.id;
  end if;
  update public.assistant_memories
    set status = 'active', origin = 'explicit', revision = revision + 1
    where id = row.id;
  return public.list_assistant_memories(uid);
end;
$$;

revoke all on function public.assistant_learning_rejected(text) from public, anon, authenticated;
revoke all on function public.assistant_learning_scan(text) from public, anon, authenticated;
revoke all on function public.settings_touch_learning() from public, anon, authenticated;

revoke all on function public.list_assistant_learning_batch(uuid) from public, anon;
revoke all on function public.commit_assistant_learning(uuid, jsonb) from public, anon;
revoke all on function public.settle_assistant_memory_candidate(uuid, uuid, boolean) from public, anon;

grant execute on function public.list_assistant_learning_batch(uuid) to authenticated;
grant execute on function public.commit_assistant_learning(uuid, jsonb) to authenticated;
grant execute on function public.settle_assistant_memory_candidate(uuid, uuid, boolean) to authenticated;
