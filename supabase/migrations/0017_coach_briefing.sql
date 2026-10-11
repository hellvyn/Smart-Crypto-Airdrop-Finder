-- Coach and Briefing (Plan 9, Task 3; spec docs/superpowers/specs/2026-10-11-coach-briefing-design.md §4.4).
-- Every Coach and Briefing surface is member-only: RLS is on for every table, the web roles start from nothing
-- (revoke all) and get only what is granted below, and anon gets no table and no function. A "member" is any signed-in
-- account (auth.uid() is not null): accounts are created by an admin (0007), and every other member-only surface
-- (farming, 0010; results, 0015; the curated list, 0012) gates on the same predicate.
-- This migration uses only create, grant and revoke: no DROP and no mass UPDATE.
--
-- Quota: 20 user messages per member per day, reset at 00:00 WIB (Asia/Jakarta) for every member, whatever their
-- profiles.timezone (owner decision: one fixed day, so switching timezone cannot reopen the quota).
-- A user message counts while it has a reply, or while it is less than 2 minutes old. A message the model
-- failed to answer therefore stops counting after 2 minutes by itself, and no "give the slot back" RPC exists that
-- could be abused.
-- The quota (and the daily thread cap) is counted from the append-only coach_usage table, not from the threads and
-- messages: a member can delete their own threads (and with them their messages), and that must not give slots back.

-- ---------- coach_profiles: one row per member, owner-only ----------
-- Chains: at most 10, each at most 40 characters and not null. A CHECK cannot hold a subquery, so the per-item test is
-- an immutable helper; the check function runs with the caller's rights, hence the execute grant to authenticated.
create function public.coach_chains_ok(p_chains text[]) returns boolean
  language sql
  immutable
  set search_path = ''
as $$
  select coalesce(
    cardinality(p_chains) <= 10
    and not exists (select 1 from unnest(p_chains) c where c is null or char_length(c) > 40),
    false);
$$;
revoke execute on function public.coach_chains_ok(text[]) from public, anon;
grant execute on function public.coach_chains_ok(text[]) to authenticated;

create table coach_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  level text not null check (level in ('beginner', 'intermediate', 'pro')),
  capital_band text not null check (capital_band in ('free', 'gas_only', 'up_to_100', 'up_to_1000', 'over_1000')),
  -- 1 to 10, and null exactly when the member has no wallet yet (the form asks for it only when has_wallet).
  wallet_count integer check (wallet_count between 1 and 10),
  has_wallet boolean not null,
  minutes_per_day integer not null check (minutes_per_day in (15, 30, 60, 120)),
  goal text not null check (goal in ('quick', 'long_term', 'learn')),
  chains text[] not null default '{}' check (public.coach_chains_ok(chains)),
  updated_at timestamptz not null default now(),
  check (has_wallet = (wallet_count is not null))
);

alter table coach_profiles enable row level security;
revoke all on coach_profiles from anon, authenticated;
grant select, delete on coach_profiles to authenticated;
grant insert (user_id, level, capital_band, wallet_count, has_wallet, minutes_per_day, goal, chains)
  on coach_profiles to authenticated;
-- updated_at is the server's. user_id is in the UPDATE grant only so that supabase-js .upsert() (INSERT ... ON CONFLICT
-- DO UPDATE SET user_id = excluded.user_id, ...) works; the update policy's WITH CHECK keeps user_id = auth.uid(), so a
-- profile still cannot move to another member.
grant update (user_id, level, capital_band, wallet_count, has_wallet, minutes_per_day, goal, chains)
  on coach_profiles to authenticated;

create policy "own coach profile read" on coach_profiles for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own coach profile insert" on coach_profiles for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "own coach profile update" on coach_profiles for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy "own coach profile delete" on coach_profiles for delete to authenticated
  using (user_id = (select auth.uid()));

create function public.stamp_coach_profile_updated_at() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function public.stamp_coach_profile_updated_at() from public, anon, authenticated;

create trigger coach_profiles_updated_at
  before insert or update on coach_profiles
  for each row execute function public.stamp_coach_profile_updated_at();

