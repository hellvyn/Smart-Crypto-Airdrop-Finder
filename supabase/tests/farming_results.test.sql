-- pgTAP tests for 0015_farming_results.sql: airdrop results ("Hasil garapan", #51). Owner-only RLS for every
-- operation and no anon access at all; farming_result_stats() hands out only a count and an average (null under 5
-- contributors), never a user id or one person's amount; archived_at on farming_tasks and farming_projects is always
-- the server's now(), so a member cannot backdate it and rewrite past heatmap totals.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(46);

-- Fixtures (run as the migration/test owner role, which bypasses RLS).
-- A: 81..., B: 82..., C-G: 83...-87... (contributors for the stats). Everyone farms p1; only A farms p2.
insert into auth.users (id, email) values
  ('81818181-8181-8181-8181-818181818181', 'ra@example.test'),
  ('82828282-8282-8282-8282-828282828282', 'rb@example.test'),
  ('83838383-8383-8383-8383-838383838383', 'rc@example.test'),
  ('84848484-8484-8484-8484-848484848484', 'rd@example.test'),
  ('85858585-8585-8585-8585-858585858585', 're@example.test'),
  ('86868686-8686-8686-8686-868686868686', 'rf@example.test'),
  ('87878787-8787-8787-8787-878787878787', 'rg@example.test');

insert into projects (id, slug, name, name_key, status, first_seen, last_seen) values
  ('abababab-0000-0000-0000-000000000001', 'result-one', 'Result One', 'resultone', 'ended', now(), now()),
  ('abababab-0000-0000-0000-000000000002', 'result-two', 'Result Two', 'resulttwo', 'ended', now(), now()),
  ('abababab-0000-0000-0000-000000000003', 'result-three', 'Result Three', 'resultthree', 'ended', now(), now());

insert into farming_projects (user_id, project_id)
select u.id, 'abababab-0000-0000-0000-000000000001'::uuid
from auth.users u where u.email like 'r_@example.test';
insert into farming_projects (user_id, project_id) values
  ('81818181-8181-8181-8181-818181818181', 'abababab-0000-0000-0000-000000000002');

insert into farming_tasks (id, user_id, project_id, text, cadence, origin, archived_at) values
  ('ab000000-0000-0000-0000-000000000001', '81818181-8181-8181-8181-818181818181',
   'abababab-0000-0000-0000-000000000002', 'Swap harian', 'daily', 'source', null),
  ('ab000000-0000-0000-0000-000000000002', '81818181-8181-8181-8181-818181818181',
   'abababab-0000-0000-0000-000000000002', 'Task lama', 'daily', 'custom', '2026-01-01T00:00:00Z');

-- B's result on p1: shared, $300. updated_at is old so the update stamp below is visible.
insert into farming_results (user_id, project_id, amount, claimed_on, usd_at_claim, share_anonymous, updated_at) values
  ('82828282-8282-8282-8282-828282828282', 'abababab-0000-0000-0000-000000000001', 3000, date '2026-10-01', 300, true,
   '2020-01-01T00:00:00Z');

-- Rows visible to the current role; a refused read (42501) counts as zero rows, like an RLS filter.
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
-- 1. RLS on.
select is((select relrowsecurity from pg_class where oid = 'public.farming_results'::regclass), true,
  'row level security is enabled on farming_results');

-- 2. The stats function is security definer with an empty search_path.
select results_eq(
  $$ select p.prosecdef, p.proconfig @> array['search_path=""'] from pg_proc p
     where p.oid = 'public.farming_result_stats(uuid)'::regprocedure $$,
  $$ values (true, true) $$,
  'farming_result_stats is security definer with an empty search_path');

-- 3. It returns a count and an average only: no user id, no per-person column.
select is(pg_get_function_result('public.farming_result_stats(uuid)'::regprocedure),
  'TABLE(contributors integer, avg_usd numeric)', 'farming_result_stats returns only contributors and avg_usd');

-- 4. Execute: authenticated only; not anon, not PUBLIC.
select results_eq(
  $$ select has_function_privilege('anon', 'public.farming_result_stats(uuid)', 'execute'),
            has_function_privilege('authenticated', 'public.farming_result_stats(uuid)', 'execute'),
            exists (select 1 from pg_proc p, aclexplode(p.proacl) a
                    where p.oid = 'public.farming_result_stats(uuid)'::regprocedure and a.grantee = 0) $$,
  $$ values (false, true, false) $$,
  'only authenticated may execute farming_result_stats (EXECUTE revoked from PUBLIC and anon)');

-- 5. anon holds no privilege of any kind on the table.
select results_eq(
  $$ select has_table_privilege('anon', 'public.farming_results', 'SELECT'),
            has_table_privilege('anon', 'public.farming_results', 'INSERT'),
            has_table_privilege('anon', 'public.farming_results', 'UPDATE'),
            has_table_privilege('anon', 'public.farming_results', 'DELETE'),
            has_any_column_privilege('anon', 'public.farming_results', 'SELECT'),
            has_any_column_privilege('anon', 'public.farming_results', 'INSERT'),
            has_any_column_privilege('anon', 'public.farming_results', 'UPDATE') $$,
  $$ values (false, false, false, false, false, false, false) $$,
  'anon has no access at all to farming_results');

-- 6. updated_at is the server's: no column grant for the member.
select results_eq(
  $$ select has_column_privilege('authenticated', 'public.farming_results', 'updated_at', 'INSERT'),
            has_column_privilege('authenticated', 'public.farming_results', 'updated_at', 'UPDATE'),
            has_column_privilege('authenticated', 'public.farming_results', 'user_id', 'UPDATE'),
            has_column_privilege('authenticated', 'public.farming_results', 'project_id', 'UPDATE') $$,
  $$ values (false, false, false, false) $$,
  'authenticated cannot write updated_at, nor move a result to another user or project');

-- 7-12. Table constraints.
select throws_ok(
  $$ insert into farming_results (user_id, project_id, amount)
     values ('81818181-8181-8181-8181-818181818181', 'abababab-0000-0000-0000-000000000002', 0) $$,
  '23514', null, 'an amount of 0 is rejected');
select throws_ok(
  $$ insert into farming_results (user_id, project_id, amount)
     values ('81818181-8181-8181-8181-818181818181', 'abababab-0000-0000-0000-000000000002', -5) $$,
  '23514', null, 'a negative amount is rejected');
select throws_ok(
  $$ insert into farming_results (user_id, project_id, amount)
     values ('81818181-8181-8181-8181-818181818181', 'abababab-0000-0000-0000-000000000002', 1e15 + 1) $$,
  '23514', null, 'an amount above 1e15 is rejected');
select throws_ok(
  $$ insert into farming_results (user_id, project_id, no_reward)
     values ('81818181-8181-8181-8181-818181818181', 'abababab-0000-0000-0000-000000000002', false) $$,
  '23514', null, 'a result needs an amount unless it is "Gak dapet"');
select throws_ok(
  $$ insert into farming_results (user_id, project_id, amount, usd_at_claim)
     values ('81818181-8181-8181-8181-818181818181', 'abababab-0000-0000-0000-000000000002', 10, -1) $$,
  '23514', null, 'a negative USD value is rejected');
select throws_ok(
  $$ insert into farming_results (user_id, project_id, amount)
     values ('81818181-8181-8181-8181-818181818181', 'abababab-0000-0000-0000-000000000003', 10) $$,
  '23503', null, 'a result needs a farming project of the same member');

-- 13. The fixture row exists, so zero below means hidden.
select is(pg_temp.visible_rows('public.farming_results'), 1::bigint, 'fixtures: B''s result exists');

-- ---------- anon ----------
set local role anon;
-- 14-18.
select is(pg_temp.visible_rows('public.farming_results'), 0::bigint, 'anon cannot read farming_results');
select throws_ok(
  $$ insert into farming_results (user_id, project_id, amount)
     values ('81818181-8181-8181-8181-818181818181', 'abababab-0000-0000-0000-000000000002', 10) $$,
  '42501', null, 'anon cannot insert a result');
select throws_ok($$ update farming_results set share_anonymous = false $$, '42501', null, 'anon cannot update results');
select throws_ok($$ delete from farming_results $$, '42501', null, 'anon cannot delete results');
select throws_ok($$ select * from public.farming_result_stats('abababab-0000-0000-0000-000000000001') $$,
  '42501', null, 'anon cannot execute farming_result_stats');
reset role;

-- 19. A caller without a user id is refused.
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated"}';
select throws_ok($$ select * from public.farming_result_stats('abababab-0000-0000-0000-000000000001') $$,
  '42501', null, 'farming_result_stats refuses a caller without auth.uid()');
reset role;

-- ---------- user A ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"81818181-8181-8181-8181-818181818181","role":"authenticated"}';

