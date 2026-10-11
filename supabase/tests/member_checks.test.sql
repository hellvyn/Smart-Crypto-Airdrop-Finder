-- pgTAP tests for 0013_member_checks.sql (Plan 6 Task 5; decisions #53, #54): what each risk check looked at is
-- member-only for the advanced checks. anon loses risk_assessments.checks and reads public_risk_checks instead: the 4 key
-- checks with their detail, the other checks as id, ran and flagged only. Members keep reading the whole table.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(27);

-- Fixtures (run as the migration/test owner role, which bypasses RLS). Project ids end in the project number.
insert into projects (id, slug, name, name_key, status, chains, first_seen, last_seen) values
  -- 1: an older assessment, then the latest one with details and two warnings (a hack, an AI scam pattern).
  ('c2000000-0000-4000-8000-000000000001', 'mc-full', 'MC Full', 'mcfull', 'live', '{}', now(), now()),
  -- 2: a row stored before details existed; one advanced entry has no ran, one has a ran that is not a boolean.
  ('c2000000-0000-4000-8000-000000000002', 'mc-old', 'MC Old', 'mcold', 'live', '{}', now(), now()),
  -- 3: checks and reasons that are not arrays.
  ('c2000000-0000-4000-8000-000000000003', 'mc-broken', 'MC Broken', 'mcbroken', 'live', '{}', now(), now()),
  -- 4: two assessments with the same computed_at: the one inserted last (greater seq) is the latest.
  ('c2000000-0000-4000-8000-000000000004', 'mc-tie', 'MC Tie', 'mctie', 'live', '{}', now(), now()),
  -- 5: never assessed.
  ('c2000000-0000-4000-8000-000000000005', 'mc-none', 'MC None', 'mcnone', 'live', '{}', now(), now());

insert into risk_assessments (project_id, level, points, reasons, checks, computed_at) values
  ('c2000000-0000-4000-8000-000000000001', 'critical', 100, '[]',
   '[{"id": "hack_history", "ran": true, "detail": {"count": 9}}]', now() - interval '2 days'),
  ('c2000000-0000-4000-8000-000000000001', 'medium', 20,
   '[{"code": "hack_history", "severity": "medium", "message": "Project ini punya 1 catatan hack.", "source": "defillama"},
     {"code": "ai_scam_pattern", "severity": "medium", "message": "Analisis AI: teks sumber menekan pembaca.", "source": "ai"}]',
   '[{"id": "dangerous_asks", "ran": true, "detail": {"sources": 4}},
     {"id": "phishing_list", "ran": true, "detail": {"checked": 8, "hits": 0}},
     {"id": "domain_age", "ran": true, "detail": {"domain": "mc.test", "ageDays": 812}},
     {"id": "lookalike", "ran": true, "detail": {"compared": 1240}},
     {"id": "token_security", "ran": false},
     {"id": "contract_verified", "ran": false},
     {"id": "hack_history", "ran": true, "detail": {"count": 1}},
     {"id": "corroboration", "ran": true, "detail": {"sources": 3}},
     {"id": "ai_review", "ran": true}]',
   now()),
  ('c2000000-0000-4000-8000-000000000002', 'low', 0, '[]',
   '[{"id": "dangerous_asks", "ran": true}, {"id": "lookalike", "ran": false},
     {"id": "hack_history"}, {"id": "corroboration", "ran": "true"}]', now()),
  ('c2000000-0000-4000-8000-000000000003', 'low', 0, '{}', '{"dangerous_asks": true}', now()),
  ('c2000000-0000-4000-8000-000000000004', 'low', 0, '[]',
   '[{"id": "hack_history", "ran": false}]', '2026-10-10T00:00:00Z'),
  ('c2000000-0000-4000-8000-000000000004', 'low', 0, '[]',
   '[{"id": "hack_history", "ran": true, "detail": {"count": 0}}]', '2026-10-10T00:00:00Z');

