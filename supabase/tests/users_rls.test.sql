-- pgTAP tests for 0002_users.sql: user tables, RLS, per-user wallet cache and self-service account deletion.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(54);

-- Fixtures (run as the migration/test owner role, which bypasses RLS).
-- user A: 11111111-..., user B: 22222222-...
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'b@example.test');

insert into projects (id, slug, name, name_key, first_seen, last_seen) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'proj-one', 'Proj One', 'projone', now(), now()),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'proj-two', 'Proj Two', 'projtwo', now(), now());

-- A: a1 (only A) + c3 (shared address). B: b2 (only B) + c3 (shared address).
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

-- Per-user cache rows; A and B hold different results for the same address c3.
insert into wallet_checks (user_id, address, chain, result) values
  ('11111111-1111-1111-1111-111111111111', '0x00000000000000000000000000000000000000a1', 'ethereum', '{"txCount":1}'),
  ('11111111-1111-1111-1111-111111111111', '0x00000000000000000000000000000000000000c3', 'ethereum', '{"txCount":3}'),
  ('22222222-2222-2222-2222-222222222222', '0x00000000000000000000000000000000000000b2', 'ethereum', '{"txCount":2}'),
  ('22222222-2222-2222-2222-222222222222', '0x00000000000000000000000000000000000000c3', 'ethereum', '{"txCount":33}');

-- 1-2. Signup trigger created a profile with defaults.
select is((select count(*)::int from profiles), 2, 'profile rows were created automatically on signup');
select results_eq(
  $$ select plan, timezone from profiles where user_id = '11111111-1111-1111-1111-111111111111' $$,
  $$ values ('free'::text, 'UTC'::text) $$,
  'profile has the documented defaults');

-- 3-6. Table constraints.
select throws_ok(
  $$ insert into wallets (user_id, address, chain_family)
     values ('11111111-1111-1111-1111-111111111111', '0x00000000000000000000000000000000000000AA', 'evm') $$,
  '23514', null, 'mixed-case wallet address is rejected by the check constraint');
select throws_ok(
  $$ insert into wallets (user_id, address, chain_family)
     values ('11111111-1111-1111-1111-111111111111', '0x00000000000000000000000000000000000000a1', 'evm') $$,
  '23505', null, 'duplicate wallet for the same user is rejected');
select throws_ok(
  $$ insert into wallets (user_id, address, chain_family)
     values ('11111111-1111-1111-1111-111111111111', '0x00000000000000000000000000000000000000a9', 'solana') $$,
  '23514', null, 'non-evm chain_family is rejected');
select throws_ok(
  $$ insert into wallets (user_id, address, chain_family, label)
     values ('11111111-1111-1111-1111-111111111111', '0x00000000000000000000000000000000000000a8', 'evm', repeat('x', 65)) $$,
  '23514', null, 'a label longer than 64 characters is rejected');

-- ---------- anon ----------
set local role anon;
select throws_ok($$ select * from profiles $$, '42501', null, 'anon cannot select profiles');
select throws_ok($$ select * from wallets $$, '42501', null, 'anon cannot select wallets');
select throws_ok($$ select * from watchlist $$, '42501', null, 'anon cannot select watchlist');
select throws_ok($$ select * from wallet_checks $$, '42501', null, 'anon cannot select wallet_checks');
select throws_ok($$ insert into wallet_check_requests (user_id) values ('11111111-1111-1111-1111-111111111111') $$,
  '42501', null, 'anon cannot insert into wallet_check_requests');
select throws_ok(
  $$ select * from public.get_wallet_check('a0000000-0000-0000-0000-00000000000a', 'ethereum') $$,
  '42501', null, 'anon cannot execute get_wallet_check');
select throws_ok(
  $$ select public.save_wallet_check('a0000000-0000-0000-0000-00000000000a', 'ethereum', '{}') $$,
  '42501', null, 'anon cannot execute save_wallet_check');
