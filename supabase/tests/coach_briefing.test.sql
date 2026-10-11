-- pgTAP tests for 0017_coach_briefing.sql (Plan 9 Task 3; coach-briefing spec §4.4, §10): the Coach tables, the quota
-- RPCs and briefings. Everything is member-only: anon holds no privilege on any new table or function. A member reads
-- and deletes only their own threads and messages and never writes a message directly; the RPCs do, and count 20 user
-- messages a day (a day is 00:00 to 24:00 WIB, Asia/Jakarta, for everyone). A user message counts
-- while it has a reply, or while it is less than 2 minutes old. Briefings are read-only for members.
-- The two-connection race on the last slot is in apps/web/test/coach-quota.int.test.ts (a pgTAP file is one transaction).

-- Fixtures sit up to 3 minutes in the past and must fall on today's WIB date. In the first 5 minutes of a WIB day they
-- would land on yesterday, so wait until 00:05 WIB first. Before `begin`: now() is fixed when the transaction starts.
do $$
declare
  v_since_midnight interval := (clock_timestamp() at time zone 'Asia/Jakarta')
    - date_trunc('day', clock_timestamp() at time zone 'Asia/Jakarta');
begin
  if v_since_midnight < interval '5 minutes' then
    perform pg_sleep(extract(epoch from interval '5 minutes' - v_since_midnight) + 1);
  end if;
end
$$;

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(129);

-- Fixtures (run as the migration/test owner role, which bypasses RLS).
-- A: ca.., B: cb.. (the other member), C: default timezone, D: Pacific/Kiritimati, E: Pacific/Pago_Pago,
-- F: backdated unanswered messages, G: counting with a reply.
insert into auth.users (id, email) values
  ('ca000000-0000-4000-8000-00000000000a', 'coach-a@example.test'),
  ('cb000000-0000-4000-8000-00000000000b', 'coach-b@example.test'),
  ('cc000000-0000-4000-8000-00000000000c', 'coach-c@example.test'),
  ('cd000000-0000-4000-8000-00000000000d', 'coach-d@example.test'),
  ('ce000000-0000-4000-8000-00000000000e', 'coach-e@example.test'),
  ('cf000000-0000-4000-8000-00000000000f', 'coach-f@example.test'),
  ('c0000000-0000-4000-8000-000000000001', 'coach-g@example.test'),
  ('c1000000-0000-4000-8000-000000000001', 'coach-h@example.test'),
  ('c2000000-0000-4000-8000-000000000001', 'coach-i@example.test'),
  ('c3000000-0000-4000-8000-000000000001', 'coach-k@example.test'),
  ('c4000000-0000-4000-8000-000000000001', 'coach-l@example.test'),
  ('c5000000-0000-4000-8000-000000000001', 'coach-m@example.test'),
  ('c6000000-0000-4000-8000-000000000001', 'coach-n@example.test'),
  ('c7000000-0000-4000-8000-000000000001', 'coach-o@example.test');

insert into projects (id, slug, name, name_key, status, chains, first_seen, last_seen) values
  ('ca100000-0000-4000-8000-000000000001', 'coach-proj', 'Coach Proj', 'coachproj', 'live', '{}', now(), now());

update profiles set timezone = 'Pacific/Kiritimati' where user_id = 'cd000000-0000-4000-8000-00000000000d';
update profiles set timezone = 'Pacific/Pago_Pago' where user_id = 'ce000000-0000-4000-8000-00000000000e';

insert into coach_threads (id, user_id, project_id) values
  ('ca200000-0000-4000-8000-0000000000a1', 'ca000000-0000-4000-8000-00000000000a', null),
  ('cb200000-0000-4000-8000-0000000000b1', 'cb000000-0000-4000-8000-00000000000b', null),
  ('cc200000-0000-4000-8000-0000000000c1', 'cc000000-0000-4000-8000-00000000000c', null),
  ('cd200000-0000-4000-8000-0000000000d1', 'cd000000-0000-4000-8000-00000000000d', null),
  ('ce200000-0000-4000-8000-0000000000e1', 'ce000000-0000-4000-8000-00000000000e', null),
  ('cf200000-0000-4000-8000-0000000000f1', 'cf000000-0000-4000-8000-00000000000f', null),
  ('c0200000-0000-4000-8000-0000000000f2', 'c0000000-0000-4000-8000-000000000001', null),
  ('c3200000-0000-4000-8000-0000000000f3', 'c3000000-0000-4000-8000-000000000001', null),
  ('c4200000-0000-4000-8000-0000000000f4', 'c4000000-0000-4000-8000-000000000001', null),
  ('c5200000-0000-4000-8000-0000000000f5', 'c5000000-0000-4000-8000-000000000001', null),
  ('c6200000-0000-4000-8000-0000000000f6', 'c6000000-0000-4000-8000-000000000001', null);

-- B's message and its reply (A must never see them).
insert into coach_messages (id, thread_id, user_id, role, kind, content, created_at) values
  ('cb300000-0000-4000-8000-0000000000b1', 'cb200000-0000-4000-8000-0000000000b1',
   'cb000000-0000-4000-8000-00000000000b', 'user', 'chat', 'pesan B', now() - interval '1 hour');
insert into coach_messages (thread_id, user_id, role, kind, content, reply_to, created_at) values
  ('cb200000-0000-4000-8000-0000000000b1', 'cb000000-0000-4000-8000-00000000000b', 'assistant', 'chat', 'balasan B',
   'cb300000-0000-4000-8000-0000000000b1', now() - interval '59 minutes');

insert into coach_profiles (user_id, level, capital_band, has_wallet, wallet_count, minutes_per_day, goal, chains) values
  ('cb000000-0000-4000-8000-00000000000b', 'pro', 'over_1000', true, 5, 120, 'long_term', '{Base,Arbitrum}');

insert into briefings (day, items, model, ai) values
  (date '2026-10-10', '[{"slug": "x"}]', 'm', true);

-- Seeds n user messages (each with a reply 1 second later when p_replied) created at p_at, as the table owner.
create function pg_temp.seed(p_uid uuid, p_thread uuid, p_n int, p_at timestamptz, p_replied boolean) returns void
  language plpgsql as $f$
