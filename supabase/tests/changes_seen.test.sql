-- pgTAP tests for 0014_changes_seen.sql (Plan 6 Task 7, "Perubahan sejak kunjungan terakhir"):
-- - project_changes: anon has no privilege at all; a member reads only the changes of projects on their own watchlist.
-- - project_changes.recorded_at: when the row was written (a run's rows share changed_at = the run's start).
-- - profiles.changes_seen_at: a member may update it on their own row only, and the stored value is always the
--   server's now(), whatever the writer sent.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(30);

-- Fixtures (run as the migration/test owner role, which bypasses RLS).
-- user A: c5000000-...-00000000000a, user B: c5000000-...-00000000000b.
insert into auth.users (id, email) values
  ('c5000000-0000-4000-8000-00000000000a', 'cs-a@example.test'),
  ('c5000000-0000-4000-8000-00000000000b', 'cs-b@example.test');

insert into projects (id, slug, name, name_key, first_seen, last_seen) values
  -- 1: on A's watchlist only. 2: on B's watchlist only. 3: on nobody's.
  ('c5000000-0000-4000-8000-000000000001', 'cs-one', 'CS One', 'csone', now(), now()),
  ('c5000000-0000-4000-8000-000000000002', 'cs-two', 'CS Two', 'cstwo', now(), now()),
  ('c5000000-0000-4000-8000-000000000003', 'cs-three', 'CS Three', 'csthree', now(), now());

insert into watchlist (user_id, project_id) values
  ('c5000000-0000-4000-8000-00000000000a', 'c5000000-0000-4000-8000-000000000001'),
  ('c5000000-0000-4000-8000-00000000000b', 'c5000000-0000-4000-8000-000000000002');

insert into project_changes (project_id, field, old_value, new_value, changed_at) values
  ('c5000000-0000-4000-8000-000000000001', 'curated', 'true', 'false', '2026-10-10T23:00:00Z'),
  ('c5000000-0000-4000-8000-000000000001', 'status', 'live', 'ended', '2026-10-10T23:00:00Z'),
  ('c5000000-0000-4000-8000-000000000002', 'risk_level', 'low', 'high', '2026-10-10T23:00:00Z'),
  ('c5000000-0000-4000-8000-000000000003', 'curated', null, 'true', '2026-10-10T23:00:00Z');

-- ---------- shape ----------
-- 1-2.
select col_type_is('public', 'profiles', 'changes_seen_at', 'timestamp with time zone',
  'profiles.changes_seen_at is a timestamptz');
select col_is_null('public', 'profiles', 'changes_seen_at',
  'changes_seen_at is null until the member marks the changes seen');
-- 3-4. recorded_at: the write time, set by the database (the pipeline does not send it).
select col_type_is('public', 'project_changes', 'recorded_at', 'timestamp with time zone',
  'project_changes.recorded_at is a timestamptz');
select results_eq(
  $$ select count(*)::int, bool_and(recorded_at = now()) from project_changes
     where project_id::text like 'c5000000-%' $$,
  $$ values (4, true) $$,
  'a change written without recorded_at gets the time it was written, not its changed_at');
-- 5.
select col_not_null('public', 'project_changes', 'recorded_at', 'recorded_at is never null');

-- ---------- privileges ----------
-- 6. anon holds no privilege on project_changes; authenticated holds SELECT only.
select results_eq(
  $$ select r, p from unnest(array['anon', 'authenticated']) r,
       unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
     where has_table_privilege(r, 'public.project_changes', p) order by 1, 2 $$,
  $$ values ('authenticated'::text, 'SELECT'::text) $$,
  'project_changes: anon has nothing, authenticated may only select');
-- 7.
select policies_are('public', 'project_changes', array['watched project changes read'],
  'project_changes has one policy: a member reads the changes of watched projects');
-- 8.
select results_eq(
  $$ select polcmd::text, polroles::regrole[]::text[] from pg_policy
     where polrelid = 'public.project_changes'::regclass $$,
  $$ values ('r'::text, array['authenticated']::text[]) $$,
  'the policy is for select, to authenticated only');
-- 9. profiles: authenticated may update timezone and changes_seen_at, nothing else; anon has nothing.
select results_eq(
  $$ select c, has_column_privilege('authenticated', 'public.profiles', c, 'UPDATE')
     from unnest(array['changes_seen_at', 'plan', 'timezone', 'user_id']) c order by 1 $$,
  $$ values ('changes_seen_at'::text, true), ('plan', false), ('timezone', true), ('user_id', false) $$,
  'authenticated may update changes_seen_at and timezone only');
-- 10.
select results_eq(
  $$ select has_any_column_privilege('anon', 'public.profiles', 'SELECT'),
            has_any_column_privilege('anon', 'public.profiles', 'UPDATE'),
            has_any_column_privilege('anon', 'public.profiles', 'INSERT') $$,
  $$ values (false, false, false) $$,
  'anon still has no privilege on any profiles column');