-- ---------- coach_threads: select and delete for the owner; rows are created by coach_new_thread ----------
create table coach_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Null, or the project opened through "Tanya AI". A thread about a project goes with the project.
  project_id uuid references projects (id) on delete cascade,
  -- The validated plan; null for a thread without a plan. Written by coach_save_plan.
  plan jsonb check (plan is null or jsonb_typeof(plan) = 'object'),
  created_at timestamptz not null default now()
);
create index coach_threads_user_created_idx on coach_threads (user_id, created_at desc);
create index coach_threads_created_idx on coach_threads (created_at);
create index coach_threads_project_id_idx on coach_threads (project_id);

alter table coach_threads enable row level security;
revoke all on coach_threads from anon, authenticated;
grant select, delete on coach_threads to authenticated;

create policy "own coach threads read" on coach_threads for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own coach threads delete" on coach_threads for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------- coach_messages: select only for the owner; rows are written by coach_begin and coach_finish ----------
create table coach_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references coach_threads (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  kind text not null check (kind in ('plan', 'chat', 'explain_step')),
  -- Not blank; a member's message at most 4000 characters, the model's reply at most 16000.
  content text not null check (
    char_length(btrim(content, E' \t\r\n')) > 0
    and char_length(content) <= case role when 'user' then 4000 else 16000 end),
  model text,
  input_tokens integer check (input_tokens >= 0),
  output_tokens integer check (output_tokens >= 0),
  cache_read_tokens integer check (cache_read_tokens >= 0),
  cache_creation_tokens integer check (cache_creation_tokens >= 0),
  -- Not in the spec's column list, but "a user message that has a reply" (the quota) needs the link: an assistant
  -- message names the user message it answers, at most once (unique), and a user message names nothing.
  reply_to uuid unique references coach_messages (id) on delete cascade,
  created_at timestamptz not null default now(),
  check ((role = 'user') = (reply_to is null))
);
create index coach_messages_thread_created_idx on coach_messages (thread_id, created_at);
-- The quota count: one member's user messages since the start of their day.
create index coach_messages_user_quota_idx on coach_messages (user_id, created_at) where role = 'user';

alter table coach_messages enable row level security;
revoke all on coach_messages from anon, authenticated;
grant select on coach_messages to authenticated;

create policy "own coach messages read" on coach_messages for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------- coach_usage: the append-only ledger the quota and the thread cap are counted from ----------
-- One row per coach_begin (kind 'message', id = the user message's id) and per coach_new_thread (kind 'thread', id =
-- the thread's id). No foreign key to threads or messages, so deleting a thread or a message never removes a row; rows
-- go only with the member (auth.users cascade) or by the pipeline's purge (rows older than 2 days; Plan 9 Task 8).
-- `replied` ("this message counts for good") is true once coach_finish answered the message, once coach_mark_used
-- marked it (the model has started to answer), and once a user message still inside its 2 minutes was deleted without
-- an answer (trigger below), so deleting a thread mid-answer does not hand the slot back after 2 minutes either.
-- Security definer functions and the service role only: RLS is on with no policy, and the web roles have no grant.
create table coach_usage (
  id uuid primary key,
  kind text not null check (kind in ('message', 'thread')),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  replied boolean not null default false
);
create index coach_usage_user_kind_created_idx on coach_usage (user_id, kind, created_at);
create index coach_usage_created_idx on coach_usage (created_at);

alter table coach_usage enable row level security;
revoke all on coach_usage from anon, authenticated;

-- A user message deleted while it is still inside its 2 minutes and unanswered (its thread was deleted mid-answer) keeps
-- counting for good. One that already failed (older than 2 minutes, unmarked) stays uncounted. Nothing is updated when
-- the member themselves is being deleted (their ledger rows go with them, and an update there can violate the FK).
create function public.keep_coach_usage_on_delete() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if old.role = 'user' then
    update public.coach_usage set replied = true
      where id = old.id
        and not replied
        and created_at > now() - interval '2 minutes'
        and exists (select 1 from auth.users au where au.id = old.user_id);
  end if;
  return old;
end;
$$;
revoke execute on function public.keep_coach_usage_on_delete() from public, anon, authenticated;

create trigger coach_messages_keep_usage
  before delete on coach_messages
  for each row execute function public.keep_coach_usage_on_delete();

-- ---------- briefings: members read, the pipeline (service role) writes ----------
create table briefings (
  day date primary key,
  items jsonb not null check (jsonb_typeof(items) = 'array'),
  model text,
  -- False for the version made without the AI.
  ai boolean not null,
  created_at timestamptz not null default now()
);
create index briefings_created_idx on briefings (created_at);

alter table briefings enable row level security;
revoke all on briefings from anon, authenticated;
grant select on briefings to authenticated;

create policy "members read briefings" on briefings for select to authenticated
  using (true);

-- ---------- RPCs (security definer, empty search_path, execute for authenticated only) ----------

-- A new thread for the caller, about a project or not. At most 50 a WIB day (counted from coach_usage, which survives
-- deleting threads), so a member cannot fill the table by calling this in a loop (the purge step removes threads after
-- 30 days).
create function public.coach_new_thread(p_project_id uuid) returns uuid
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid;
  v_start timestamptz := date_trunc('day', now() at time zone 'Asia/Jakarta') at time zone 'Asia/Jakarta';
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('coach_new_thread:' || v_uid::text, 0));
  -- Counted from coach_usage, so deleting threads does not reset it; the day is the WIB day, like the messages.
  if (select count(*) from public.coach_usage u
      where u.user_id = v_uid and u.kind = 'thread' and u.created_at >= v_start) >= 50 then
    raise exception 'threads' using errcode = 'P0001';
  end if;
  insert into public.coach_threads (user_id, project_id) values (v_uid, p_project_id) returning id into v_id;
  insert into public.coach_usage (id, kind, user_id) values (v_id, 'thread', v_uid);
  return v_id;