declare
  i int;
  v_id uuid;
begin
  for i in 1..p_n loop
    insert into public.coach_messages (thread_id, user_id, role, kind, content, created_at)
      values (p_thread, p_uid, 'user', 'chat', 'seed', p_at) returning id into v_id;
    insert into public.coach_usage (id, kind, user_id, created_at, replied) values (v_id, 'message', p_uid, p_at, p_replied);
    if p_replied then
      insert into public.coach_messages (thread_id, user_id, role, kind, content, reply_to, created_at)
        values (p_thread, p_uid, 'assistant', 'chat', 'seed reply', v_id, p_at + interval '1 second');
    end if;
  end loop;
end
$f$;

-- Runs coach_begin n times as whoever the session is, and returns how many succeeded.
create function pg_temp.begin_n(p_thread uuid, p_n int) returns int
  language plpgsql as $f$
declare
  i int;
  ok int := 0;
begin
  for i in 1..p_n loop
    perform public.coach_begin(p_thread, 'chat', 'halo ' || i);
    ok := ok + 1;
  end loop;
  return ok;
end
$f$;

-- Rows visible to the current role; a refused read (42501) counts as zero rows.
create function pg_temp.visible_rows(tbl regclass) returns bigint language plpgsql as $f$
declare n bigint;
begin
  execute format('select count(*) from %s', tbl) into n;
  return n;
exception when insufficient_privilege then
  return 0;
end
$f$;

-- Rows a DELETE removes (a data-modifying CTE cannot sit in a subquery).
create function pg_temp.rows_deleted(p_sql text) returns bigint language plpgsql as $f$
declare n bigint;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end
$f$;

-- ---------- shape ----------
-- 1-4. RLS on every table.
select is((select relrowsecurity from pg_class where oid = 'public.coach_profiles'::regclass), true, 'RLS is on for coach_profiles');
select is((select relrowsecurity from pg_class where oid = 'public.coach_threads'::regclass), true, 'RLS is on for coach_threads');
select is((select relrowsecurity from pg_class where oid = 'public.coach_messages'::regclass), true, 'RLS is on for coach_messages');
select is((select relrowsecurity from pg_class where oid = 'public.briefings'::regclass), true, 'RLS is on for briefings');

-- 5-8. anon holds no privilege of any kind on the four tables.
select results_eq(
  $$ select t, has_table_privilege('anon', t, 'SELECT') or has_table_privilege('anon', t, 'INSERT')
            or has_table_privilege('anon', t, 'UPDATE') or has_table_privilege('anon', t, 'DELETE')
            or has_table_privilege('anon', t, 'TRIGGER') or has_table_privilege('anon', t, 'REFERENCES')
            or has_any_column_privilege('anon', t, 'SELECT') or has_any_column_privilege('anon', t, 'INSERT')
            or has_any_column_privilege('anon', t, 'UPDATE')
     from unnest(array['public.coach_profiles', 'public.coach_threads', 'public.coach_messages', 'public.briefings']) t
     order by t $$,
  $$ values ('public.briefings', false), ('public.coach_messages', false), ('public.coach_profiles', false),
            ('public.coach_threads', false) $$,
  'anon has no privilege on any Coach or briefing table');
select ok(
  not has_table_privilege('authenticated', 'public.coach_messages', 'INSERT')
  and not has_any_column_privilege('authenticated', 'public.coach_messages', 'INSERT')
  and not has_any_column_privilege('authenticated', 'public.coach_messages', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.coach_messages', 'DELETE'),
  'authenticated may only read coach_messages');
select ok(
  not has_table_privilege('authenticated', 'public.coach_threads', 'INSERT')
  and not has_any_column_privilege('authenticated', 'public.coach_threads', 'INSERT')
  and not has_any_column_privilege('authenticated', 'public.coach_threads', 'UPDATE')
  and has_table_privilege('authenticated', 'public.coach_threads', 'SELECT')
  and has_table_privilege('authenticated', 'public.coach_threads', 'DELETE'),
  'authenticated may only select and delete coach_threads');
select ok(
  has_table_privilege('authenticated', 'public.briefings', 'SELECT')
  and not has_any_column_privilege('authenticated', 'public.briefings', 'INSERT')
  and not has_any_column_privilege('authenticated', 'public.briefings', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.briefings', 'DELETE'),
  'authenticated may only select briefings');

-- 9-12. The four RPCs: execute for authenticated only (not anon, not PUBLIC), security definer, empty search_path.
select results_eq(
  $$ select f, has_function_privilege('anon', f, 'execute'), has_function_privilege('authenticated', f, 'execute'),
            exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = f::regprocedure and a.grantee = 0)
     from unnest(array[
       'public.coach_begin(uuid, text, text)',
       'public.coach_finish(uuid, text, text, integer, integer, integer, integer)',
       'public.coach_save_plan(uuid, jsonb)',
       'public.coach_mark_used(uuid)',
       'public.coach_new_thread(uuid)']) f
     order by f $$,
  $$ values ('public.coach_begin(uuid, text, text)', false, true, false),
            ('public.coach_finish(uuid, text, text, integer, integer, integer, integer)', false, true, false),
            ('public.coach_mark_used(uuid)', false, true, false),
            ('public.coach_new_thread(uuid)', false, true, false),
            ('public.coach_save_plan(uuid, jsonb)', false, true, false) $$,
  'only authenticated may execute the five Coach RPCs');
select results_eq(
  $$ select (p.proname::text collate "default"), p.prosecdef, p.proconfig @> array['search_path=""']
     from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('coach_begin', 'coach_finish', 'coach_mark_used', 'coach_save_plan', 'coach_new_thread')
     order by p.proname $$,
  $$ values ('coach_begin', true, true), ('coach_finish', true, true), ('coach_mark_used', true, true),
            ('coach_new_thread', true, true), ('coach_save_plan', true, true) $$,
  'the five Coach RPCs are security definer with an empty search_path');
select is(pg_get_function_result('public.coach_begin(uuid, text, text)'::regprocedure), 'uuid', 'coach_begin returns the message id');
select is(pg_get_function_result('public.coach_finish(uuid, text, text, integer, integer, integer, integer)'::regprocedure),
  'uuid', 'coach_finish returns the reply id');

-- 13-16. Token columns exist and are nullable ints.
select col_type_is('public', 'coach_messages', 'cache_read_tokens', 'integer', 'coach_messages.cache_read_tokens is an int');
select col_type_is('public', 'coach_messages', 'cache_creation_tokens', 'integer', 'coach_messages.cache_creation_tokens is an int');
select col_is_null('public', 'coach_messages', 'cache_read_tokens', 'cache_read_tokens is nullable');
select col_is_null('public', 'coach_messages', 'cache_creation_tokens', 'cache_creation_tokens is nullable');

-- ---------- anon ----------
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
-- 17-24.
select is(pg_temp.visible_rows('public.coach_profiles'), 0::bigint, 'anon cannot read coach_profiles');
select is(pg_temp.visible_rows('public.coach_threads'), 0::bigint, 'anon cannot read coach_threads');
select is(pg_temp.visible_rows('public.coach_messages'), 0::bigint, 'anon cannot read coach_messages');
select throws_ok($$ select * from briefings $$, '42501', null, 'anon cannot read briefings');
select throws_ok($$ select coach_new_thread(null) $$, '42501', null, 'anon cannot call coach_new_thread');
select throws_ok(
  $$ select coach_begin('ca200000-0000-4000-8000-0000000000a1', 'chat', 'x') $$, '42501', null, 'anon cannot call coach_begin');
select throws_ok(
  $$ select coach_finish('cb300000-0000-4000-8000-0000000000b1', 'x', 'm', 1, 1, null, null) $$, '42501', null,
  'anon cannot call coach_finish');
select throws_ok(
  $$ select coach_save_plan('ca200000-0000-4000-8000-0000000000a1', '{}') $$, '42501', null, 'anon cannot call coach_save_plan');
select throws_ok(
  $$ select coach_mark_used('cb300000-0000-4000-8000-0000000000b1') $$, '42501', null, 'anon cannot call coach_mark_used');
reset role;

-- ---------- member A ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"ca000000-0000-4000-8000-00000000000a","role":"authenticated"}';