-- ---------- privileges (as owner) ----------
-- 1-4. anon has no table-level SELECT on risk_assessments any more: every column but checks, explicitly.
select ok(not has_table_privilege('anon', 'public.risk_assessments', 'SELECT'), 'anon has no table-level SELECT on risk_assessments');
select ok(not has_column_privilege('anon', 'public.risk_assessments', 'checks', 'SELECT'), 'anon cannot select risk_assessments.checks');
select ok(
  (select bool_and(has_column_privilege('anon', 'public.risk_assessments', c, 'SELECT'))
   from unnest(array['id', 'project_id', 'level', 'points', 'reasons', 'computed_at', 'seq']) c),
  'anon selects every other risk_assessments column');
select ok(
  has_table_privilege('authenticated', 'public.risk_assessments', 'SELECT'), 'authenticated keeps SELECT on risk_assessments');
-- 5-7. The view: select only, for both web roles; security definer (not security_invoker), owned by postgres.
select table_privs_are('public', 'public_risk_checks', 'anon', array['SELECT'], 'anon may only select public_risk_checks');
select table_privs_are('public', 'public_risk_checks', 'authenticated', array['SELECT'],
  'authenticated may only select public_risk_checks');
select ok(
  (select pg_get_userbyid(c.relowner) = 'postgres' and not coalesce('security_invoker=true' = any(c.reloptions), false)
   from pg_class c where c.oid = 'public.public_risk_checks'::regclass),
  'public_risk_checks is owned by postgres and runs with its rights');

-- ---------- anon ----------
set local role anon;
-- 8-10.
select throws_ok($$ select checks from risk_assessments $$, '42501', null, 'anon cannot read risk_assessments.checks');
select throws_ok($$ select * from risk_assessments $$, '42501', null, 'anon cannot select * from risk_assessments');
select results_eq(
  $$ select level, points, jsonb_array_length(reasons) from risk_assessments
     where project_id = 'c2000000-0000-4000-8000-000000000001' order by computed_at desc limit 1 $$,
  $$ values ('medium'::text, 20, 2) $$,
  'anon still reads the level, points and reasons');
-- 11-12. The key checks of the latest assessment, in stored order, with their detail.
select is(
  (select key_checks from public_risk_checks where project_id = 'c2000000-0000-4000-8000-000000000001'),
  '[{"id": "dangerous_asks", "ran": true, "detail": {"sources": 4}},
    {"id": "phishing_list", "ran": true, "detail": {"checked": 8, "hits": 0}},
    {"id": "domain_age", "ran": true, "detail": {"domain": "mc.test", "ageDays": 812}},
    {"id": "lookalike", "ran": true, "detail": {"compared": 1240}}]'::jsonb,
  'anon reads the 4 key checks with their detail');
select is(
  (select advanced_checks from public_risk_checks where project_id = 'c2000000-0000-4000-8000-000000000001'),
  '[{"id": "token_security", "ran": false, "flagged": false},
    {"id": "contract_verified", "ran": false, "flagged": false},
    {"id": "hack_history", "ran": true, "flagged": true},
    {"id": "corroboration", "ran": true, "flagged": false},
    {"id": "ai_review", "ran": true, "flagged": true}]'::jsonb,
  'anon reads the advanced checks as id, ran and flagged (flagged = a warning of that check)');
-- 13.
select is(
  (select count(*)::int from public_risk_checks, jsonb_array_elements(advanced_checks) a
   where project_id::text like 'c2000000-%' and a ? 'detail'),
  0, 'no advanced check carries its detail');
-- 14-15. A row without details keeps its key checks without inventing one; ran is true only for the boolean true.
select is(
  (select key_checks from public_risk_checks where project_id = 'c2000000-0000-4000-8000-000000000002'),
  '[{"id": "dangerous_asks", "ran": true}, {"id": "lookalike", "ran": false}]'::jsonb,
  'an old row has key checks without detail');