select throws_ok($$ select public.delete_my_account() $$, '42501', null, 'anon cannot execute delete_my_account');
reset role;

-- ---------- user A: reads, inserts and attempts on B's rows ----------
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
select throws_ok(
  $$ insert into wallet_check_requests (user_id, created_at)
     values ('11111111-1111-1111-1111-111111111111', now() - interval '1 day') $$,
  '42501', null, 'A cannot backdate a check request (created_at is not insertable)');
select throws_ok($$ delete from wallet_check_requests $$, '42501', null, 'A cannot delete their request log');

-- Attempts on B's rows are silent no-ops under RLS (verified as owner below).
select lives_ok($$ delete from wallets where id = 'b0000000-0000-0000-0000-00000000000b' $$,
  'A deleting B''s wallet by id raises nothing');
select lives_ok($$ update wallets set label = 'pwned' where id = 'b0000000-0000-0000-0000-00000000000b' $$,
  'A updating B''s wallet label raises nothing');
select lives_ok($$ update profiles set timezone = 'Pwned/Zone' where user_id = '22222222-2222-2222-2222-222222222222' $$,
  'A updating B''s profile raises nothing');
select lives_ok($$ delete from watchlist where user_id = '22222222-2222-2222-2222-222222222222' $$,
  'A deleting B''s watchlist rows raises nothing');

select throws_ok($$ update wallets set user_id = '22222222-2222-2222-2222-222222222222' $$,
  '42501', null, 'A cannot reassign a wallet to another user');
select throws_ok($$ update wallets set address = '0x00000000000000000000000000000000000000ee' $$,
  '42501', null, 'A cannot change a wallet address');
select throws_ok($$ update profiles set plan = 'pro' $$, '42501', null, 'A cannot change their own plan');
select lives_ok($$ update profiles set timezone = 'Asia/Jakarta' $$, 'A can change their timezone');
select throws_ok($$ select * from wallet_checks $$, '42501', null, 'A cannot read wallet_checks directly');
reset role;

-- ---------- owner view: B's data survived A's attempts ----------
select results_eq(
  $$ select (select count(*)::int from wallets where id = 'b0000000-0000-0000-0000-00000000000b' and label = 'B only'),
            (select count(*)::int from profiles where user_id = '22222222-2222-2222-2222-222222222222' and timezone = 'UTC'),
            (select count(*)::int from watchlist where user_id = '22222222-2222-2222-2222-222222222222') $$,
  $$ values (1, 1, 1) $$,
  'B''s wallet, profile and watchlist are untouched by A''s attempts');

-- ---------- user A: RPCs ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select is((select count(*)::int from public.get_wallet_check('a0000000-0000-0000-0000-00000000000a', 'ethereum')), 1,
  'A can read the cached check of their own wallet');
select is((select count(*)::int from public.get_wallet_check('b0000000-0000-0000-0000-00000000000b', 'ethereum')), 0,
  'A gets no rows for B''s wallet');
select is((select result->>'txCount' from public.get_wallet_check('a0000000-0000-0000-0000-00000000000c', 'ethereum')), '3',
  'A reads A''s own cached result for the shared address, not B''s');
select throws_ok(
  $$ select public.save_wallet_check('b0000000-0000-0000-0000-00000000000b', 'ethereum', '{"txCount":99}') $$,
  '42501', null, 'A cannot save a check for B''s wallet');
select lives_ok(
  $$ select public.save_wallet_check('a0000000-0000-0000-0000-00000000000a', 'base', '{"txCount":7}') $$,
  'A can save a check for their own wallet');
-- Poisoning attempt: A holds the victim's address as their own wallet and writes a fake result.
select lives_ok(
  $$ select public.save_wallet_check('a0000000-0000-0000-0000-00000000000c', 'ethereum', '{"txCount":999}') $$,
  'A can overwrite their own cache row for the shared address');
