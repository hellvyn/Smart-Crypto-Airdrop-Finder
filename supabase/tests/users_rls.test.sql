-- pgTAP tests for 0002_users.sql: user tables, RLS and self-service account deletion.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(34);

-- Fixtures (run as the migration/test owner role, which bypasses RLS).
-- user A: 11111111-..., user B: 22222222-...
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'b@example.test');

insert into projects (id, slug, name, name_key, first_seen, last_seen) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'proj-one', 'Proj One', 'projone', now(), now()),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'proj-two', 'Proj Two', 'projtwo', now(), now());

-- A: a-only + shared. B: b-only + shared.
insert into wallets (id, user_id, address, chain_family, label) values
  ('a0000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', '0x00000000000000000000000000000000000000a1', 'evm', 'A only'),
  ('a0000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', '0x00000000000000000000000000000000000000c3', 'evm', 'A shared'),
  ('b0000000-0000-0000-0000-00000000000b', '22222222-2222-2222-2222-222222222222', '0x00000000000000000000000000000000000000b2', 'evm', 'B only'),
  ('b0000000-0000-0000-0000-00000000000c', '22222222-2222-2222-2222-222222222222', '0x00000000000000000000000000000000000000c3', 'evm', 'B shared');

insert into watchlist (user_id, project_id) values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('22222222-2222-2222-2222-222222222222', 'aaaaaaaa-0000-0000-0000-000000000001');

insert into wallet_check_requests (user_id) values
  ('11111111-1111-1111-1111-111111111111'),
  ('11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222');

insert into wallet_checks (address, chain, result) values
  ('0x00000000000000000000000000000000000000a1', 'ethereum', '{"txCount":1}'),
  ('0x00000000000000000000000000000000000000b2', 'ethereum', '{"txCount":2}'),
  ('0x00000000000000000000000000000000000000c3', 'ethereum', '{"txCount":3}');

-- 1-2. Signup trigger created a profile with defaults.
select is((select count(*)::int from profiles), 2, 'profile rows were created automatically on signup');
select results_eq(
  $$ select plan, digest_enabled, new_airdrops_opt_in, timezone, unsubscribe_token is not null
     from profiles where user_id = '11111111-1111-1111-1111-111111111111' $$,
  $$ values ('free'::text, true, false, 'UTC'::text, true) $$,
  'profile has the documented defaults');

-- 3. Addresses must be stored lowercase.
select throws_ok(
  $$ insert into wallets (user_id, address, chain_family)
     values ('11111111-1111-1111-1111-111111111111', '0x00000000000000000000000000000000000000AA', 'evm') $$,
  '23514', null, 'mixed-case wallet address is rejected by the check constraint');

-- 4. unique (user_id, address)
select throws_ok(
  $$ insert into wallets (user_id, address, chain_family)
     values ('11111111-1111-1111-1111-111111111111', '0x00000000000000000000000000000000000000a1', 'evm') $$,
  '23505', null, 'duplicate wallet for the same user is rejected');

-- 5. chain_family check
select throws_ok(
  $$ insert into wallets (user_id, address, chain_family)
     values ('11111111-1111-1111-1111-111111111111', '0x00000000000000000000000000000000000000a9', 'solana') $$,
  '23514', null, 'non-evm chain_family is rejected');

-- ---------- anon ----------
set local role anon;
select throws_ok($$ select * from profiles $$, '42501', null, 'anon cannot select profiles');
select throws_ok($$ select * from wallets $$, '42501', null, 'anon cannot select wallets');
select throws_ok($$ select * from watchlist $$, '42501', null, 'anon cannot select watchlist');
select throws_ok(
  $$ select * from public.get_wallet_check('a0000000-0000-0000-0000-00000000000a', 'ethereum') $$,
  '42501', null, 'anon cannot execute get_wallet_check');
select throws_ok($$ select public.delete_my_account() $$, '42501', null, 'anon cannot execute delete_my_account');
reset role;

-- ---------- user A ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select is((select count(*)::int from wallets), 2, 'A sees only their own 2 wallets');
select is((select count(*)::int from wallets where user_id = '22222222-2222-2222-2222-222222222222'), 0,
  'A cannot select wallets owned by B');
select is((select count(*)::int from profiles), 1, 'A sees only their own profile');
select is((select count(*)::int from watchlist), 1, 'A sees only their own watchlist');
select is((select count(*)::int from wallet_check_requests), 2, 'A sees only their own requests');