-- 25-27. A cannot write messages or threads directly.
select throws_ok(
  $$ insert into coach_messages (thread_id, user_id, role, kind, content)
     values ('ca200000-0000-4000-8000-0000000000a1', 'ca000000-0000-4000-8000-00000000000a', 'user', 'chat', 'langsung') $$,
  '42501', null, 'a member cannot insert into coach_messages directly');
select throws_ok(
  $$ insert into coach_threads (user_id) values ('ca000000-0000-4000-8000-00000000000a') $$,
  '42501', null, 'a member cannot insert into coach_threads directly');
select throws_ok(
  $$ update coach_threads set plan = '{}' where id = 'ca200000-0000-4000-8000-0000000000a1' $$,
  '42501', null, 'a member cannot update coach_threads directly');

-- 28-31. A sees their own thread, not B's thread, messages or profile.
select is(pg_temp.visible_rows('public.coach_threads'), 1::bigint, 'A sees only their own thread');
select is(pg_temp.visible_rows('public.coach_messages'), 0::bigint, 'A sees none of B''s messages');
select is(pg_temp.visible_rows('public.coach_profiles'), 0::bigint, 'A sees none of B''s coach profile');
select is(pg_temp.visible_rows('public.briefings'), 1::bigint, 'A reads briefings');

-- 32-34. A cannot delete B's thread or messages (no row matches), nor delete messages at all.
select is(
  pg_temp.rows_deleted($q$ delete from coach_threads where id = 'cb200000-0000-4000-8000-0000000000b1' $q$),
  0::bigint, 'A cannot delete B''s thread');
select throws_ok($$ delete from coach_messages where id = 'cb300000-0000-4000-8000-0000000000b1' $$, '42501', null,
  'A cannot delete B''s messages');
select throws_ok($$ delete from briefings $$, '42501', null, 'a member cannot delete briefings');

-- 35-39. The RPCs on a thread that is not A's, or that does not exist.
select throws_ok(
  $$ select coach_begin('cb200000-0000-4000-8000-0000000000b1', 'chat', 'x') $$, 'P0001', 'thread',
  'coach_begin on B''s thread raises thread');
select throws_ok(
  $$ select coach_begin('00000000-0000-4000-8000-000000000000', 'chat', 'x') $$, 'P0001', 'thread',
  'coach_begin on a missing thread raises thread');
select throws_ok(
  $$ select coach_save_plan('cb200000-0000-4000-8000-0000000000b1', '{"steps": []}') $$, 'P0001', 'thread',
  'coach_save_plan on B''s thread raises thread');
select throws_ok(
  $$ select coach_begin('ca200000-0000-4000-8000-0000000000a1', 'bogus', 'x') $$, '23514', null,
  'coach_begin rejects an unknown kind');
select throws_ok(
  $$ select coach_begin('ca200000-0000-4000-8000-0000000000a1', 'chat', repeat('x', 4001)) $$, '23514', null,
  'coach_begin rejects a message above 4000 characters');

-- 40-42. coach_new_thread: a project thread, a plain thread, and a missing project.
select ok(
  (select coach_new_thread('ca100000-0000-4000-8000-000000000001') is not null), 'coach_new_thread opens a thread for a project');
select ok((select coach_new_thread(null) is not null), 'coach_new_thread opens a thread without a project');
select throws_ok($$ select coach_new_thread('00000000-0000-4000-8000-000000000000') $$, '23503', null,
  'coach_new_thread rejects a project that does not exist');

-- 43-45. coach_save_plan on A's own thread; a plan must be a JSON object.
select lives_ok(
  $$ select coach_save_plan('ca200000-0000-4000-8000-0000000000a1', '{"steps": [{"text": "Swap"}]}') $$,
  'A saves a plan to their own thread');
select is((select plan from coach_threads where id = 'ca200000-0000-4000-8000-0000000000a1'),
  '{"steps": [{"text": "Swap"}]}'::jsonb, 'the plan is stored on the thread');
select throws_ok($$ select coach_save_plan('ca200000-0000-4000-8000-0000000000a1', '[1]') $$, '22023', null,
  'a plan must be a JSON object');

