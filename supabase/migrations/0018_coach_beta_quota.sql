-- Beta quota (owner 2026-10-11): 100 Coach messages per member per WIB day instead of 20, and the attempts cap at
-- 3 times that (300). Same functions as 0017, only the two numbers change; grants carry over with create or replace.

create or replace function public.coach_begin(p_thread_id uuid, p_kind text, p_content text) returns uuid
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_start timestamptz;
  v_used integer;
  v_id uuid := gen_random_uuid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not exists (select 1 from public.coach_threads t where t.id = p_thread_id and t.user_id = v_uid) then
    raise exception 'thread' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('coach_begin:' || v_uid::text, 0));

  -- Start of today in Asia/Jakarta (WIB), the same day for every member.
  v_start := date_trunc('day', now() at time zone 'Asia/Jakarta') at time zone 'Asia/Jakarta';

  -- Counted from the append-only ledger, not from coach_messages (those go with a deleted thread).
  select count(*) into v_used
  from public.coach_usage u
  where u.user_id = v_uid
    and u.kind = 'message'
    and u.created_at >= v_start
    and (u.replied or u.created_at > now() - interval '2 minutes');
  if v_used >= 100 then
    raise exception 'quota' using errcode = 'P0001';
  end if;

  -- Attempts cap: every begin since 00:00 WIB, answered or not, expired or not. A member who aborts before the first
  -- text costs a paid model call that never counts above, so the attempts themselves are capped (3 times the quota).
  if (select count(*) from public.coach_usage u
      where u.user_id = v_uid and u.kind = 'message' and u.created_at >= v_start) >= 300 then
    raise exception 'quota' using errcode = 'P0001';
  end if;

  -- Both rows or neither (a check failure on the message, such as a blank text, rolls the ledger row back too).
  insert into public.coach_usage (id, kind, user_id) values (v_id, 'message', v_uid);
  insert into public.coach_messages (id, thread_id, user_id, role, kind, content)
    values (v_id, p_thread_id, v_uid, 'user', p_kind, p_content);
  return v_id;
end;
$$;

create or replace function public.coach_quota_remaining() returns integer
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_used integer;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select count(*) into v_used
  from public.coach_usage u
  where u.user_id = v_uid
    and u.kind = 'message'
    and u.created_at >= date_trunc('day', now() at time zone 'Asia/Jakarta') at time zone 'Asia/Jakarta'
    and (u.replied or u.created_at > now() - interval '2 minutes');
  return greatest(0, 100 - v_used);
end;
$$;