end;
$$;
revoke execute on function public.coach_new_thread(uuid) from public, anon;
grant execute on function public.coach_new_thread(uuid) to authenticated;

-- Count the quota and insert the caller's user message, returning its id. P0001 'thread' for a thread that is not the
-- caller's (or does not exist), P0001 'quota' at the 21st counted message of the day.
-- The advisory lock on the caller serialises concurrent calls: the second waits for the first to commit, and then
-- counts it (each statement of a READ COMMITTED function takes its own snapshot), so one free slot goes to exactly one
-- of two simultaneous calls.
create function public.coach_begin(p_thread_id uuid, p_kind text, p_content text) returns uuid
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
  if v_used >= 20 then
    raise exception 'quota' using errcode = 'P0001';
  end if;

  -- Attempts cap: every begin since 00:00 WIB, answered or not, expired or not. A member who aborts before the first
  -- text costs a paid model call that never counts above, so the attempts themselves are capped (3 times the quota).
  if (select count(*) from public.coach_usage u
      where u.user_id = v_uid and u.kind = 'message' and u.created_at >= v_start) >= 60 then
    raise exception 'quota' using errcode = 'P0001';
  end if;

  -- Both rows or neither (a check failure on the message, such as a blank text, rolls the ledger row back too).
  insert into public.coach_usage (id, kind, user_id) values (v_id, 'message', v_uid);
  insert into public.coach_messages (id, thread_id, user_id, role, kind, content)
    values (v_id, p_thread_id, v_uid, 'user', p_kind, p_content);
  return v_id;
end;
$$;
revoke execute on function public.coach_begin(uuid, text, text) from public, anon;
grant execute on function public.coach_begin(uuid, text, text) to authenticated;