-- 46-47. 20 begins succeed and the 21st raises quota.
select is(pg_temp.begin_n('ca200000-0000-4000-8000-0000000000a1', 20), 20, '20 coach_begin calls succeed');
select throws_ok(
  $$ select coach_begin('ca200000-0000-4000-8000-0000000000a1', 'chat', 'ke-21') $$, 'P0001', 'quota',
  'the 21st coach_begin raises quota');
-- 48. B's usage does not count against A (and A's against B): B has one replied message, so B can still begin.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"cb000000-0000-4000-8000-00000000000b","role":"authenticated"}';
select lives_ok(
  $$ select coach_begin('cb200000-0000-4000-8000-0000000000b1', 'chat', 'B jalan terus') $$,
  'one member''s quota does not count against another');

-- 49-52. B's own coach profile: read, constraints, and the owner-only writes.
select is(pg_temp.visible_rows('public.coach_profiles'), 1::bigint, 'B reads their own coach profile');
select throws_ok(
  $$ insert into coach_profiles (user_id, level, capital_band, has_wallet, wallet_count, minutes_per_day, goal)
     values ('ca000000-0000-4000-8000-00000000000a', 'pro', 'free', false, null, 30, 'learn') $$,
  '42501', null, 'B cannot create a coach profile for A');
select is(
  pg_temp.rows_deleted($q$ delete from coach_profiles where user_id = 'ca000000-0000-4000-8000-00000000000a' $q$),
  0::bigint, 'B cannot delete A''s coach profile');
select lives_ok(
  $$ update coach_profiles set level = 'beginner', chains = '{Base}' where user_id = 'cb000000-0000-4000-8000-00000000000b' $$,
  'B updates their own coach profile');
reset role;

-- 53. updated_at is the server's: a backdated row is stamped on update, and a member cannot write the column.
update coach_profiles set updated_at = '2020-01-01T00:00:00Z' where user_id = 'cb000000-0000-4000-8000-00000000000b';
set local role authenticated;
set local request.jwt.claims = '{"sub":"cb000000-0000-4000-8000-00000000000b","role":"authenticated"}';
update coach_profiles set goal = 'quick' where user_id = 'cb000000-0000-4000-8000-00000000000b';
reset role;
select ok((select updated_at > now() - interval '1 minute' from coach_profiles where user_id = 'cb000000-0000-4000-8000-00000000000b'),
  'updated_at is stamped by the server on update');
select ok(
  not has_column_privilege('authenticated', 'public.coach_profiles', 'updated_at', 'INSERT')
  and not has_column_privilege('authenticated', 'public.coach_profiles', 'updated_at', 'UPDATE'),
  'a member cannot write updated_at (user_id is updatable for upserts; the policy keeps it the member''s own)');

-- 55-66. Coach profile constraints (as the owner role, which skips RLS but not CHECK).
select lives_ok(
  $$ insert into coach_profiles (user_id, level, capital_band, has_wallet, wallet_count, minutes_per_day, goal, chains)
     values ('ca000000-0000-4000-8000-00000000000a', 'beginner', 'gas_only', true, 10, 15, 'learn', '{a,b,c,d,e,f,g,h,i,j}') $$,
  'a coach profile at every upper bound is accepted (10 wallets, 10 chains)');
select throws_ok(
  $$ insert into coach_profiles (user_id, level, capital_band, has_wallet, minutes_per_day, goal)
     values ('cc000000-0000-4000-8000-00000000000c', 'expert', 'free', false, 30, 'quick') $$,
  '23514', null, 'an unknown level is rejected');
select throws_ok(
  $$ insert into coach_profiles (user_id, level, capital_band, has_wallet, minutes_per_day, goal)
     values ('cc000000-0000-4000-8000-00000000000c', 'pro', 'rich', false, 30, 'quick') $$,
  '23514', null, 'an unknown capital band is rejected');
select throws_ok(
  $$ insert into coach_profiles (user_id, level, capital_band, has_wallet, minutes_per_day, goal)
     values ('cc000000-0000-4000-8000-00000000000c', 'pro', 'free', false, 45, 'quick') $$,
  '23514', null, 'minutes_per_day must be 15, 30, 60 or 120');
select throws_ok(
  $$ insert into coach_profiles (user_id, level, capital_band, has_wallet, minutes_per_day, goal)
     values ('cc000000-0000-4000-8000-00000000000c', 'pro', 'free', false, 30, 'rich') $$,
  '23514', null, 'an unknown goal is rejected');
select throws_ok(
  $$ insert into coach_profiles (user_id, level, capital_band, has_wallet, wallet_count, minutes_per_day, goal)
     values ('cc000000-0000-4000-8000-00000000000c', 'pro', 'free', true, 11, 30, 'quick') $$,
  '23514', null, 'more than 10 wallets is rejected');
select throws_ok(
  $$ insert into coach_profiles (user_id, level, capital_band, has_wallet, wallet_count, minutes_per_day, goal)
     values ('cc000000-0000-4000-8000-00000000000c', 'pro', 'free', true, 0, 30, 'quick') $$,
  '23514', null, 'fewer than 1 wallet is rejected');
select throws_ok(
  $$ insert into coach_profiles (user_id, level, capital_band, has_wallet, wallet_count, minutes_per_day, goal)
     values ('cc000000-0000-4000-8000-00000000000c', 'pro', 'free', false, 2, 30, 'quick') $$,
  '23514', null, 'a wallet count without a wallet is rejected');
select throws_ok(
  $$ insert into coach_profiles (user_id, level, capital_band, has_wallet, wallet_count, minutes_per_day, goal)
     values ('cc000000-0000-4000-8000-00000000000c', 'pro', 'free', true, null, 30, 'quick') $$,
  '23514', null, 'a member with a wallet must say how many');
select throws_ok(
  $$ insert into coach_profiles (user_id, level, capital_band, has_wallet, minutes_per_day, goal, chains)
     values ('cc000000-0000-4000-8000-00000000000c', 'pro', 'free', false, 30, 'quick', '{a,b,c,d,e,f,g,h,i,j,k}') $$,
  '23514', null, 'more than 10 chains is rejected');