-- 20-21. A cannot read B's result.
select is(pg_temp.visible_rows('public.farming_results'), 0::bigint, 'A sees no result before entering one');
select is((select count(*)::int from farming_results where user_id = '82828282-8282-8282-8282-828282828282'), 0,
  'A cannot select B''s result');

-- 22-25. A cannot write B's result: insert in B's name fails, update and delete touch nothing.
select throws_ok(
  $$ insert into farming_results (user_id, project_id, amount)
     values ('82828282-8282-8282-8282-828282828282', 'abababab-0000-0000-0000-000000000001', 1) $$,
  '42501', null, 'A cannot enter a result in B''s name');
select is_empty(
  $$ update farming_results set amount = 1, usd_at_claim = 999999, share_anonymous = false
     where user_id = '82828282-8282-8282-8282-828282828282' returning 1 $$,
  'A updating B''s result changes no row');
select is_empty(
  $$ delete from farming_results where user_id = '82828282-8282-8282-8282-828282828282' returning 1 $$,
  'A deleting B''s result removes no row');
select throws_ok(
  $$ update farming_results set updated_at = '2020-01-01' where user_id = '81818181-8181-8181-8181-818181818181' $$,
  '42501', null, 'A cannot set updated_at');

-- 26-29. A writes, reads, changes and deletes their own result.
select lives_ok(
  $$ insert into farming_results (user_id, project_id, amount, claimed_on, usd_at_claim)
     values ('81818181-8181-8181-8181-818181818181', 'abababab-0000-0000-0000-000000000002', 1250, date '2026-10-07', 412) $$,
  'A can enter their own result');
