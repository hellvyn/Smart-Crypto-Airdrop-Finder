-- pgTAP tests for 0010_farming.sql: the private farming tracker ("Garapan saya"). Owner-only RLS, no anon access,
-- checks written only through toggle_farming_check() for the server's "today" in the member's timezone, active
-- limits (50 projects, 30 tasks per project) and cascades from projects.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(73);

-- Fixtures (run as the migration/test owner role, which bypasses RLS).
-- user A: 55555555-..., user B: 66666666-..., user C: 77777777-... (limits only)
insert into auth.users (id, email) values
  ('55555555-5555-5555-5555-555555555555', 'fa@example.test'),
  ('66666666-6666-6666-6666-666666666666', 'fb@example.test'),
  ('77777777-7777-7777-7777-777777777777', 'fc@example.test');

insert into projects (id, slug, name, name_key, first_seen, last_seen) values
  ('eeeeeeee-0000-0000-0000-000000000001', 'farm-one', 'Farm One', 'farmone', now(), now()),
  ('eeeeeeee-0000-0000-0000-000000000002', 'farm-two', 'Farm Two', 'farmtwo', now(), now()),
  ('eeeeeeee-0000-0000-0000-000000000003', 'farm-three', 'Farm Three', 'farmthree', now(), now());

-- A farms p1 (active) and p2 (stopped). B farms p1.
insert into farming_projects (user_id, project_id, archived_at) values
  ('55555555-5555-5555-5555-555555555555', 'eeeeeeee-0000-0000-0000-000000000001', null),
  ('55555555-5555-5555-5555-555555555555', 'eeeeeeee-0000-0000-0000-000000000002', now()),
  ('66666666-6666-6666-6666-666666666666', 'eeeeeeee-0000-0000-0000-000000000001', null);

insert into farming_tasks (id, user_id, project_id, text, cadence, origin, archived_at) values
  ('fa000000-0000-0000-0000-000000000001', '55555555-5555-5555-5555-555555555555',
   'eeeeeeee-0000-0000-0000-000000000001', 'Swap di testnet', 'daily', 'source', null),
  ('fa000000-0000-0000-0000-000000000002', '55555555-5555-5555-5555-555555555555',
   'eeeeeeee-0000-0000-0000-000000000001', 'Daftar waitlist', 'once', 'source', null),
  ('fa000000-0000-0000-0000-000000000003', '55555555-5555-5555-5555-555555555555',
   'eeeeeeee-0000-0000-0000-000000000001', 'Task lama', 'daily', 'custom', now()),
  ('fa000000-0000-0000-0000-000000000004', '55555555-5555-5555-5555-555555555555',
   'eeeeeeee-0000-0000-0000-000000000002', 'Task di project yang udah berhenti', 'daily', 'source', null),
  ('fb000000-0000-0000-0000-000000000001', '66666666-6666-6666-6666-666666666666',
   'eeeeeeee-0000-0000-0000-000000000001', 'Task B', 'daily', 'source', null);

insert into farming_checks (task_id, user_id, day) values
  ('fb000000-0000-0000-0000-000000000001', '66666666-6666-6666-6666-666666666666', date '2026-10-01');

-- Rows visible to the current role. A refused read (no privilege, 42501) is what PostgREST answers with an error and
-- no data, so it counts as zero rows, the same as rows filtered out by RLS.
create function pg_temp.visible_rows(tbl regclass) returns bigint language plpgsql as $f$
declare n bigint;
begin
  execute format('select count(*) from %s', tbl) into n;
  return n;
exception when insufficient_privilege then
  return 0;
end
$f$;

-- ---------- shape ----------
-- 1. RLS on all three tables.
select results_eq(
  $$ select oid::regclass::text, relrowsecurity from pg_class
     where oid in ('public.farming_projects'::regclass, 'public.farming_tasks'::regclass, 'public.farming_checks'::regclass)
     order by 1 $$,
  $$ values ('farming_checks'::text, true), ('farming_projects'::text, true), ('farming_tasks'::text, true) $$,
  'row level security is enabled on all farming tables');

-- 2-3. Both functions are security definer with an empty search_path, executable by authenticated only.
select results_eq(
  $$ select p.oid::regproc::text, p.prosecdef, p.proconfig @> array['search_path=""'] from pg_proc p
     where p.oid in ('public.farming_today()'::regprocedure, 'public.toggle_farming_check(uuid, boolean)'::regprocedure)
     order by 1 $$,
  $$ values ('farming_today'::text, true, true), ('toggle_farming_check'::text, true, true) $$,
  'farming_today and toggle_farming_check are security definer with an empty search_path');