select throws_ok(
  $$ insert into watchlist (user_id, project_id)
     values ('22222222-2222-2222-2222-222222222222', 'aaaaaaaa-0000-0000-0000-000000000002') $$,
  '42501', null, 'A cannot insert a watchlist row for B');
select lives_ok(
  $$ insert into watchlist (user_id, project_id)
     values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000002') $$,
  'A can insert their own watchlist row');
select throws_ok(
  $$ insert into wallets (user_id, address, chain_family)
     values ('22222222-2222-2222-2222-222222222222', '0x00000000000000000000000000000000000000d4', 'evm') $$,
  '42501', null, 'A cannot insert a wallet for B');
select lives_ok(
  $$ insert into wallet_check_requests (user_id) values ('11111111-1111-1111-1111-111111111111') $$,
  'A can log their own check request');
select throws_ok(
  $$ insert into wallet_check_requests (user_id) values ('22222222-2222-2222-2222-222222222222') $$,
  '42501', null, 'A cannot log a check request for B');

-- Deleting B's wallet by id is a silent no-op (asserted below: B still has both wallets after A is gone).
delete from wallets where id = 'b0000000-0000-0000-0000-00000000000b';
select throws_ok($$ update profiles set plan = 'pro' $$, '42501', null, 'A cannot change their own plan');
select lives_ok($$ update profiles set timezone = 'Asia/Jakarta' $$, 'A can change their timezone');

select throws_ok($$ select * from wallet_checks $$, '42501', null, 'A cannot read wallet_checks directly');

select is((select count(*)::int from public.get_wallet_check('a0000000-0000-0000-0000-00000000000a', 'ethereum')), 1,
  'A can read the cached check of their own wallet');
select is((select count(*)::int from public.get_wallet_check('b0000000-0000-0000-0000-00000000000b', 'ethereum')), 0,
  'A gets no rows for B''s wallet');
select throws_ok(
  $$ select public.save_wallet_check('b0000000-0000-0000-0000-00000000000b', 'ethereum', '{"txCount":99}') $$,
  null, null, 'A cannot save a check for B''s wallet');
select lives_ok(
  $$ select public.save_wallet_check('a0000000-0000-0000-0000-00000000000a', 'base', '{"txCount":7}') $$,
  'A can save a check for their own wallet');

-- Unauthenticated JWT (no sub) cannot delete anything.
set local request.jwt.claims = '{"role":"authenticated"}';
select throws_ok($$ select public.delete_my_account() $$, null, null, 'delete_my_account raises without auth.uid()');
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select lives_ok($$ select public.delete_my_account() $$, 'A can delete their own account');
reset role;

-- ---------- after A deleted their account (back as owner) ----------
select is(
  (select count(*)::int from auth.users where id = '11111111-1111-1111-1111-111111111111')
  + (select count(*)::int from profiles where user_id = '11111111-1111-1111-1111-111111111111')
  + (select count(*)::int from wallets where user_id = '11111111-1111-1111-1111-111111111111')
  + (select count(*)::int from watchlist where user_id = '11111111-1111-1111-1111-111111111111')
  + (select count(*)::int from wallet_check_requests where user_id = '11111111-1111-1111-1111-111111111111'),
  0, 'all of A''s rows are gone');
select results_eq(
  $$ select (select count(*)::int from profiles where user_id = '22222222-2222-2222-2222-222222222222'),
            (select count(*)::int from wallets where user_id = '22222222-2222-2222-2222-222222222222'),
            (select count(*)::int from watchlist where user_id = '22222222-2222-2222-2222-222222222222'),
            (select count(*)::int from wallet_check_requests where user_id = '22222222-2222-2222-2222-222222222222') $$,
  $$ values (1, 2, 1, 1) $$,
  'B''s data is intact');
select is(
  (select count(*)::int from wallet_checks where address = '0x00000000000000000000000000000000000000a1'), 0,
  'cache rows for addresses only A had are removed (including the base-chain row A saved)');
select is(
  (select count(*)::int from wallet_checks where address = '0x00000000000000000000000000000000000000c3'), 1,
  'cache row for an address B also has is kept');
select is(
  (select count(*)::int from wallet_checks where address = '0x00000000000000000000000000000000000000b2'), 1,
  'cache row for B''s own address is kept');

select * from finish();
rollback;