select results_eq(
  $$ select amount, usd_at_claim, share_anonymous, no_reward from farming_results $$,
  $$ values (1250::numeric, 412::numeric, false, false) $$,
  'A reads their own result; sharing is off until A opts in');
select results_eq(
  $$ update farming_results set share_anonymous = true, amount = 1300
     where project_id = 'abababab-0000-0000-0000-000000000002' returning amount, share_anonymous $$,
  $$ values (1300::numeric, true) $$,
  'A can change their own result and opt in');
select results_eq(
  $$ delete from farming_results where project_id = 'abababab-0000-0000-0000-000000000002' returning amount $$,
  $$ values (1300::numeric) $$,
  'A can delete their own result');
reset role;

-- 30. B's result survived A's attempts.
select results_eq(
  $$ select amount, usd_at_claim, share_anonymous from farming_results
     where user_id = '82828282-8282-8282-8282-828282828282' $$,
  $$ values (3000::numeric, 300::numeric, true) $$,
  'B''s result is untouched by A''s attempts');

-- 31. updated_at is stamped by the server on every update.
update farming_results set share_anonymous = true where user_id = '82828282-8282-8282-8282-828282828282';
select is((select updated_at from farming_results where user_id = '82828282-8282-8282-8282-828282828282'), now(),
  'updated_at is set to now() on update, whatever the writer sent');

-- ---------- farming_result_stats ----------
-- Contributors on p1: B $300 (shared, above), C $100, D $200 shared; E "Gak dapet" shared (counts as $0);
-- F has no price (usd_at_claim null, not counted); G $1,000,000 but not shared.
insert into farming_results (user_id, project_id, amount, no_reward, claimed_on, usd_at_claim, share_anonymous) values
  ('83838383-8383-8383-8383-838383838383', 'abababab-0000-0000-0000-000000000001', 1000, false, date '2026-10-01', 100, true),
  ('84848484-8484-8484-8484-848484848484', 'abababab-0000-0000-0000-000000000001', 2000, false, date '2026-10-01', 200, true),
  ('85858585-8585-8585-8585-858585858585', 'abababab-0000-0000-0000-000000000001', null, true, null, null, true),
  ('86868686-8686-8686-8686-868686868686', 'abababab-0000-0000-0000-000000000001', 500, false, date '2026-10-01', null, true),
  ('87878787-8787-8787-8787-878787878787', 'abababab-0000-0000-0000-000000000001', 9000, false, date '2026-10-01', 1000000, false);

set local role authenticated;
set local request.jwt.claims = '{"sub":"81818181-8181-8181-8181-818181818181","role":"authenticated"}';

-- 32. 4 contributors (B, C, D, E): no average yet.
select results_eq(
  $$ select contributors, avg_usd from public.farming_result_stats('abababab-0000-0000-0000-000000000001') $$,
  $$ values (4, null::numeric) $$,
  'with 4 contributors avg_usd is null; F (no price) and G (not shared) are not counted');
reset role;

-- A 5th contributor: A shares $400 on p1.
insert into farming_results (user_id, project_id, amount, claimed_on, usd_at_claim, share_anonymous) values
  ('81818181-8181-8181-8181-818181818181', 'abababab-0000-0000-0000-000000000001', 4000, date '2026-10-01', 400, true);

set local role authenticated;
set local request.jwt.claims = '{"sub":"81818181-8181-8181-8181-818181818181","role":"authenticated"}';

-- 33. 5 contributors: (300 + 100 + 200 + 0 + 400) / 5 = 200. G's unshared $1,000,000 would make it 166,833.33.
select results_eq(
  $$ select contributors, avg_usd from public.farming_result_stats('abababab-0000-0000-0000-000000000001') $$,
  $$ values (5, 200.00::numeric) $$,
  'with 5 contributors avg_usd is the average, "Gak dapet" as $0, unshared rows left out');