select results_eq(
  $$ select has_function_privilege('anon', 'public.farming_today()', 'execute'),
            has_function_privilege('anon', 'public.toggle_farming_check(uuid, boolean)', 'execute'),
            has_function_privilege('authenticated', 'public.farming_today()', 'execute'),
            has_function_privilege('authenticated', 'public.toggle_farming_check(uuid, boolean)', 'execute') $$,
  $$ values (false, false, true, true) $$,
  'only authenticated may execute the farming functions');

-- 4. Clients cannot write checks directly (insert only through toggle_farming_check).
select is(has_table_privilege('authenticated', 'public.farming_checks', 'INSERT'), false,
  'authenticated holds no insert privilege on farming_checks');

-- 5-7. Table constraints.
select throws_ok(
  $$ insert into farming_tasks (user_id, project_id, text, cadence, origin)
     values ('55555555-5555-5555-5555-555555555555', 'eeeeeeee-0000-0000-0000-000000000001', '', 'daily', 'custom') $$,
  '23514', null, 'an empty task text is rejected');
select throws_ok(
  $$ insert into farming_tasks (user_id, project_id, text, cadence, origin)
     values ('55555555-5555-5555-5555-555555555555', 'eeeeeeee-0000-0000-0000-000000000001', 'x', 'monthly', 'custom') $$,
  '23514', null, 'an unknown cadence is rejected');
select throws_ok(
  $$ insert into farming_tasks (user_id, project_id, text, cadence, origin)
     values ('55555555-5555-5555-5555-555555555555', 'eeeeeeee-0000-0000-0000-000000000003', 'x', 'daily', 'custom') $$,
  '23503', null, 'a task needs a farming project of the same member');

-- ---------- anon ----------
-- 8. The rows exist, so zero below means hidden, not missing.
select is(
  (select pg_temp.visible_rows('public.farming_projects') > 0 and pg_temp.visible_rows('public.farming_tasks') > 0
          and pg_temp.visible_rows('public.farming_checks') > 0),
  true, 'fixtures: farming rows exist');

set local role anon;
-- 9-15.
select is(pg_temp.visible_rows('public.farming_projects'), 0::bigint, 'anon cannot read farming_projects');
select is(pg_temp.visible_rows('public.farming_tasks'), 0::bigint, 'anon cannot read farming_tasks');
select is(pg_temp.visible_rows('public.farming_checks'), 0::bigint, 'anon cannot read farming_checks');
select throws_ok(
  $$ insert into farming_projects (user_id, project_id)
     values ('55555555-5555-5555-5555-555555555555', 'eeeeeeee-0000-0000-0000-000000000003') $$,
  '42501', null, 'anon cannot insert into farming_projects');
select throws_ok($$ delete from farming_checks $$, '42501', null, 'anon cannot delete farming_checks');
select throws_ok($$ select public.farming_today() $$, '42501', null, 'anon cannot execute farming_today');
select throws_ok($$ select public.toggle_farming_check('fa000000-0000-0000-0000-000000000001', true) $$,
  '42501', null, 'anon cannot execute toggle_farming_check');
reset role;

-- 16. A caller without a user id is refused.
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated"}';
select throws_ok($$ select public.toggle_farming_check('fa000000-0000-0000-0000-000000000001', true) $$,
  '42501', null, 'toggle_farming_check refuses a caller without auth.uid()');
reset role;

-- ---------- user A: reads and writes ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}';

-- 17-21. Reads see only A's rows.
select is((select count(*)::int from farming_projects), 2, 'A sees only their own 2 farming projects');
select is((select count(*)::int from farming_tasks), 4, 'A sees only their own 4 tasks');
select is((select count(*)::int from farming_tasks where user_id = '66666666-6666-6666-6666-666666666666'), 0,
  'A cannot select B''s tasks');
select is((select count(*)::int from farming_checks), 0, 'A cannot select B''s checks');
select is((select count(*)::int from farming_projects where user_id = '66666666-6666-6666-6666-666666666666'), 0,
  'A cannot select B''s farming projects');

-- 22-26. Inserts.
select throws_ok(
  $$ insert into farming_projects (user_id, project_id)
     values ('66666666-6666-6666-6666-666666666666', 'eeeeeeee-0000-0000-0000-000000000003') $$,
  '42501', null, 'A cannot start farming on behalf of B');
