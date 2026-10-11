-- pgTAP tests for 0012_curated_list.sql (Plan 6 Task 3; curation spec §4.5, §7.1, §15.5, decisions #40, #42, #44, #45,
-- #52): latest_curations, public_list (visitors, no worth) and curated_list (members, with worth). Plan 6 Task 4 adds
-- public_list.key_checks_ran ("{k}/4 security check jalan"), read through a security definer function so the column
-- keeps working for anon once 0013 takes risk_assessments.checks away from anon (advanced checks are member-only, #54).
-- Public vs member is locked in the database: anon reads latest_curations and public_list, never curated_list;
-- public_list has no worth column (the views are security_invoker, so a worth column would refuse anon the whole view).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(49);

-- Fixtures (run as the migration/test owner role, which bypasses RLS). Project ids end in the project number.
insert into documents (id, source_kind, source_key, url, text, content_hash, fetched_at) values
  ('c1000000-0000-4000-8000-0000000000d1', 'airdrops_io', 'airdrops.io', 'https://cl.test/d1', 't', 'h', now()),
  ('c1000000-0000-4000-8000-0000000000d2', 'telegram', 'tg', 'https://cl.test/d2', 't', 'h', now()),
  ('c1000000-0000-4000-8000-0000000000d3', 'alphadrops', 'ad', 'https://cl.test/d3', 't', 'h', now());

insert into projects (id, slug, name, name_key, status, chains, first_seen, last_seen) values
  -- 1: latest curation passes (an older one failed); deposit from one source, free from another.
  ('c1000000-0000-4000-8000-000000000001', 'cl-pass', 'CL Pass', 'clpass', 'live', '{Base}', now(), now()),
  -- 2: passed once, latest curation fails.
  ('c1000000-0000-4000-8000-000000000002', 'cl-dropped', 'CL Dropped', 'cldropped', 'live', '{}', now(), now()),
  -- 3: never curated (the run has not judged it yet).
  ('c1000000-0000-4000-8000-000000000003', 'cl-never', 'CL Never', 'clnever', 'live', '{}', now(), now()),
  -- 4: two curations with the same computed_at: pass, then fail (greater seq) -> the fail is the latest.
  ('c1000000-0000-4000-8000-000000000004', 'cl-tie', 'CL Tie', 'cltie', 'live', '{}', now(), now()),
  -- 5: every source that mentions capital says none (one document changed its mind from high to none).
  ('c1000000-0000-4000-8000-000000000005', 'cl-free', 'CL Free', 'clfree', 'speculative', '{}', now(), now()),
  -- 6: no capital fact, no signal, one claim link not official.
  ('c1000000-0000-4000-8000-000000000006', 'cl-unknown', 'CL Unknown', 'clunknown', 'live', '{}', now(), now()),
  -- 7: ended after passing (#40).
  ('c1000000-0000-4000-8000-000000000007', 'cl-ended', 'CL Ended', 'clended', 'ended', '{}', now(), now());

insert into curations (project_id, passed, worth_level, tab, status_at, ended_on, public_fail_reason, computed_at) values
  ('c1000000-0000-4000-8000-000000000001', false, null, null, 'live', null, 'Cek kunci belum lengkap', now() - interval '2 days'),
  ('c1000000-0000-4000-8000-000000000001', true, 'high', 'live_now', 'live', null, null, now() - interval '1 hour'),
  ('c1000000-0000-4000-8000-000000000002', true, 'medium', 'live_now', 'live', null, null, now() - interval '2 days'),
  ('c1000000-0000-4000-8000-000000000002', false, null, null, 'live', null, 'Risiko tinggi', now() - interval '1 hour'),
  ('c1000000-0000-4000-8000-000000000004', true, 'low', 'live_now', 'live', null, null, '2026-10-01T00:00:00Z'),
  ('c1000000-0000-4000-8000-000000000004', false, null, null, 'live', null, 'Risiko tinggi', '2026-10-01T00:00:00Z'),
  ('c1000000-0000-4000-8000-000000000005', true, 'insufficient_data', 'early_bets', 'speculative', null, null, now()),
  ('c1000000-0000-4000-8000-000000000006', true, 'low', 'live_now', 'live', null, null, now()),
  ('c1000000-0000-4000-8000-000000000007', true, 'medium', 'ended', 'ended', '2026-09-28', null, now());

insert into project_signals (project_id, kind, value, source, verified, observed_at) values
  ('c1000000-0000-4000-8000-000000000001', 'vc_backer', '{"investor": "Paradigm", "tier": 1}', 'vc_portfolio', true,
   now() - interval '1 day'),
  ('c1000000-0000-4000-8000-000000000001', 'curated_source', '{"source_kind": "airdrops_io"}', 'airdrops_io', false, now()),
  -- Kept through an outage, older than 14 days: curation ignored it, so the list must not show it.
  ('c1000000-0000-4000-8000-000000000001', 'tvl', '{"tvl_usd": 250000000}', 'defillama', true, now() - interval '15 days'),
  ('c1000000-0000-4000-8000-000000000005', 'tvl', '{"tvl_usd": 20000000}', 'defillama', true, now() - interval '13 days'),
  ('c1000000-0000-4000-8000-000000000005', 'curated_source', '{"source_kind": "telegram"}', 'telegram', false, now()),
  ('c1000000-0000-4000-8000-000000000007', 'coingecko_listed', '{"gecko_id": "cl"}', 'defillama', true, now()),
  ('c1000000-0000-4000-8000-000000000007', 'curated_source', '{"source_kind": "airdrops_io"}', 'airdrops_io', false, now());

-- Capital facts (#52), the latest per document counts.
insert into evidence (project_id, document_id, field, value, quote, at) values
  ('c1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-0000000000d1', 'capital_required', 'none', '', now()),
  ('c1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-0000000000d2', 'capital_required', 'high', '', now()),
  ('c1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-0000000000d1', 'capital_min_usd', '1500', '', now()),
  ('c1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-0000000000d2', 'capital_min_usd', '1000', '', now()),
  -- Document 3 stated $50 earlier and $2000 now: only its latest value counts.
  ('c1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-0000000000d3', 'capital_min_usd', '50', '',
   now() - interval '3 days'),
  ('c1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-0000000000d3', 'capital_min_usd', '2000', '', now()),
  ('c1000000-0000-4000-8000-000000000005', 'c1000000-0000-4000-8000-0000000000d1', 'capital_required', 'none', '', now()),
  -- Document 2 said high before, none now: the latest value of each document counts, so the project is free.
  ('c1000000-0000-4000-8000-000000000005', 'c1000000-0000-4000-8000-0000000000d2', 'capital_required', 'high', '',
   now() - interval '3 days'),
  ('c1000000-0000-4000-8000-000000000005', 'c1000000-0000-4000-8000-0000000000d2', 'capital_required', 'none', '', now()),
  -- A malformed number is ignored, never an error that would take the whole list down.
  ('c1000000-0000-4000-8000-000000000005', 'c1000000-0000-4000-8000-0000000000d1', 'capital_min_usd', 'n/a', '', now());

-- Claim badge (#42): an open claim deadline and every claim link official.
insert into deadlines (project_id, document_id, kind, date, precision, text) values
  ('c1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-0000000000d1', 'claim',
   (now() at time zone 'utc')::date + 5, 'exact', 'claim soon'),
  ('c1000000-0000-4000-8000-000000000005', 'c1000000-0000-4000-8000-0000000000d1', 'claim',
   (now() at time zone 'utc')::date - 1, 'exact', 'claim closed'),
  ('c1000000-0000-4000-8000-000000000006', 'c1000000-0000-4000-8000-0000000000d1', 'claim',
   (now() at time zone 'utc')::date, 'exact', 'claim today');
insert into links (project_id, url, kind) values
  ('c1000000-0000-4000-8000-000000000001', 'https://claim.cl.test/', 'claim'),
  ('c1000000-0000-4000-8000-000000000001', 'https://app.other.test/', 'app'),
  ('c1000000-0000-4000-8000-000000000005', 'https://claim.free.test/', 'claim'),
  ('c1000000-0000-4000-8000-000000000006', 'https://claim.unknown.test/', 'claim'),
  ('c1000000-0000-4000-8000-000000000006', 'https://claim2.unknown.test/', 'claim');
insert into link_checks (url, status, checked_at) values
  ('https://claim.cl.test/', 'official', now()),
  ('https://app.other.test/', 'different_domain', now()),
  ('https://claim.free.test/', 'official', now()),
  ('https://claim.unknown.test/', 'official', now());
  -- https://claim2.unknown.test/ has no link_checks row: not checked, so not official.

-- Key check coverage ("{k}/4 security check jalan"): the latest risk assessment counts, only its 4 key checks.
insert into risk_assessments (project_id, level, points, reasons, checks, computed_at) values
  -- cl-pass: an older assessment had all 4; the latest has 3 key checks that ran (one listed twice), domain_age that
  -- did not, and advanced checks that ran but must not count.
  ('c1000000-0000-4000-8000-000000000001', 'low', 0, '[]',
   '[{"id":"dangerous_asks","ran":true},{"id":"phishing_list","ran":true},{"id":"domain_age","ran":true},
     {"id":"lookalike","ran":true}]', now() - interval '2 days'),
  ('c1000000-0000-4000-8000-000000000001', 'low', 0, '[]',
   '[{"id":"dangerous_asks","ran":true},{"id":"dangerous_asks","ran":true},{"id":"phishing_list","ran":true},
     {"id":"domain_age","ran":false},{"id":"lookalike","ran":true},{"id":"token_security","ran":true},
     {"id":"hack_history","ran":true}]', now() - interval '1 hour'),
  -- cl-unknown: all 4 key checks ran ("ran" must be the boolean true; the string "true" is not).
  ('c1000000-0000-4000-8000-000000000006', 'low', 0, '[]',
   '[{"id":"lookalike","ran":true},{"id":"domain_age","ran":true},{"id":"phishing_list","ran":true},
     {"id":"dangerous_asks","ran":true},{"id":"corroboration","ran":"true"}]', now()),
  -- cl-ended: a malformed checks value counts as none ran, never an error that would take the list down.
  ('c1000000-0000-4000-8000-000000000007', 'low', 0, '[]', '{"dangerous_asks":true}', now());
  -- cl-free has no risk assessment: 0.

-- ---------- shape ----------
-- 1-3.
select has_view('public', 'latest_curations', 'latest_curations exists');
select has_view('public', 'public_list', 'public_list exists');
select has_view('public', 'curated_list', 'curated_list exists');
-- 4. Every view is security_invoker, so RLS and the column grants of the base tables decide what each role sees.
select results_eq(
  $$ select relname::text collate "default", coalesce(reloptions, '{}') @> array['security_invoker=true'] from pg_class
     where relnamespace = 'public'::regnamespace and relname in ('latest_curations', 'public_list', 'curated_list')
     order by 1 $$,
  $$ values ('curated_list'::text, true), ('latest_curations'::text, true), ('public_list'::text, true) $$,
  'the three views are security_invoker');
-- 5-6. Columns: no worth anywhere public.
select columns_are('public', 'latest_curations',
  array['id', 'project_id', 'passed', 'tab', 'status_at', 'ended_on', 'public_fail_reason', 'coingecko_listed',
        'computed_at', 'seq'],
  'latest_curations holds only the public curations columns');
select columns_are('public', 'public_list',
  array['id', 'slug', 'name', 'status', 'chains', 'chains_lower', 'last_seen', 'next_deadline_date', 'next_deadline_kind',
        'next_deadline_precision', 'latest_risk_level', 'curation_id', 'tab', 'ended_on', 'checked_at', 'signals',
        'signal_rank', 'claim_open_checked', 'capital', 'capital_min_usd', 'key_checks_ran'],
  'public_list = project_list + curation columns, signals, claim badge, capital and key check count, without worth_level');
-- 7.
select columns_are('public', 'curated_list',
  array['id', 'slug', 'name', 'status', 'chains', 'chains_lower', 'last_seen', 'next_deadline_date', 'next_deadline_kind',
        'next_deadline_precision', 'latest_risk_level', 'curation_id', 'tab', 'ended_on', 'checked_at', 'signals',
        'signal_rank', 'claim_open_checked', 'capital', 'capital_min_usd', 'key_checks_ran', 'worth_level', 'worth_rank'],
  'curated_list = public_list + worth_level and its sort rank');

-- ---------- privileges ----------
-- 8. Effective privileges (Supabase's default privileges grant everything on new views, so this proves the revoke).
select results_eq(
  $$ select v, r, p, has_table_privilege(r, 'public.' || v, p)
     from unnest(array['latest_curations', 'public_list', 'curated_list']) v,
          unnest(array['anon', 'authenticated']) r,
          unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
     where has_table_privilege(r, 'public.' || v, p)
     order by 1, 2, 3 $$,
  $$ values ('curated_list'::text, 'authenticated'::text, 'SELECT'::text, true),
            ('latest_curations', 'anon', 'SELECT', true), ('latest_curations', 'authenticated', 'SELECT', true),
            ('public_list', 'anon', 'SELECT', true), ('public_list', 'authenticated', 'SELECT', true) $$,
  'anon may only select latest_curations and public_list; authenticated may also select curated_list; nobody writes');

-- ---------- rows (owner) ----------
-- 9. Only projects whose latest curation passed.
select results_eq(
  $$ select slug from public_list where slug like 'cl-%' order by slug $$,
  $$ values ('cl-ended'::text), ('cl-free'::text), ('cl-pass'::text), ('cl-unknown'::text) $$,
  'public_list holds exactly the projects whose latest curation passed (not cl-dropped, cl-never or cl-tie)');
-- 10.
select is(
  (select passed from latest_curations where project_id = 'c1000000-0000-4000-8000-000000000004'), false,
  'latest curation on a computed_at tie is the one with the greater seq');
-- 11.
select results_eq(
  $$ select passed, public_fail_reason from latest_curations where project_id = 'c1000000-0000-4000-8000-000000000002' $$,
  $$ values (false, 'Risiko tinggi'::text) $$,
  'latest_curations gives the latest curation of a project, failed ones included');
-- 12.
select is(
  (select count(*)::int from latest_curations where project_id = 'c1000000-0000-4000-8000-000000000003'), 0,
  'a project never curated has no latest curation');
-- 13. tab, ended_on, checked_at come from the latest curation.
select results_eq(
  $$ select tab, ended_on, checked_at = (select max(computed_at) from curations
                                         where project_id = 'c1000000-0000-4000-8000-000000000001')
     from public_list where slug = 'cl-pass' $$,
  $$ values ('live_now'::text, null::date, true) $$,
  'cl-pass: tab and ended_on of the latest curation, checked_at = its computed_at');
-- 14.
select results_eq(
  $$ select tab, ended_on from public_list where slug in ('cl-free', 'cl-ended') order by slug $$,
  $$ values ('ended'::text, '2026-09-28'::date), ('early_bets'::text, null::date) $$,
  'early_bets and ended tabs, with the ended date');
-- 15. project_list columns pass through.
select results_eq(
  $$ select status, chains_lower, next_deadline_kind from public_list where slug = 'cl-pass' $$,
  $$ values ('live'::text, '{base}'::text[], 'claim'::text) $$,
  'project_list columns are carried over');

-- 16-19. Signals: kind, value, verified, source, observed_at; signals older than 14 days left out.
select results_eq(
  $$ select s->>'kind', s->>'source', (s->>'verified')::boolean, s->'value'
     from public_list, jsonb_array_elements(signals) s where slug = 'cl-pass' order by 1 $$,
  $$ values ('curated_source'::text, 'airdrops_io'::text, false, '{"source_kind": "airdrops_io"}'::jsonb),
            ('vc_backer', 'vc_portfolio', true, '{"investor": "Paradigm", "tier": 1}'::jsonb) $$,
  'cl-pass signals: kind, source, verified and value; the 15-day-old tvl is left out');
select is(
  (select ((signals->0->>'observed_at')::timestamptz > now() - interval '2 days') from public_list where slug = 'cl-pass'),
  true, 'each signal carries its observed_at');
select is(
  (select array_agg(s->>'kind' order by s->>'kind') from public_list, jsonb_array_elements(signals) s
   where slug = 'cl-free'),
  array['curated_source', 'tvl'], 'a 13-day-old signal is still shown');
select is((select signals from public_list where slug = 'cl-unknown'), '[]'::jsonb, 'no signal gives an empty array');
-- 20. Strongest signal for the member order: vc_backer 1, tvl 2, coingecko_listed 3, curated_source 4, none null.
select results_eq(
  $$ select slug, signal_rank from public_list where slug like 'cl-%' order by slug $$,
  $$ values ('cl-ended'::text, 3), ('cl-free', 2), ('cl-pass', 1), ('cl-unknown', null::int) $$,
  'signal_rank is the strongest current signal (an old tvl does not count)');

-- 21-23. Claim badge (#42).
select is((select claim_open_checked from public_list where slug = 'cl-pass'), true,
  'open claim deadline and every claim link official: badge (an app link does not count)');
select is((select claim_open_checked from public_list where slug = 'cl-free'), false,
  'claim deadline passed: no badge');
select is((select claim_open_checked from public_list where slug = 'cl-unknown'), false,
  'a claim link without an official check: no badge');
-- 24.
select is((select claim_open_checked from public_list where slug = 'cl-ended'), false,
  'no claim deadline and no claim link: no badge');

-- 25-27. Capital (#52).
select results_eq(
  $$ select capital, capital_min_usd from public_list where slug = 'cl-pass' $$,
  $$ values ('deposit'::text, 1000::numeric) $$,
  'none from one source and high from another: deposit; the smallest minimum of the latest values per document');
select results_eq(
  $$ select capital, capital_min_usd from public_list where slug = 'cl-free' $$,
  $$ values ('free'::text, null::numeric) $$,
  'every source that mentions capital says none (latest per document): free; a malformed number is ignored');
select results_eq(
  $$ select capital, capital_min_usd from public_list where slug = 'cl-unknown' $$,
  $$ values ('unknown'::text, null::numeric) $$,
  'no capital fact: unknown');

-- 28-31. Key check coverage (Task 4).
select results_eq(
  $$ select slug, key_checks_ran from public_list where slug like 'cl-%' order by slug $$,
  $$ values ('cl-ended'::text, 0), ('cl-free', 0), ('cl-pass', 3), ('cl-unknown', 4) $$,
  'key_checks_ran counts the distinct key checks that ran in the latest assessment; advanced checks never count');
select is(
  (select array_agg(column_name::text order by column_name) from information_schema.columns
   where table_schema = 'public' and table_name = 'public_list'
     and column_name in ('worth_level', 'worth_points', 'worth_rank', 'reasons', 'coverage', 'checks')),
  null, 'public_list exposes no worth, reasons, coverage or raw checks column');
select results_eq(
  $$ select p.prosecdef, array_to_string(p.proconfig, ',') collate "default" from pg_proc p
     where p.proname = 'key_checks_ran' and p.pronamespace = 'public'::regnamespace $$,
  $$ values (true, 'search_path=""'::text) $$,
  'key_checks_ran() is security definer with an empty search_path');
select results_eq(
  $$ select r, has_function_privilege(r, 'public.key_checks_ran(uuid)', 'EXECUTE')
     from unnest(array['anon', 'authenticated']) r order by 1 $$,
  $$ values ('anon'::text, true), ('authenticated'::text, true) $$,
  'the web roles may run key_checks_ran() (it is part of public_list)');

-- 32-33. curated_list = public_list + worth.
select results_eq(
  $$ select slug, worth_level, worth_rank from curated_list where slug like 'cl-%' order by slug $$,
  $$ values ('cl-ended'::text, 'medium'::text, 2), ('cl-free', 'insufficient_data', 4), ('cl-pass', 'high', 1),
            ('cl-unknown', 'low', 3) $$,
  'curated_list adds the latest curation''s worth_level and its rank (high 1 ... insufficient_data 4)');
select is(
  (select count(*)::int from curated_list c join public_list p using (id)
   where c.slug like 'cl-%' and c.capital = p.capital and c.signals = p.signals and c.checked_at = p.checked_at),
  4, 'curated_list carries the public_list columns unchanged');

-- ---------- anon ----------
set local role anon;
-- 34-39.
select results_eq(
  $$ select slug, capital from public_list where slug like 'cl-%' order by slug $$,
  $$ values ('cl-ended'::text, 'unknown'::text), ('cl-free', 'free'), ('cl-pass', 'deposit'), ('cl-unknown', 'unknown') $$,
  'anon reads public_list');
select is(
  (select jsonb_array_length(signals) from public_list where slug = 'cl-pass'), 2, 'anon reads the signals');
select throws_ok($$ select worth_level from public_list $$, '42703', null, 'public_list has no worth_level for anon');
select results_eq(
  $$ select slug, key_checks_ran from public_list where slug like 'cl-%' order by slug $$,
  $$ values ('cl-ended'::text, 0), ('cl-free', 0), ('cl-pass', 3), ('cl-unknown', 4) $$,
  'anon reads key_checks_ran');
select throws_ok($$ select * from curated_list $$, '42501', null, 'anon cannot select curated_list');
select throws_ok($$ select slug from curated_list $$, '42501', null, 'anon cannot select any curated_list column');
-- 40-41.
select is(
  (select passed from latest_curations where project_id = 'c1000000-0000-4000-8000-000000000002'), false,
  'anon reads latest_curations');
select throws_ok(
  $$ insert into curations (project_id, passed, status_at, computed_at)
     values ('c1000000-0000-4000-8000-000000000003', true, 'live', now()) $$,
  '42501', null, 'anon still cannot write curations');
reset role;

-- ---------- authenticated ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"c1000000-0000-4000-8000-00000000aaaa","role":"authenticated"}';
-- 42-45.
select is((select count(*)::int from public_list where slug like 'cl-%'), 4, 'authenticated reads public_list');
select results_eq(
  $$ select slug, worth_level from curated_list where slug like 'cl-%' order by slug $$,
  $$ values ('cl-ended'::text, 'medium'::text), ('cl-free', 'insufficient_data'), ('cl-pass', 'high'),
            ('cl-unknown', 'low') $$,
  'authenticated reads curated_list with worth_level');
select is(
  (select capital_min_usd from curated_list where slug = 'cl-pass'), 1000::numeric, 'authenticated reads capital');
select is(
  (select count(*)::int from latest_curations where project_id::text like 'c1000000-%'), 6,
  'authenticated reads one latest curation per curated project');
-- 46-47.
select throws_ok($$ delete from curations $$, '42501', null, 'authenticated cannot delete curations');
select is(
  (select claim_open_checked from curated_list where slug = 'cl-pass'), true, 'authenticated reads the claim badge');
reset role;

-- ---------- after 0013 (Task 5) takes risk_assessments.checks away from anon ----------
-- 48-49.
-- The same column grants 0013 plans; rolled back with the rest of this test.
revoke select on risk_assessments from anon;
grant select (id, project_id, level, points, reasons, computed_at, seq) on risk_assessments to anon;
set local role anon;
select throws_ok($$ select checks from risk_assessments $$, '42501', null,
  'with the 0013 grants anon cannot read risk_assessments.checks');
select results_eq(
  $$ select slug, key_checks_ran, latest_risk_level from public_list where slug in ('cl-pass', 'cl-unknown') order by slug $$,
  $$ values ('cl-pass'::text, 3, 'low'::text), ('cl-unknown', 4, 'low') $$,
  'public_list, key_checks_ran included, still works for anon without the checks column');
reset role;

select * from finish();
rollback;