select is(
  (select advanced_checks from public_risk_checks where project_id = 'c2000000-0000-4000-8000-000000000002'),
  '[{"id": "hack_history", "ran": false, "flagged": false}, {"id": "corroboration", "ran": false, "flagged": false}]'::jsonb,
  'a missing or non-boolean ran counts as not run');
-- 16-18.
select results_eq(
  $$ select key_checks, advanced_checks from public_risk_checks where project_id = 'c2000000-0000-4000-8000-000000000003' $$,
  $$ values ('[]'::jsonb, '[]'::jsonb) $$,
  'checks that are not an array give no entries');
select is(
  (select advanced_checks from public_risk_checks where project_id = 'c2000000-0000-4000-8000-000000000004'),
  '[{"id": "hack_history", "ran": true, "flagged": false}]'::jsonb,
  'a computed_at tie is broken by the greater seq');
select is(
  (select count(*)::int from public_risk_checks where project_id = 'c2000000-0000-4000-8000-000000000005'), 0,
  'a project without an assessment has no row');
-- 19.
select is(
  (select assessment_id from public_risk_checks where project_id = 'c2000000-0000-4000-8000-000000000001'),
  (select id from risk_assessments where project_id = 'c2000000-0000-4000-8000-000000000001' and level = 'medium'),
  'the row names the latest assessment');
-- 20-21. The older views anon reads still work without the checks column.
select is(
  (select latest_risk_level from project_list where slug = 'mc-full'), 'medium', 'anon still reads project_list');
select throws_ok(
  $$ insert into public_risk_checks (project_id) values ('c2000000-0000-4000-8000-000000000005') $$,
  '55000', null, 'public_risk_checks cannot be written at all (and anon holds SELECT only, test 5)');
reset role;

-- ---------- authenticated ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"c2000000-0000-4000-8000-00000000aaaa","role":"authenticated"}';
-- 22-24.
select is(
  (select checks->6 from risk_assessments
   where project_id = 'c2000000-0000-4000-8000-000000000001' order by computed_at desc limit 1),
  '{"id": "hack_history", "ran": true, "detail": {"count": 1}}'::jsonb,
  'authenticated reads every check with its detail');
select is(
  (select jsonb_array_length(advanced_checks) from public_risk_checks where project_id = 'c2000000-0000-4000-8000-000000000001'),
  5, 'authenticated reads public_risk_checks too');
select throws_ok($$ delete from risk_assessments $$, '42501', null, 'authenticated cannot delete risk_assessments');
reset role;

-- ---------- the view's warning map is core's CHECK_OF_REASON (apps/web/test checks the list itself) ----------
-- 25-27. One warning per check kind flags its check, as anon sees it.
update risk_assessments set reasons = '[{"code": "single_source", "severity": "medium", "message": "m", "source": "heuristic"},
                                        {"code": "unverified_contract", "severity": "medium", "message": "m", "source": "blockscout"}]',
                            checks = '[{"id": "corroboration", "ran": true}, {"id": "contract_verified", "ran": true},
                                       {"id": "hack_history", "ran": true}]'
  where project_id = 'c2000000-0000-4000-8000-000000000002';
set local role anon;
select is(
  (select a->'flagged' from public_risk_checks, jsonb_array_elements(advanced_checks) a
   where project_id = 'c2000000-0000-4000-8000-000000000002' and a->>'id' = 'corroboration'),
  'true'::jsonb, 'single_source flags corroboration');
select is(
  (select a->'flagged' from public_risk_checks, jsonb_array_elements(advanced_checks) a
   where project_id = 'c2000000-0000-4000-8000-000000000002' and a->>'id' = 'contract_verified'),
  'true'::jsonb, 'unverified_contract flags contract_verified');
select is(
  (select a->'flagged' from public_risk_checks, jsonb_array_elements(advanced_checks) a
   where project_id = 'c2000000-0000-4000-8000-000000000002' and a->>'id' = 'hack_history'),
  'false'::jsonb, 'a check without a warning of its own is not flagged');
reset role;

select * from finish();
rollback;