select throws_ok(
  $$ insert into farming_projects (user_id, project_id, started_at)
     values ('55555555-5555-5555-5555-555555555555', 'eeeeeeee-0000-0000-0000-000000000003', now() - interval '30 days') $$,
  '42501', null, 'A cannot backdate started_at (the server sets it)');
select lives_ok(
  $$ insert into farming_projects (user_id, project_id)
     values ('55555555-5555-5555-5555-555555555555', 'eeeeeeee-0000-0000-0000-000000000003') $$,
  'A can start farming a project');
select throws_ok(
  $$ insert into farming_tasks (user_id, project_id, text, cadence, origin)
     values ('66666666-6666-6666-6666-666666666666', 'eeeeeeee-0000-0000-0000-000000000001', 'Spam', 'daily', 'custom') $$,
  '42501', null, 'A cannot add a task to B''s tracker');
select lives_ok(
  $$ insert into farming_tasks (user_id, project_id, text, cadence, origin, position)
     values ('55555555-5555-5555-5555-555555555555', 'eeeeeeee-0000-0000-0000-000000000003', 'Follow X', 'weekly', 'custom', 1) $$,
  'A can add their own task');

-- 27-28. Checks are never written directly, not even for today.
select throws_ok(
  $$ insert into farming_checks (task_id, user_id, day)
     values ('fa000000-0000-0000-0000-000000000001', '55555555-5555-5555-5555-555555555555', current_date) $$,
  '42501', null, 'A cannot insert a check directly');
select throws_ok(
  $$ update farming_tasks set text = 'Teks baru' where id = 'fa000000-0000-0000-0000-000000000001' $$,
  '42501', null, 'A cannot rewrite a task''s text (past checks keep their task text)');

-- 29-31. Writes on B's rows are silent no-ops under RLS (verified as owner below).
select lives_ok(
  $$ update farming_tasks set archived_at = now() where id = 'fb000000-0000-0000-0000-000000000001' $$,
  'A archiving B''s task raises nothing');
select lives_ok($$ delete from farming_checks where task_id = 'fb000000-0000-0000-0000-000000000001' $$,
  'A deleting B''s checks raises nothing');
select lives_ok(
  $$ delete from farming_projects where user_id = '66666666-6666-6666-6666-666666666666' $$,
  'A deleting B''s farming projects raises nothing');
reset role;

-- 32. B's data survived A's attempts.
select results_eq(
  $$ select (select count(*)::int from farming_projects where user_id = '66666666-6666-6666-6666-666666666666'),
            (select count(*)::int from farming_tasks
             where id = 'fb000000-0000-0000-0000-000000000001' and archived_at is null),
            (select count(*)::int from farming_checks where user_id = '66666666-6666-6666-6666-666666666666') $$,
  $$ values (1, 1, 1) $$,
  'B''s farming project, task and check are untouched by A''s attempts');

-- ---------- toggle_farming_check: today in the member's timezone ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}';
update profiles set timezone = 'Asia/Jakarta';

-- 33. farming_today() is the caller's local date.
select is(public.farming_today(), (now() at time zone 'Asia/Jakarta')::date,
  'farming_today() is today in the caller''s profile timezone');

-- 34-37. Checking twice (two tabs) is idempotent: one row, dated today in Asia/Jakarta.
select is(public.toggle_farming_check('fa000000-0000-0000-0000-000000000001', true), true,
  'checking a daily task returns true');
select is(public.toggle_farming_check('fa000000-0000-0000-0000-000000000001', true), true,
  'checking it again (second tab) still returns true');
select results_eq(
  $$ select day, user_id::text from farming_checks where task_id = 'fa000000-0000-0000-0000-000000000001' $$,
  $$ values ((now() at time zone 'Asia/Jakarta')::date, '55555555-5555-5555-5555-555555555555'::text) $$,
  'two checks leave exactly one row, dated today in Asia/Jakarta and owned by A');
select is(public.toggle_farming_check('fa000000-0000-0000-0000-000000000001', false), false,
  'unchecking a daily task returns false');

-- 38-39. Unchecking twice is idempotent too.
select is(public.toggle_farming_check('fa000000-0000-0000-0000-000000000001', false), false,
  'unchecking again (second tab) still returns false');
select is((select count(*)::int from farming_checks where task_id = 'fa000000-0000-0000-0000-000000000001'), 0,
  'unchecking removes today''s row');

-- 40-44. Changing timezone keeps past days (review focus 1). Kiritimati (UTC+14) and Pago Pago (UTC-11) are 25 hours
-- apart, so "today" is a different date in each at any instant.
update profiles set timezone = 'Pacific/Kiritimati';
select is(public.toggle_farming_check('fa000000-0000-0000-0000-000000000001', true), true,
  'check the daily task in Pacific/Kiritimati');