select throws_ok(
  $$ insert into coach_profiles (user_id, level, capital_band, has_wallet, minutes_per_day, goal, chains)
     values ('cc000000-0000-4000-8000-00000000000c', 'pro', 'free', false, 30, 'quick', array[repeat('x', 41)]) $$,
  '23514', null, 'a chain name above 40 characters is rejected');
select lives_ok(
  $$ insert into coach_profiles (user_id, level, capital_band, has_wallet, minutes_per_day, goal, chains)
     values ('cc000000-0000-4000-8000-00000000000c', 'pro', 'free', false, 30, 'quick', array[repeat('x', 40)]) $$,
  'a chain name of 40 characters is accepted');

-- ---------- the quota, as the owner seeds usage and a member calls coach_begin ----------
-- Helper: act as a member.
-- 67. A's 20 messages (above) have no reply but are fresh, so they count; a reply keeps counting once old.
-- (A is done; the cases below use fresh members.)

-- F: 20 unanswered messages older than 2 minutes do not count, so F can begin 20 more; a message under 2 minutes old
-- with no reply does count.
select pg_temp.seed('cf000000-0000-4000-8000-00000000000f', 'cf200000-0000-4000-8000-0000000000f1', 20, now() - interval '3 minutes', false);
set local role authenticated;
set local request.jwt.claims = '{"sub":"cf000000-0000-4000-8000-00000000000f","role":"authenticated"}';
select is(pg_temp.begin_n('cf200000-0000-4000-8000-0000000000f1', 20), 20,
  'unanswered messages older than 2 minutes are not counted');
select throws_ok(
  $$ select coach_begin('cf200000-0000-4000-8000-0000000000f1', 'chat', 'ke-21') $$, 'P0001', 'quota',
  'the fresh unanswered messages count: the 21st raises quota');
reset role;

-- G: 19 answered messages from the start of today WIB + 1 unanswered 119 seconds old = 20 counted; the next raises. Then the
-- young one is backdated to 121 seconds: it stops counting, so the next succeeds.
select pg_temp.seed('c0000000-0000-4000-8000-000000000001', 'c0200000-0000-4000-8000-0000000000f2', 19,
  date_trunc('day', now() at time zone 'Asia/Jakarta') at time zone 'Asia/Jakarta', true);
select pg_temp.seed('c0000000-0000-4000-8000-000000000001', 'c0200000-0000-4000-8000-0000000000f2', 1,
  now() - interval '119 seconds', false);
set local role authenticated;
set local request.jwt.claims = '{"sub":"c0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok(
  $$ select coach_begin('c0200000-0000-4000-8000-0000000000f2', 'chat', 'x') $$, 'P0001', 'quota',
  '19 answered messages and one under 2 minutes old fill the quota');
reset role;
update coach_usage set created_at = now() - interval '121 seconds'
  where user_id = 'c0000000-0000-4000-8000-000000000001' and not replied;
set local role authenticated;
set local request.jwt.claims = '{"sub":"c0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok(
  $$ select coach_begin('c0200000-0000-4000-8000-0000000000f2', 'chat', 'x') $$,
  'a message older than 2 minutes with no reply stops counting');
reset role;

-- The day is fixed to WIB (Asia/Jakarta) whatever profiles.timezone says. C: the default timezone (UTC).
-- C: default timezone. 20 answered messages one second before the start of today WIB are yesterday: not counted.
select pg_temp.seed('cc000000-0000-4000-8000-00000000000c', 'cc200000-0000-4000-8000-0000000000c1', 20,
  (date_trunc('day', now() at time zone 'Asia/Jakarta') at time zone 'Asia/Jakarta') - interval '1 second', true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"cc000000-0000-4000-8000-00000000000c","role":"authenticated"}';
select lives_ok(
  $$ select coach_begin('cc200000-0000-4000-8000-0000000000c1', 'chat', 'x') $$,
  'default timezone: usage from yesterday WIB is not counted');
reset role;
-- 19 more at the very start of today WIB (+ the fresh one above) are today: counted, so the next begin raises quota.
select pg_temp.seed('cc000000-0000-4000-8000-00000000000c', 'cc200000-0000-4000-8000-0000000000c1', 19,
  date_trunc('day', now() at time zone 'Asia/Jakarta') at time zone 'Asia/Jakarta', true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"cc000000-0000-4000-8000-00000000000c","role":"authenticated"}';
select throws_ok(
  $$ select coach_begin('cc200000-0000-4000-8000-0000000000c1', 'chat', 'x') $$, 'P0001', 'quota',
  'default timezone: usage from today WIB is counted');
reset role;

-- D: timezone set to Pacific/Kiritimati (UTC+14), E: Pacific/Pago_Pago (UTC-11). Changing it does not change the count.
-- D: Pacific/Kiritimati. 20 answered messages one second before the start of today WIB are yesterday: not counted.
select pg_temp.seed('cd000000-0000-4000-8000-00000000000d', 'cd200000-0000-4000-8000-0000000000d1', 20,
  (date_trunc('day', now() at time zone 'Asia/Jakarta') at time zone 'Asia/Jakarta') - interval '1 second', true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"cd000000-0000-4000-8000-00000000000d","role":"authenticated"}';
select lives_ok(
  $$ select coach_begin('cd200000-0000-4000-8000-0000000000d1', 'chat', 'x') $$,
  'Pacific/Kiritimati: usage from yesterday WIB is not counted');
reset role;
-- 19 more at the very start of today WIB (+ the fresh one above) are today: counted, so the next begin raises quota.
select pg_temp.seed('cd000000-0000-4000-8000-00000000000d', 'cd200000-0000-4000-8000-0000000000d1', 19,
  date_trunc('day', now() at time zone 'Asia/Jakarta') at time zone 'Asia/Jakarta', true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"cd000000-0000-4000-8000-00000000000d","role":"authenticated"}';
select throws_ok(
  $$ select coach_begin('cd200000-0000-4000-8000-0000000000d1', 'chat', 'x') $$, 'P0001', 'quota',
  'Pacific/Kiritimati: usage from today WIB is counted');
reset role;