-- 34. A project nobody entered a result for.
select results_eq(
  $$ select contributors, avg_usd from public.farming_result_stats('abababab-0000-0000-0000-000000000003') $$,
  $$ values (0, null::numeric) $$,
  'a project without results has 0 contributors and no average');

-- 35. Turning sharing off takes the row out again.
update farming_results set share_anonymous = false where project_id = 'abababab-0000-0000-0000-000000000001';
select results_eq(
  $$ select contributors, avg_usd from public.farming_result_stats('abababab-0000-0000-0000-000000000001') $$,
  $$ values (4, null::numeric) $$,
  'a result whose owner turns sharing off is no longer counted');
reset role;

-- ---------- archived_at is the server's now() (controller ruling 3) ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"81818181-8181-8181-8181-818181818181","role":"authenticated"}';

-- 36-38. Archiving a task with a backdated (or future) value stores now().
update farming_tasks set archived_at = '2020-01-01T00:00:00Z' where id = 'ab000000-0000-0000-0000-000000000001';
select is((select archived_at from farming_tasks where id = 'ab000000-0000-0000-0000-000000000001'), now(),
  'a backdated farming_tasks.archived_at is overwritten with now()');
reset role;
-- The stamp applies to every role, the table owner's too.
update farming_tasks set archived_at = '2026-01-01T00:00:00Z' where id = 'ab000000-0000-0000-0000-000000000001';
select isnt((select archived_at from farming_tasks where id = 'ab000000-0000-0000-0000-000000000001'),
  '2026-01-01T00:00:00Z'::timestamptz, 'the owner role cannot backdate archived_at either');
set local role authenticated;
set local request.jwt.claims = '{"sub":"81818181-8181-8181-8181-818181818181","role":"authenticated"}';
update farming_tasks set archived_at = '2999-01-01T00:00:00Z' where id = 'ab000000-0000-0000-0000-000000000001';
select is((select archived_at from farming_tasks where id = 'ab000000-0000-0000-0000-000000000001'), now(),
  'changing an archived task''s archived_at stores now(), not the sent value');

-- 39-40. The same for farming_projects ("Berhenti garap").
update farming_projects set archived_at = '2020-01-01T00:00:00Z'
where user_id = '81818181-8181-8181-8181-818181818181' and project_id = 'abababab-0000-0000-0000-000000000002';
select is((select archived_at from farming_projects
           where user_id = '81818181-8181-8181-8181-818181818181' and project_id = 'abababab-0000-0000-0000-000000000002'),
  now(), 'a backdated farming_projects.archived_at is overwritten with now()');
update farming_projects set archived_at = '2999-01-01T00:00:00Z'
where user_id = '81818181-8181-8181-8181-818181818181' and project_id = 'abababab-0000-0000-0000-000000000002';
select is((select archived_at from farming_projects
           where user_id = '81818181-8181-8181-8181-818181818181' and project_id = 'abababab-0000-0000-0000-000000000002'),
  now(), 'changing a stopped project''s archived_at stores now(), not the sent value');

-- 41. Resuming (archived_at back to null) still works.
select results_eq(
  $$ update farming_projects set archived_at = null
     where user_id = '81818181-8181-8181-8181-818181818181' and project_id = 'abababab-0000-0000-0000-000000000002'
     returning archived_at $$,
  $$ values (null::timestamptz) $$,
  'resuming a stopped project still clears archived_at');

-- 42. An update that leaves archived_at alone keeps it (reordering a task archived on 2026-01-01).
update farming_tasks set position = 5 where id = 'ab000000-0000-0000-0000-000000000002';
select is((select archived_at from farming_tasks where id = 'ab000000-0000-0000-0000-000000000002'),
  '2026-01-01T00:00:00Z'::timestamptz, 'an update of another column leaves archived_at as it was');
reset role;

-- 43-44. The stamping functions are not callable by the web roles.
select results_eq(
  $$ select has_function_privilege('authenticated', 'public.stamp_archived_at()', 'execute'),
            has_function_privilege('anon', 'public.stamp_archived_at()', 'execute') $$,
  $$ values (false, false) $$,
  'stamp_archived_at() is not executable by the web roles');
select results_eq(
  $$ select tgrelid::regclass::text from pg_trigger
     where tgfoid = 'public.stamp_archived_at()'::regprocedure and not tgisinternal order by 1 $$,
  $$ values ('farming_projects'::text), ('farming_tasks'::text) $$,
  'archived_at is stamped on farming_projects and farming_tasks');

-- ---------- cascade ----------
-- 45-46. Deleting a project, or stopping-and-deleting the farming row, takes the results along.
select lives_ok($$ delete from projects where id = 'abababab-0000-0000-0000-000000000001' $$,
  'deleting a project with results raises no error');
select is((select count(*)::int from farming_results where project_id = 'abababab-0000-0000-0000-000000000001'), 0,
  'the deleted project''s results are gone');

select * from finish();
rollback;
