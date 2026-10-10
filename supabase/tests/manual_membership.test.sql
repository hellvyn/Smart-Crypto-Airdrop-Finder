-- pgTAP tests for 0007_manual_membership.sql: the digest/notification objects are gone, and the rest of profiles
-- (RLS, column-level grants, the signup trigger, self-service deletion) is untouched.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(20);

-- Fixtures (run as the migration/test owner role, which bypasses RLS).
-- user G: 33333333-..., user H: 44444444-...
insert into auth.users (id, email) values
  ('33333333-3333-3333-3333-333333333333', 'g@example.test'),
  ('44444444-4444-4444-4444-444444444444', 'h@example.test');

-- 1-2. Removed objects.
select hasnt_table('public', 'notification_log', 'notification_log is dropped');
select hasnt_function('public', 'unsubscribe_digest', array['uuid'], 'unsubscribe_digest(uuid) is dropped');

-- 3-5. Removed columns.
select hasnt_column('public', 'profiles', 'digest_enabled', 'profiles.digest_enabled is dropped');
select hasnt_column('public', 'profiles', 'new_airdrops_opt_in', 'profiles.new_airdrops_opt_in is dropped');
select hasnt_column('public', 'profiles', 'unsubscribe_token', 'profiles.unsubscribe_token is dropped');

-- 6. What remains of profiles.
select columns_are('public', 'profiles', array['user_id', 'plan', 'timezone'],
  'profiles keeps exactly user_id, plan and timezone');

-- 7-9. RLS and grants are intact.
select is((select relrowsecurity from pg_class where oid = 'public.profiles'::regclass), true,
  'profiles still has row level security enabled');
select policies_are('public', 'profiles', array['own profile read', 'own profile update'],
  'profiles keeps its two own-row policies');
select results_eq(
  $$ select has_column_privilege('authenticated', 'public.profiles', 'timezone', 'UPDATE'),
            has_column_privilege('authenticated', 'public.profiles', 'plan', 'UPDATE'),
            has_table_privilege('anon', 'public.profiles', 'SELECT') $$,
  $$ values (true, false, false) $$,
  'authenticated may update timezone only (not plan); anon has no access');

-- 10. The signup trigger still creates a profile, now with only the remaining defaults.
select results_eq(
  $$ select plan, timezone from profiles where user_id = '33333333-3333-3333-3333-333333333333' $$,
  $$ values ('free'::text, 'UTC'::text) $$,
  'a new auth user still gets a profile with the documented defaults');

-- ---------- anon ----------
set local role anon;
select throws_ok($$ select * from profiles $$, '42501', null, 'anon cannot select profiles');
reset role;

-- ---------- user G ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

select is((select count(*)::int from profiles), 1, 'G sees only their own profile');
select lives_ok($$ update profiles set timezone = 'Asia/Jakarta' $$, 'G can change their timezone');
select throws_ok($$ update profiles set plan = 'pro' $$, '42501', null, 'G cannot change their own plan');
select throws_ok($$ select unsubscribe_token from profiles $$, '42703', null, 'the unsubscribe token column no longer exists');
select lives_ok($$ update profiles set timezone = 'Pwned/Zone' where user_id = '44444444-4444-4444-4444-444444444444' $$,
  'G updating H''s profile raises nothing (RLS filters the row)');
reset role;

select is((select timezone from profiles where user_id = '44444444-4444-4444-4444-444444444444'), 'UTC',
  'H''s profile was not changed by G');

-- ---------- self-service account deletion still works ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
select lives_ok($$ select public.delete_my_account() $$, 'G can still delete their own account');
reset role;

select is(
  (select count(*)::int from auth.users where id = '33333333-3333-3333-3333-333333333333')
  + (select count(*)::int from profiles where user_id = '33333333-3333-3333-3333-333333333333'),
  0, 'G''s account and profile are gone');
select is((select count(*)::int from profiles where user_id = '44444444-4444-4444-4444-444444444444'), 1,
  'H''s profile is intact');

select * from finish();
rollback;
