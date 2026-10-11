-- pgTAP tests for 0019_login_throttle.sql: 5 failures under an email key block it for 15 minutes, 30 under an address
-- key, keys are independent, bad keys are ignored, and nobody can read the table.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(17);

create temp table k as select repeat('a', 64) as a, repeat('b', 64) as b, repeat('c', 64) as c;
grant select on k to anon;

set local role anon;
select is(login_throttle_allowed((select a from k), (select b from k)), true, 'fresh keys are allowed');
select lives_ok($$ select login_throttle_fail((select a from k), (select b from k)) $$, 'anon can report a failure');
select lives_ok($$ select login_throttle_fail((select a from k), null) $$, 'again, with no address');
select lives_ok($$ select login_throttle_fail((select a from k), null) $$, 'again');
select lives_ok($$ select login_throttle_fail((select a from k), null) $$, 'a fourth failure');
select is(login_throttle_allowed((select a from k), (select b from k)), true, 'four failures still allow an attempt');
select lives_ok($$ select login_throttle_fail((select a from k), null) $$, 'a fifth failure');
select is(login_throttle_allowed((select a from k), (select b from k)), false, 'five failures block the email');
select is(login_throttle_allowed((select c from k), (select b from k)), true, 'another email from the same address is allowed');
select is(login_throttle_allowed('not-a-key', null), true, 'invalid and null keys are ignored');
select throws_ok($$ select * from login_attempts $$, '42501', null, 'anon cannot read the attempts');

-- The address limit is 30: 29 more failures (30 in all) block it.
select lives_ok($$ select login_throttle_fail(null, (select b from k)) from generate_series(1, 28) $$, '28 more failures from one address');
select is(login_throttle_allowed((select c from k), (select b from k)), true, '29 failures from an address still pass');
select lives_ok($$ select login_throttle_fail(null, (select b from k)) $$, 'the 30th');
select is(login_throttle_allowed((select c from k), (select b from k)), false, '30 failures block the address');
reset role;

update login_attempts set created_at = now() - interval '16 minutes';
set local role anon;
select is(login_throttle_allowed((select a from k), (select b from k)), true, 'failures older than 15 minutes do not count');
reset role;
select is((select count(*)::int from login_attempts where key = 'not-a-key'), 0, 'invalid keys were never stored');

select * from finish();
rollback;