-- E: Pacific/Pago_Pago. 20 answered messages one second before the start of today WIB are yesterday: not counted.
select pg_temp.seed('ce000000-0000-4000-8000-00000000000e', 'ce200000-0000-4000-8000-0000000000e1', 20,
  (date_trunc('day', now() at time zone 'Asia/Jakarta') at time zone 'Asia/Jakarta') - interval '1 second', true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"ce000000-0000-4000-8000-00000000000e","role":"authenticated"}';
select lives_ok(
  $$ select coach_begin('ce200000-0000-4000-8000-0000000000e1', 'chat', 'x') $$,
  'Pacific/Pago_Pago: usage from yesterday WIB is not counted');
reset role;
-- 19 more at the very start of today WIB (+ the fresh one above) are today: counted, so the next begin raises quota.
select pg_temp.seed('ce000000-0000-4000-8000-00000000000e', 'ce200000-0000-4000-8000-0000000000e1', 19,
  date_trunc('day', now() at time zone 'Asia/Jakarta') at time zone 'Asia/Jakarta', true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"ce000000-0000-4000-8000-00000000000e","role":"authenticated"}';
select throws_ok(
  $$ select coach_begin('ce200000-0000-4000-8000-0000000000e1', 'chat', 'x') $$, 'P0001', 'quota',
  'Pacific/Pago_Pago: usage from today WIB is counted');
reset role;


-- ---------- coach_finish ----------
-- A's first message of the 20 above: finish it as A.
create temp table a_msgs as
  select id from coach_messages
  where user_id = 'ca000000-0000-4000-8000-00000000000a' and role = 'user' order by created_at, id limit 3;
grant select on a_msgs to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"cb000000-0000-4000-8000-00000000000b","role":"authenticated"}';
-- 86-87. B cannot finish A's message, and a message that does not exist.
select throws_ok(
  format($$ select coach_finish(%L, 'balasan palsu', 'm', 1, 1, null, null) $$, (select id from a_msgs limit 1)),
  'P0001', 'message', 'coach_finish on another member''s message raises message');
select throws_ok(
  $$ select coach_finish('00000000-0000-4000-8000-000000000000', 'x', 'm', 1, 1, null, null) $$,
  'P0001', 'message', 'coach_finish on a missing message raises message');

set local request.jwt.claims = '{"sub":"ca000000-0000-4000-8000-00000000000a","role":"authenticated"}';
-- 88. A's own, unanswered message: finished, and the reply is returned.
select ok(
  (select coach_finish((select id from a_msgs limit 1), 'Ini balasannya', 'sonnet-test', 120, 45, 100, 20) is not null),
  'A finishes their own unanswered message');
-- 89. The reply is stored with the model, all four token counts, the same thread and kind, linked to the message.
select results_eq(
  format($$ select role, kind, content, model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
                   thread_id = 'ca200000-0000-4000-8000-0000000000a1'
            from coach_messages where reply_to = %L $$, (select id from a_msgs limit 1)),
  $$ values ('assistant'::text, 'chat'::text, 'Ini balasannya'::text, 'sonnet-test'::text, 120, 45, 100, 20, true) $$,
  'the reply carries the model and the token counts, and goes into the message''s thread');
-- 90. An answered message cannot be answered again.
select throws_ok(
  format($$ select coach_finish(%L, 'dua kali', 'm', 1, 1, null, null) $$, (select id from a_msgs limit 1)),
  'P0001', 'replied', 'coach_finish on an already answered message raises replied');
-- 91. An assistant message is not a user message to answer.
select throws_ok(
  format($$ select coach_finish(%L, 'x', 'm', 1, 1, null, null) $$,
    (select r.id from coach_messages r where r.reply_to = (select id from a_msgs limit 1))),
  'P0001', 'message', 'coach_finish on an assistant message raises message');
-- 92. Token counts may be null, not negative.
select throws_ok(
  format($$ select coach_finish(%L, 'x', 'm', -1, 1, null, null) $$, (select id from a_msgs offset 1 limit 1)),
  '23514', null, 'a negative token count is rejected');
-- Reply length: at most 16000 characters (a member's own message is limited to 4000, above) and not blank.
select throws_ok(
  format($$ select coach_finish(%L, repeat('y', 16001), 'm', 1, 1, null, null) $$, (select id from a_msgs offset 2 limit 1)),
  '23514', null, 'an assistant reply above 16000 characters is rejected');
select throws_ok(
  format($$ select coach_finish(%L, E'  \n ', 'm', 1, 1, null, null) $$, (select id from a_msgs offset 2 limit 1)),
  '23514', null, 'a blank assistant reply is rejected');
select lives_ok(
  format($$ select coach_finish(%L, repeat('y', 5000), 'm', 1, 1, null, null) $$, (select id from a_msgs offset 1 limit 1)),
  'a 5000-character assistant reply is accepted');

-- supabase-js .upsert(): INSERT ... ON CONFLICT (user_id) DO UPDATE SET user_id = excluded.user_id, ... works for the
-- member's own row (A's profile exists from the bounds test) and for no one else's.
select lives_ok(
  $$ insert into coach_profiles (user_id, level, capital_band, has_wallet, minutes_per_day, goal, chains)
     values ('ca000000-0000-4000-8000-00000000000a', 'pro', 'free', false, 30, 'quick', '{Base}')
     on conflict (user_id) do update set user_id = excluded.user_id, level = excluded.level,
       capital_band = excluded.capital_band, has_wallet = excluded.has_wallet, wallet_count = excluded.wallet_count,
       minutes_per_day = excluded.minutes_per_day, goal = excluded.goal, chains = excluded.chains $$,
  'a member upserts their own coach profile');
select is((select level || '/' || goal from coach_profiles where user_id = 'ca000000-0000-4000-8000-00000000000a'),
  'pro/quick', 'the upsert updated the row');
select throws_ok(
  $$ insert into coach_profiles (user_id, level, capital_band, has_wallet, minutes_per_day, goal)
     values ('cb000000-0000-4000-8000-00000000000b', 'pro', 'free', false, 30, 'quick')
     on conflict (user_id) do update set user_id = excluded.user_id, level = excluded.level $$,
  '42501', null, 'an upsert cannot overwrite another member''s coach profile');