select throws_ok(
  $$ select public.save_wallet_check('a0000000-0000-0000-0000-00000000000a', 'Base Chain!', '{}') $$,
  '22023', null, 'save_wallet_check rejects a malformed chain');
select throws_ok(
  $$ select public.save_wallet_check('a0000000-0000-0000-0000-00000000000a', 'base', jsonb_build_object('blob', repeat('x', 9000))) $$,
  '22023', null, 'save_wallet_check rejects an oversized result');

-- ---------- user B: never sees A's cached result ----------
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is((select result->>'txCount' from public.get_wallet_check('b0000000-0000-0000-0000-00000000000c', 'ethereum')), '33',
  'B reads B''s own cached result and never A''s poisoned value');
select is((select count(*)::int from public.get_wallet_check('a0000000-0000-0000-0000-00000000000a', 'ethereum')), 0,
  'B gets no rows for A''s wallet');

-- ---------- user A again: single-wallet delete, cap, account deletion ----------
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
delete from wallets where id = 'a0000000-0000-0000-0000-00000000000a';
reset role;

select is((select count(*)::int from wallet_checks where user_id = '11111111-1111-1111-1111-111111111111'
           and address = '0x00000000000000000000000000000000000000a1'), 0,
  'deleting a wallet removes A''s cached checks for that address (all chains)');
select results_eq(
  $$ select user_id::text, result->>'txCount' from wallet_checks
     where address = '0x00000000000000000000000000000000000000c3' order by user_id $$,
  $$ values ('11111111-1111-1111-1111-111111111111'::text, '999'::text), ('22222222-2222-2222-2222-222222222222'::text, '33'::text) $$,
  'A''s overwrite touched only A''s row; B''s cache row for the same address is unaffected');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select lives_ok(
  $$ insert into wallets (user_id, address, chain_family)
     select '11111111-1111-1111-1111-111111111111', '0x' || lpad(to_hex(i), 40, '0'), 'evm' from generate_series(1, 19) i $$,
  'A can fill up to 20 wallets');
select throws_ok(
  $$ insert into wallets (user_id, address, chain_family)
     values ('11111111-1111-1111-1111-111111111111', '0x00000000000000000000000000000000000000ff', 'evm') $$,
  '23514', null, 'the 21st wallet is rejected');

-- Without a user id in the JWT nothing can be deleted.
set local request.jwt.claims = '{"role":"authenticated"}';
select throws_ok($$ select public.delete_my_account() $$, '42501', null, 'delete_my_account raises without auth.uid()');
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select lives_ok($$ select public.delete_my_account() $$, 'A can delete their own account');
reset role;

-- ---------- after A deleted their account (back as owner) ----------
select is(
  (select count(*)::int from auth.users where id = '11111111-1111-1111-1111-111111111111')
  + (select count(*)::int from profiles where user_id = '11111111-1111-1111-1111-111111111111')
  + (select count(*)::int from wallets where user_id = '11111111-1111-1111-1111-111111111111')
  + (select count(*)::int from watchlist where user_id = '11111111-1111-1111-1111-111111111111')
  + (select count(*)::int from wallet_check_requests where user_id = '11111111-1111-1111-1111-111111111111')
  + (select count(*)::int from wallet_checks where user_id = '11111111-1111-1111-1111-111111111111'),
  0, 'all of A''s rows are gone, including cached checks');
select results_eq(
  $$ select (select count(*)::int from profiles where user_id = '22222222-2222-2222-2222-222222222222'),
            (select count(*)::int from wallets where user_id = '22222222-2222-2222-2222-222222222222'),
            (select count(*)::int from watchlist where user_id = '22222222-2222-2222-2222-222222222222'),
            (select count(*)::int from wallet_check_requests where user_id = '22222222-2222-2222-2222-222222222222'),
            (select count(*)::int from wallet_checks where user_id = '22222222-2222-2222-2222-222222222222') $$,
  $$ values (1, 2, 1, 1, 2) $$,
  'B''s data, including both cache rows, is intact');

select * from finish();
rollback;
