-- pgTAP tests for 0005_notifications.sql: notification_log (service-role only) and public.unsubscribe_digest(uuid).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(24);

-- Fixtures (run as the migration/test owner role, which bypasses RLS).
-- user E: eeeeeeee-..., user F: ffffffff-...
insert into auth.users (id, email) values
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'e@example.test'),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'f@example.test');
update profiles set unsubscribe_token = 'e0e0e0e0-0000-4000-8000-000000000001'
  where user_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
update profiles set unsubscribe_token = 'f0f0f0f0-0000-4000-8000-000000000002'
  where user_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

insert into notification_log (user_id, kind, ref_date) values
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'digest', '2026-10-10');

-- 1-3. Table shape.
select is(
  (select relrowsecurity from pg_class where oid = 'public.notification_log'::regclass), true,
  'notification_log has row level security enabled');
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'notification_log'), 0,
  'notification_log has no policies (service role only)');
select has_index('public', 'notification_log', 'notification_log_kind_ref_date_idx',
  'notification_log is indexed on (kind, ref_date)');

-- 4-5. Constraints.
select throws_ok(
  $$ insert into notification_log (user_id, kind, ref_date)
     values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'digest', '2026-10-10') $$,
  '23505', null, 'a second digest for the same user and date is a unique violation');
select throws_ok(
  $$ insert into notification_log (user_id, kind, ref_date)
     values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'newsletter', '2026-10-11') $$,
  '23514', null, 'an unknown kind is rejected by the check constraint');

-- 6-9. Function shape.
select is(
  (select prosecdef from pg_proc where oid = 'public.unsubscribe_digest(uuid)'::regprocedure), true,
  'unsubscribe_digest is security definer');
select ok(
  (select proconfig @> array['search_path=""'] from pg_proc where oid = 'public.unsubscribe_digest(uuid)'::regprocedure),
  'unsubscribe_digest pins an empty search_path');
select is(
  has_function_privilege('anon', 'public.unsubscribe_digest(uuid)', 'execute'), true,
  'anon may execute unsubscribe_digest');
select is(
  has_function_privilege('authenticated', 'public.unsubscribe_digest(uuid)', 'execute'), true,
  'authenticated may execute unsubscribe_digest');

-- 10-16. Unsubscribe as anon (the email link is followed by a logged-out visitor).
set local role anon;
select is(public.unsubscribe_digest('e0e0e0e0-0000-4000-8000-000000000001'), true, 'a valid token returns true');
select is(public.unsubscribe_digest('e0e0e0e0-0000-4000-8000-000000000001'), true,
  'repeating the call is idempotent and still returns true');
select is(public.unsubscribe_digest('99999999-9999-4999-8999-999999999999'), false, 'an unknown token returns false');
select is(public.unsubscribe_digest(null), false, 'a null token returns false');

-- 14-15. anon cannot touch the log.
select throws_ok(
  $$ insert into notification_log (user_id, kind, ref_date)
     values ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'digest', '2026-10-10') $$,
  '42501', null, 'anon cannot insert into notification_log');
select throws_ok($$ select * from notification_log $$, '42501', null, 'anon cannot select from notification_log');
reset role;

-- 16-17. Only the matching profile changed; the unsubscribe stays off after the second call.
select is(
  (select digest_enabled from profiles where user_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'), false,
  'the token owner has digest_enabled = false (and it stays false after a repeat call)');
select is(
  (select digest_enabled from profiles where user_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'), true,
  'other users are untouched');

-- 18-20. authenticated is locked out of the log too.
set local role authenticated;
set local request.jwt.claims = '{"sub":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee","role":"authenticated"}';
select throws_ok($$ select * from notification_log $$, '42501', null, 'authenticated cannot select from notification_log');
select throws_ok(
  $$ insert into notification_log (user_id, kind, ref_date)
     values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'digest', '2026-10-12') $$,
  '42501', null, 'authenticated cannot insert into notification_log');
select throws_ok($$ delete from notification_log $$, '42501', null, 'authenticated cannot delete from notification_log');
reset role;

-- 21-22. A signed-in user can use the function too, and it only flips the matching profile.
set local role authenticated;
set local request.jwt.claims = '{"sub":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee","role":"authenticated"}';
select is(public.unsubscribe_digest('f0f0f0f0-0000-4000-8000-000000000002'), true, 'authenticated can unsubscribe by token');
reset role;
select is(
  (select digest_enabled from profiles where user_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'), false,
  'the token owner F is now unsubscribed');

-- 23-24. Deleting the auth user cascades to the log.
select is((select count(*)::int from notification_log where user_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'), 1,
  'E has one log row before deletion');
delete from auth.users where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
select is((select count(*)::int from notification_log where user_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'), 0,
  'deleting the auth user cascades to notification_log');

select * from finish();
rollback;