select throws_ok(
  $$ update coach_profiles set user_id = 'cd000000-0000-4000-8000-00000000000d'
     where user_id = 'ca000000-0000-4000-8000-00000000000a' $$,
  '42501', null, 'a member cannot move their coach profile to another user');
select throws_ok($$ select * from coach_usage $$, '42501', null, 'a member cannot read the usage ledger');
reset role;

-- coach_usage: the ledger. coach_finish marked the answered message; the table is closed to both web roles.
select is((select replied from coach_usage where id = (select id from a_msgs offset 1 limit 1)), true,
  'coach_finish marks the usage row as replied');
select is((select relrowsecurity from pg_class where oid = 'public.coach_usage'::regclass)
          and not exists (select 1 from pg_policies where tablename = 'coach_usage'), true,
  'coach_usage has RLS on and no policy');
select ok(
  not has_table_privilege('anon', 'public.coach_usage', 'SELECT') and not has_any_column_privilege('anon', 'public.coach_usage', 'INSERT')
  and not has_table_privilege('authenticated', 'public.coach_usage', 'SELECT')
  and not has_any_column_privilege('authenticated', 'public.coach_usage', 'INSERT')
  and not has_any_column_privilege('authenticated', 'public.coach_usage', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.coach_usage', 'DELETE'),
  'neither web role has any privilege on coach_usage');

-- ---------- deleting threads gives nothing back ----------
-- H: a blank message is refused (and leaves no ledger row); 20 begins, then the thread is deleted and a new one opened:
-- the 21st still raises quota. The messages deleted unanswered keep counting (trigger), even once they are 2 minutes old.
create temp table h_t (id uuid, n int);
grant all on h_t to authenticated;
set local role authenticated;
set local request.jwt.claims = '{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok($$ insert into h_t select coach_new_thread(null), 1 $$, 'H opens a thread');
select throws_ok(
  format($$ select coach_begin(%L, 'chat', E'   \t ') $$, (select id from h_t where n = 1)),
  '23514', null, 'a blank user message is rejected');
select is(pg_temp.begin_n((select id from h_t where n = 1), 20), 20, 'H sends 20 messages');
select is(
  pg_temp.rows_deleted(format($q$ delete from coach_threads where id = %L $q$, (select id from h_t where n = 1))),
  1::bigint, 'H deletes the thread');
insert into h_t select coach_new_thread(null), 2;
select throws_ok(
  format($$ select coach_begin(%L, 'chat', 'ke-21') $$, (select id from h_t where n = 2)), 'P0001', 'quota',
  'after deleting the thread, the 21st message of the day still raises quota');
reset role;
select is((select count(*)::int from coach_usage where user_id = 'c1000000-0000-4000-8000-000000000001' and kind = 'message'), 20,
  'the ledger kept the 20 messages (the blank one left no row)');
select is((select count(*)::int from coach_usage where user_id = 'c1000000-0000-4000-8000-000000000001' and kind = 'message' and replied), 20,
  'messages deleted without a reply keep counting after 2 minutes');
select is((select count(*)::int from coach_messages where user_id = 'c1000000-0000-4000-8000-000000000001'), 0,
  'the thread''s messages are gone');

-- I: the daily thread cap also survives deleting the threads.
create function pg_temp.new_thread_n(p_n int) returns int language plpgsql as $f$
declare i int; ok int := 0;
begin
  for i in 1..p_n loop
    perform public.coach_new_thread(null);
    ok := ok + 1;
  end loop;
  return ok;
end
$f$;
set local role authenticated;
set local request.jwt.claims = '{"sub":"c2000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(pg_temp.new_thread_n(50), 50, 'I opens 50 threads in a day');
select is(pg_temp.rows_deleted($q$ delete from coach_threads $q$), 50::bigint, 'I deletes all their threads');
select throws_ok($$ select coach_new_thread(null) $$, 'P0001', 'threads', 'the 51st thread of the day is refused even after the deletes');
reset role;
select is((select count(*)::int from coach_usage where user_id = 'c2000000-0000-4000-8000-000000000001' and kind = 'thread'), 50,
  'the ledger kept the 50 threads');

-- ---------- coach_mark_used, expiry and the delete trigger ----------
-- M: two messages through coach_begin; #2 is marked (the model started to answer), then both pass their 2 minutes.
create temp table m_ids (n int, id uuid);
grant all on m_ids to authenticated;
set local role authenticated;
set local request.jwt.claims = '{"sub":"c5000000-0000-4000-8000-000000000001","role":"authenticated"}';
insert into m_ids select 1, coach_begin('c5200000-0000-4000-8000-0000000000f5', 'chat', 'satu');
insert into m_ids select 2, coach_begin('c5200000-0000-4000-8000-0000000000f5', 'chat', 'dua');
select coach_mark_used((select id from m_ids where n = 2));
reset role;
update coach_usage set created_at = now() - interval '3 minutes' where user_id = 'c5000000-0000-4000-8000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"c5000000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok(
  format($$ select coach_finish(%L, 'terlambat', 'm', 1, 1, null, null) $$, (select id from m_ids where n = 1)),
  'P0001', 'expired', 'coach_finish on an unmarked message past its 2 minutes raises expired');
select lives_ok(
  format($$ select coach_finish(%L, 'masih boleh', 'm', 1, 1, null, null) $$, (select id from m_ids where n = 2)),
  'coach_finish on an old message that was marked still works');
reset role;

-- coach_quota_remaining reads the same ledger: H deleted a thread after 20 counted messages and still has 0 left.
set local role authenticated;
set local request.jwt.claims = '{"sub":"c5000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(coach_quota_remaining(), 19, 'quota_remaining counts the marked old message and ignores the expired one');
set local role anon;
set local request.jwt.claims = '{}';
select throws_ok($$ select coach_quota_remaining() $$, '42501', null, 'anon cannot call coach_quota_remaining');
reset role;

