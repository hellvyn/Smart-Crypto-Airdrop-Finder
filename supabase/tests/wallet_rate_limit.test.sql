-- pgTAP tests for 0004_wallet_rate_limit.sql: claim_wallet_check() allows 10 wallet checks per user per hour.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(16);

-- Fixtures (run as the migration/test owner role, which bypasses RLS).
-- user C: 33333333-..., user D: 44444444-...
insert into auth.users (id, email) values
  ('33333333-3333-3333-3333-333333333333', 'c@example.test'),
  ('44444444-4444-4444-4444-444444444444', 'd@example.test');

-- Requests older than the one-hour window do not count.
insert into wallet_check_requests (user_id, created_at) values
  ('33333333-3333-3333-3333-333333333333', now() - interval '61 minutes'),
  ('33333333-3333-3333-3333-333333333333', now() - interval '2 hours');

-- 1-3. Function shape: security definer, empty search_path, no execute for public/anon.
select is(
  (select prosecdef from pg_proc where oid = 'public.claim_wallet_check()'::regprocedure), true,
  'claim_wallet_check is security definer');
select ok(
  (select proconfig @> array['search_path=""'] from pg_proc where oid = 'public.claim_wallet_check()'::regprocedure),
  'claim_wallet_check pins an empty search_path');
select is(
  has_function_privilege('anon', 'public.claim_wallet_check()', 'execute'), false,
  'anon holds no execute privilege on claim_wallet_check');

-- 4. anon is denied.
set local role anon;
select throws_ok($$ select public.claim_wallet_check() $$, '42501', null, 'anon cannot execute claim_wallet_check');
reset role;

-- 5. An authenticated role without a user id is refused.
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated"}';
select throws_ok($$ select public.claim_wallet_check() $$, '42501', 'not authenticated',
  'a caller without auth.uid() is refused');
reset role;

-- 6-10. user C: 10 claims succeed, the 11th and later fail.
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

select is(
  (select array_agg(public.claim_wallet_check()) from generate_series(1, 10)),
  array_fill(true, array[10]),
  'the first 10 claims in the hour succeed');
select is(public.claim_wallet_check(), false, 'the 11th claim in the hour fails');
select is(public.claim_wallet_check(), false, 'a 12th claim fails too');
select is(
  (select count(*)::int from wallet_check_requests where created_at >= now() - interval '1 hour'), 10,
  'a refused claim records no request (only 10 in the window)');
select is((select count(*)::int from wallet_check_requests), 12, 'C sees their 10 new plus 2 old requests');
reset role;

-- 11-13. user D is not affected by C's usage.
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
select is(public.claim_wallet_check(), true, 'another user can still claim');
select is((select count(*)::int from wallet_check_requests), 1, 'D sees only their own single request');
select is(
  (select array_agg(public.claim_wallet_check()) from generate_series(1, 10)),
  array[true, true, true, true, true, true, true, true, true, false],
  'D also gets exactly 10 claims');
reset role;

-- 14-16. Requests are recorded for the caller only (checked as owner).
select is(
  (select count(*)::int from wallet_check_requests where user_id = '33333333-3333-3333-3333-333333333333'
     and created_at >= now() - interval '1 hour'), 10,
  'C has exactly 10 requests in the window');
select is(
  (select count(*)::int from wallet_check_requests where user_id = '44444444-4444-4444-4444-444444444444'), 10,
  'D has exactly 10 requests');
select is(
  has_function_privilege('authenticated', 'public.claim_wallet_check()', 'execute'), true,
  'authenticated may execute claim_wallet_check');

select * from finish();
rollback;