update profiles set timezone = 'Pacific/Pago_Pago';
select is(public.toggle_farming_check('fa000000-0000-0000-0000-000000000001', true), true,
  'check it again after moving to Pacific/Pago_Pago');
select results_eq(
  $$ select day from farming_checks where task_id = 'fa000000-0000-0000-0000-000000000001' order by day $$,
  $$ values ((now() at time zone 'Pacific/Pago_Pago')::date), ((now() at time zone 'Pacific/Kiritimati')::date) $$,
  'the earlier check keeps the date it was written with; the new one uses the new timezone');
select is(public.toggle_farming_check('fa000000-0000-0000-0000-000000000001', false), false,
  'uncheck in Pacific/Pago_Pago');
select results_eq(
  $$ select day from farming_checks where task_id = 'fa000000-0000-0000-0000-000000000001' $$,
  $$ values ((now() at time zone 'Pacific/Kiritimati')::date) $$,
  'unchecking only touches today; the earlier day stays checked');

-- 45-50. A once task is checked once, not tied to a day.
update profiles set timezone = 'Pacific/Kiritimati';
select is(public.toggle_farming_check('fa000000-0000-0000-0000-000000000002', true), true,
  'check the once task');
update profiles set timezone = 'Pacific/Pago_Pago';
select is(public.toggle_farming_check('fa000000-0000-0000-0000-000000000002', true), true,
  'checking the once task on another day returns true');
select results_eq(
  $$ select day from farming_checks where task_id = 'fa000000-0000-0000-0000-000000000002' $$,
  $$ values ((now() at time zone 'Pacific/Kiritimati')::date) $$,
  'a once task checked on two days keeps one row, the first one');
select is(public.toggle_farming_check('fa000000-0000-0000-0000-000000000002', false), false,
  'unchecking the once task on a later day returns false');
select is((select count(*)::int from farming_checks where task_id = 'fa000000-0000-0000-0000-000000000002'), 0,
  'unchecking a once task removes its row whatever its date');
select is(public.toggle_farming_check('fa000000-0000-0000-0000-000000000002', true), true,
  'a once task can be checked again after unchecking');

-- 51-55. Refusals.
select throws_ok($$ select public.toggle_farming_check('fb000000-0000-0000-0000-000000000001', true) $$,
  '42501', null, 'A cannot check B''s task');
select throws_ok($$ select public.toggle_farming_check('fa0000ff-0000-0000-0000-000000000000', true) $$,
  '42501', null, 'an unknown task is refused like a foreign one');
select throws_ok($$ select public.toggle_farming_check('fa000000-0000-0000-0000-000000000003', true) $$,
  '22023', null, 'an archived task cannot be checked');
select throws_ok($$ select public.toggle_farming_check('fa000000-0000-0000-0000-000000000004', true) $$,
  '22023', null, 'a task of a stopped (archived) farming project cannot be checked');
select throws_ok($$ select public.toggle_farming_check('fa000000-0000-0000-0000-000000000001', null) $$,
  '22023', null, 'a null p_done is refused');
reset role;

-- 56. B's check was not affected by any of A's toggles.
select results_eq(
  $$ select task_id::text, day from farming_checks where user_id = '66666666-6666-6666-6666-666666666666' $$,
  $$ values ('fb000000-0000-0000-0000-000000000001'::text, date '2026-10-01') $$,
  'B''s check is unchanged');

-- ---------- starting to farm again: the startFarming contract of Plan 8 Task 3 ----------
-- A new project is a plain insert of (user_id, project_id), covered by the limit tests below. Resuming a stopped one
-- is update(archived_at = null): the column grants refuse an upsert, which also writes archived_at and the key columns.
-- 57-58.
set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}';
select lives_ok(
  $$ update farming_projects set archived_at = null where project_id = 'eeeeeeee-0000-0000-0000-000000000002' $$,
  'A can resume a stopped farming project');
select ok(public.toggle_farming_check('fa000000-0000-0000-0000-000000000004', true),
  'a task of the resumed project can be checked again');
reset role;