-- L: a message that failed (past its 2 minutes, unmarked) stays uncounted when its thread is deleted afterwards.
create temp table l_ids (id uuid);
grant all on l_ids to authenticated;
set local role authenticated;
set local request.jwt.claims = '{"sub":"c4000000-0000-4000-8000-000000000001","role":"authenticated"}';
insert into l_ids select coach_begin('c4200000-0000-4000-8000-0000000000f4', 'chat', 'gagal');
reset role;
update coach_usage set created_at = now() - interval '3 minutes' where id = (select id from l_ids);
update coach_messages set created_at = now() - interval '3 minutes' where id = (select id from l_ids);
set local role authenticated;
set local request.jwt.claims = '{"sub":"c4000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(pg_temp.rows_deleted($q$ delete from coach_threads where id = 'c4200000-0000-4000-8000-0000000000f4' $q$), 1::bigint,
  'L deletes the thread of a failed message');
reset role;
select is((select replied from coach_usage where id = (select id from l_ids)), false,
  'a failed message stays uncounted after its thread is deleted');

-- K: 20 messages past their 2 minutes without a reply (none count). A lapsed message cannot be marked (it would count
-- again); a fresh message that is marked keeps counting for good after its 2 minutes.
select pg_temp.seed('c3000000-0000-4000-8000-000000000001', 'c3200000-0000-4000-8000-0000000000f3', 20, now() - interval '3 minutes', false);
create temp table k_ids as select id from coach_usage where user_id = 'c3000000-0000-4000-8000-000000000001' limit 1;
create temp table k_fresh (id uuid);
grant all on k_ids, k_fresh to authenticated;
set local role authenticated;
set local request.jwt.claims = '{"sub":"c3000000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok(format($$ select coach_mark_used(%L) $$, (select id from k_ids)), 'P0001', 'expired',
  'marking a message whose 2 minutes ran out raises expired');
insert into k_fresh select coach_begin('c3200000-0000-4000-8000-0000000000f3', 'chat', 'baru');
select lives_ok(format($$ select coach_mark_used(%L) $$, (select id from k_fresh)), 'K marks their own fresh message');
select lives_ok(format($$ select coach_mark_used(%L) $$, (select id from k_fresh)), 'marking is idempotent');
select throws_ok(format($$ select coach_mark_used(%L) $$, (select id from m_ids where n = 1)), 'P0001', 'message',
  'a member cannot mark another member''s message');
select throws_ok($$ select coach_mark_used('00000000-0000-4000-8000-000000000000') $$, 'P0001', 'message',
  'marking a message that does not exist raises message');
reset role;
update coach_usage set created_at = now() - interval '3 minutes' where id = (select id from k_fresh);
update coach_messages set created_at = now() - interval '3 minutes' where id = (select id from k_fresh);
set local role authenticated;
set local request.jwt.claims = '{"sub":"c3000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(pg_temp.begin_n('c3200000-0000-4000-8000-0000000000f3', 19), 19,
  'with one old marked message counted, 19 more fit in the day');
select throws_ok(
  $$ select coach_begin('c3200000-0000-4000-8000-0000000000f3', 'chat', 'ke-21') $$, 'P0001', 'quota',
  'a marked message with no reply keeps counting after 2 minutes');
reset role;

-- N: deleting a member together with their messages, in the transaction that made them, does not trip the trigger.
select pg_temp.seed('c6000000-0000-4000-8000-000000000001', 'c6200000-0000-4000-8000-0000000000f6', 1, now(), false);
select lives_ok($$ delete from auth.users where id = 'c6000000-0000-4000-8000-000000000001' $$,
  'deleting a member and their fresh messages in one transaction succeeds');
select is((select count(*)::int from coach_usage where user_id = 'c6000000-0000-4000-8000-000000000001'), 0,
  'the member''s ledger rows went with them');

-- O: the attempts cap. 60 unanswered begins older than 2 minutes count for nothing toward the 20, yet the 61st attempt of
-- the day raises quota (a member who aborts before the first text must not get unlimited paid calls).
insert into coach_threads (id, user_id, project_id) values
  ('c7200000-0000-4000-8000-0000000000f7', 'c7000000-0000-4000-8000-000000000001', null);
select pg_temp.seed('c7000000-0000-4000-8000-000000000001', 'c7200000-0000-4000-8000-0000000000f7', 60, now() - interval '3 minutes', false);
set local role authenticated;
set local request.jwt.claims = '{"sub":"c7000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(coach_quota_remaining(), 20, '60 expired unanswered begins leave the counted quota at 20 left');
select throws_ok(
  $$ select coach_begin('c7200000-0000-4000-8000-0000000000f7', 'chat', 'ke-61') $$, 'P0001', 'quota',
  'the 61st begin of the day raises quota although 20 counted messages are left');
reset role;
select is((select count(*)::int from coach_usage where user_id = 'c7000000-0000-4000-8000-000000000001' and kind = 'message'), 60,
  'the refused begin left no ledger row');

-- I again: the thread cap is the WIB day. The 50 rows from today are backdated to just before today started: the cap is clear.
update coach_usage set created_at = (date_trunc('day', now() at time zone 'Asia/Jakarta') at time zone 'Asia/Jakarta') - interval '1 second'
  where user_id = 'c2000000-0000-4000-8000-000000000001' and kind = 'thread';
set local role authenticated;
set local request.jwt.claims = '{"sub":"c2000000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok($$ select coach_new_thread(null) $$, 'threads from yesterday WIB do not count against the cap');
reset role;

-- ---------- delete cascades ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"ca000000-0000-4000-8000-00000000000a","role":"authenticated"}';
-- 93. A deletes their own thread: its messages go with it.
select is(
  pg_temp.rows_deleted($q$ delete from coach_threads where id = 'ca200000-0000-4000-8000-0000000000a1' $q$),
  1::bigint, 'A deletes their own thread');
reset role;
select is((select count(*)::int from coach_messages where thread_id = 'ca200000-0000-4000-8000-0000000000a1'), 0,
  'the messages of a deleted thread go with it');

-- B's thread and its messages are untouched by A's attempts (+ briefings written by the owner stay readable).
select is((select count(*)::int from coach_threads where id = 'cb200000-0000-4000-8000-0000000000b1'), 1,
  'B''s thread survived A''s delete attempt');

select * from finish();
rollback;