-- 11. The stamping trigger function: no search_path surprises, not callable by the web roles.
select results_eq(
  $$ select p.prosecdef, array_to_string(p.proconfig, ',') collate "default",
            has_function_privilege('anon', p.oid, 'EXECUTE'), has_function_privilege('authenticated', p.oid, 'EXECUTE')
     from pg_proc p where p.proname = 'stamp_changes_seen_at' and p.pronamespace = 'public'::regnamespace $$,
  $$ values (false, 'search_path=""'::text, false, false) $$,
  'stamp_changes_seen_at() is security invoker, has an empty search_path, and the web roles cannot execute it');

-- ---------- anon ----------
set local role anon;
-- 12-13.
select throws_ok($$ select * from project_changes $$, '42501', null, 'anon cannot read project_changes');
select throws_ok($$ select changes_seen_at from profiles $$, '42501', null, 'anon cannot read profiles');
reset role;

-- ---------- member A ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"c5000000-0000-4000-8000-00000000000a","role":"authenticated"}';
-- 14.
select results_eq(
  $$ select project_id, field from project_changes where project_id::text like 'c5000000-%' order by field $$,
  $$ values ('c5000000-0000-4000-8000-000000000001'::uuid, 'curated'::text),
            ('c5000000-0000-4000-8000-000000000001'::uuid, 'status'::text) $$,
  'A reads exactly the changes of the project on A''s watchlist');
-- 15.
select is(
  (select count(*)::int from project_changes where project_id = 'c5000000-0000-4000-8000-000000000002'), 0,
  'A cannot read the changes of a project that only B watches');
-- 16.
select is(
  (select count(*)::int from project_changes where project_id = 'c5000000-0000-4000-8000-000000000003'), 0,
  'A cannot read the changes of a project nobody watches');
-- 17-19. No writes.
select throws_ok(
  $$ insert into project_changes (project_id, field, old_value, new_value, changed_at)
     values ('c5000000-0000-4000-8000-000000000001', 'status', 'ended', 'live', now()) $$,
  '42501', null, 'A cannot insert a change');
select throws_ok($$ update project_changes set new_value = 'live' $$, '42501', null, 'A cannot update a change');
select throws_ok($$ delete from project_changes $$, '42501', null, 'A cannot delete a change');

-- 20-21. changes_seen_at: A sends a far future time; the stored value is the server's now().
select lives_ok(
  $$ update profiles set changes_seen_at = '2099-01-01T00:00:00Z'
     where user_id = 'c5000000-0000-4000-8000-00000000000a' $$,
  'A marks the changes seen');
select is(
  (select changes_seen_at from profiles where user_id = 'c5000000-0000-4000-8000-00000000000a'), now(),
  'the stored changes_seen_at is now(), not the time A sent');
-- 22-23. A cannot touch B's row (RLS: zero rows), nor any other column of their own.
select lives_ok(
  $$ update profiles set changes_seen_at = now() where user_id = 'c5000000-0000-4000-8000-00000000000b' $$,
  'an update of B''s row by A runs but matches nothing');
select throws_ok($$ update profiles set plan = 'pro' $$, '42501', null, 'A cannot update plan');
-- 24.
select throws_ok(
  $$ update profiles set user_id = 'c5000000-0000-4000-8000-00000000000b' $$,
  '42501', null, 'A cannot move their profile to another user');

-- 25. The policy follows the watchlist live: unwatching hides the changes.
delete from watchlist where project_id = 'c5000000-0000-4000-8000-000000000001';
select is(
  (select count(*)::int from project_changes where project_id::text like 'c5000000-%'), 0,
  'after A unwatches the project, A reads none of its changes');
reset role;

-- ---------- member B ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"c5000000-0000-4000-8000-00000000000b","role":"authenticated"}';
-- 26.
select results_eq(
  $$ select project_id, field from project_changes where project_id::text like 'c5000000-%' $$,
  $$ values ('c5000000-0000-4000-8000-000000000002'::uuid, 'risk_level'::text) $$,
  'B reads only the change of the project on B''s watchlist');
-- 27.
select is(
  (select changes_seen_at from profiles where user_id = 'c5000000-0000-4000-8000-00000000000b'), null,
  'B''s changes_seen_at is untouched by A');
reset role;

-- ---------- every writer ----------
-- 28-29. Every writer is stamped, the owner role (as the service role would) included.
update profiles set changes_seen_at = '2000-01-01T00:00:00Z' where user_id = 'c5000000-0000-4000-8000-00000000000b';
select is(
  (select changes_seen_at from profiles where user_id = 'c5000000-0000-4000-8000-00000000000b'), now(),
  'any writer gets now(), not the time it sent');
update profiles set changes_seen_at = null where user_id = 'c5000000-0000-4000-8000-00000000000a';
select is(
  (select changes_seen_at from profiles where user_id = 'c5000000-0000-4000-8000-00000000000a'), now(),
  'setting it to null also stamps now() (there is no "unseen" state to go back to)');
-- 30.
update profiles set timezone = 'Asia/Jakarta' where user_id = 'c5000000-0000-4000-8000-00000000000b';
select is(
  (select timezone from profiles where user_id = 'c5000000-0000-4000-8000-00000000000b'), 'Asia/Jakarta',
  'an update of another column works as before');

select * from finish();
rollback;