-- Insert the reply to one of the caller's own unanswered user messages, in its thread and of its kind, and return the
-- reply's id. P0001 'message' for a message that is not the caller's user message (or does not exist), P0001
-- 'replied' for one that already has a reply, P0001 'expired' for one whose 2 minutes ran out without a reply or a
-- coach_mark_used. A member could call this directly to write a made-up "reply" in their
-- own thread; that touches only their own data and adds no quota, so it is accepted (spec §4.4).
create function public.coach_finish(
  p_user_message_id uuid,
  p_content text,
  p_model text,
  p_in integer,
  p_out integer,
  p_cache_read integer,
  p_cache_write integer
) returns uuid
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_thread uuid;
  v_kind text;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  -- The row lock makes two simultaneous replies to the same message take turns (reply_to is unique as well).
  select m.thread_id, m.kind into v_thread, v_kind
  from public.coach_messages m
  where m.id = p_user_message_id and m.user_id = v_uid and m.role = 'user'
  for update;
  if not found then
    raise exception 'message' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.coach_messages r where r.reply_to = p_user_message_id) then
    raise exception 'replied' using errcode = 'P0001';
  end if;
  -- A message whose 2 minutes ran out unmarked has stopped counting; answering it now would bring it back into the
  -- day's count. (A message coach_mark_used marked is replied, so it can still be answered.)
  if exists (select 1 from public.coach_usage u
             where u.id = p_user_message_id and not u.replied and u.created_at <= now() - interval '2 minutes') then
    raise exception 'expired' using errcode = 'P0001';
  end if;
  insert into public.coach_messages
    (thread_id, user_id, role, kind, content, model, input_tokens, output_tokens, cache_read_tokens,
     cache_creation_tokens, reply_to)
    values (v_thread, v_uid, 'assistant', v_kind, p_content, p_model, p_in, p_out, p_cache_read, p_cache_write,
            p_user_message_id)
    returning id into v_id;
  update public.coach_usage set replied = true where id = p_user_message_id;
  return v_id;
end;
$$;
revoke execute on function public.coach_finish(uuid, text, text, integer, integer, integer, integer) from public, anon;
grant execute on function public.coach_finish(uuid, text, text, integer, integer, integer, integer) to authenticated;

-- The web calls this when the model's first text arrives, before forwarding any of it: from then on the message counts
-- for good, whatever happens next (the member aborts, the model stops at max_tokens, the reply is too long for
-- coach_finish, the route times out). Only sets coach_usage.replied; idempotent. P0001 'message' for a message that is
-- not the caller's user message (or has no ledger row). P0001 'expired' for a message whose 2 minutes ran out unmarked:
-- it has stopped counting, and marking it now would bring it back into the day's count (re-review 2), so the web must
-- not forward the answer. Only rows that still count can be marked, so this cannot race coach_begin's count.
create function public.coach_mark_used(p_user_message_id uuid) returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  update public.coach_usage set replied = true
    where id = p_user_message_id and user_id = v_uid and kind = 'message'
      and (replied or created_at > now() - interval '2 minutes');
  if not found then
    if exists (select 1 from public.coach_usage u
               where u.id = p_user_message_id and u.user_id = v_uid and u.kind = 'message') then
      raise exception 'expired' using errcode = 'P0001';
    end if;
    raise exception 'message' using errcode = 'P0001';
  end if;
end;
$$;
revoke execute on function public.coach_mark_used(uuid) from public, anon;
grant execute on function public.coach_mark_used(uuid) to authenticated;

-- How many of today's 20 messages (WIB day) the caller has left, counted from the same ledger coach_begin uses, so the
-- page never shows more than coach_begin will allow (a deleted thread takes its coach_messages along, not its usage).
create function public.coach_quota_remaining() returns integer
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
  return greatest(0, 20 - v_used);
end;
$$;
revoke execute on function public.coach_quota_remaining() from public, anon;
grant execute on function public.coach_quota_remaining() to authenticated;

-- Store the server-validated plan on the caller's thread. P0001 'thread' for a thread that is not the caller's. The
-- plan must be a JSON object of at most 100,000 characters (the server validates its content; this bounds what a
-- member who calls the RPC directly can store).
create function public.coach_save_plan(p_thread_id uuid, p_plan jsonb) returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_plan is null or jsonb_typeof(p_plan) <> 'object' or length(p_plan::text) > 100000 then
    raise exception 'invalid plan' using errcode = '22023';
  end if;
  update public.coach_threads t set plan = p_plan where t.id = p_thread_id and t.user_id = v_uid;
  if not found then
    raise exception 'thread' using errcode = 'P0001';
  end if;
end;
$$;
revoke execute on function public.coach_save_plan(uuid, jsonb) from public, anon;
grant execute on function public.coach_save_plan(uuid, jsonb) to authenticated;