-- ---------- limits: 50 active projects per member, 30 active tasks per project ----------
insert into projects (id, slug, name, name_key, first_seen, last_seen)
select ('dddddddd-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid, 'limit-' || i, 'Limit ' || i, 'limit' || i, now(), now()
from generate_series(1, 52) i;

set local role authenticated;
set local request.jwt.claims = '{"sub":"77777777-7777-7777-7777-777777777777","role":"authenticated"}';

-- 59-64. Projects.
select lives_ok(
  $$ insert into farming_projects (user_id, project_id)
     select '77777777-7777-7777-7777-777777777777', ('dddddddd-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid
     from generate_series(1, 50) i $$,
  'C can farm 50 projects');
select throws_ok(
  $$ insert into farming_projects (user_id, project_id)
     values ('77777777-7777-7777-7777-777777777777', 'dddddddd-0000-0000-0000-000000000051') $$,
  '23514', null, 'the 51st active farming project is rejected');
select lives_ok(
  $$ update farming_projects set archived_at = now() where project_id = 'dddddddd-0000-0000-0000-000000000050' $$,
  'C can stop farming a project');
select lives_ok(
  $$ insert into farming_projects (user_id, project_id)
     values ('77777777-7777-7777-7777-777777777777', 'dddddddd-0000-0000-0000-000000000051') $$,
  'a stopped project frees a slot');
select throws_ok(
  $$ update farming_projects set archived_at = null where project_id = 'dddddddd-0000-0000-0000-000000000050' $$,
  '23514', null, 'resuming a stopped project past 50 active is rejected');
select throws_ok(
  $$ update farming_projects set started_at = now() - interval '30 days' where project_id = 'dddddddd-0000-0000-0000-000000000001' $$,
  '42501', null, 'C cannot rewrite started_at');

-- 65-70. Tasks.
select lives_ok(
  $$ insert into farming_tasks (user_id, project_id, text, cadence, origin, position)
     select '77777777-7777-7777-7777-777777777777', 'dddddddd-0000-0000-0000-000000000001', 'Task ' || i, 'daily', 'source', i
     from generate_series(1, 30) i $$,
  'C can have 30 active tasks in one project');
select throws_ok(
  $$ insert into farming_tasks (user_id, project_id, text, cadence, origin)
     values ('77777777-7777-7777-7777-777777777777', 'dddddddd-0000-0000-0000-000000000001', 'Task 31', 'daily', 'custom') $$,
  '23514', null, 'the 31st active task in a project is rejected');
select lives_ok(
  $$ insert into farming_tasks (user_id, project_id, text, cadence, origin)
     values ('77777777-7777-7777-7777-777777777777', 'dddddddd-0000-0000-0000-000000000002', 'Task lain', 'daily', 'custom') $$,
  'the task limit is per project');
select lives_ok(
  $$ update farming_tasks set archived_at = now()
     where project_id = 'dddddddd-0000-0000-0000-000000000001' and text = 'Task 30' $$,
  'C can archive a task');
select lives_ok(
  $$ insert into farming_tasks (user_id, project_id, text, cadence, origin)
     values ('77777777-7777-7777-7777-777777777777', 'dddddddd-0000-0000-0000-000000000001', 'Task 31', 'daily', 'custom') $$,
  'an archived task frees a slot');
select throws_ok(
  $$ update farming_tasks set archived_at = null
     where project_id = 'dddddddd-0000-0000-0000-000000000001' and text = 'Task 30' $$,
  '23514', null, 'restoring an archived task past 30 active is rejected');
reset role;

-- ---------- cascade: a project deleted from the database takes its trackers along (review focus 5) ----------
-- 71-73.
select is((select count(*)::int from farming_checks c join farming_tasks t on t.id = c.task_id
           where t.project_id = 'eeeeeeee-0000-0000-0000-000000000001'), 3,
  'fixtures: p1 has checks from A and B before the delete');
select lives_ok($$ delete from projects where id = 'eeeeeeee-0000-0000-0000-000000000001' $$,
  'deleting a farmed project raises no error');
select results_eq(
  $$ select (select count(*)::int from farming_projects where project_id = 'eeeeeeee-0000-0000-0000-000000000001'),
            (select count(*)::int from farming_tasks where project_id = 'eeeeeeee-0000-0000-0000-000000000001'),
            (select count(*)::int from farming_checks
             where task_id in ('fa000000-0000-0000-0000-000000000001', 'fa000000-0000-0000-0000-000000000002',
                               'fb000000-0000-0000-0000-000000000001')),
            (select count(*)::int from farming_projects where project_id = 'eeeeeeee-0000-0000-0000-000000000002') $$,
  $$ values (0, 0, 0, 1) $$,
  'the deleted project''s farming rows, tasks and checks are gone; other projects stay');

select * from finish();
rollback;
