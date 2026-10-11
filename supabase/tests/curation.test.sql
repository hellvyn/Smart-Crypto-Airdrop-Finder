-- pgTAP tests for 0011_curation.sql (curation spec §4.1-4.4, §15.5): signals, the VC portfolio cache, AlphaDrops
-- raises, claim link checks, the claim page cache, AI analyses, curation history, tasks.text_id and the `curated`
-- project change.
-- Public vs member is locked in the database (#45, #54, #55): anon reads signals, link checks, the non-worth curation
-- columns (with coingecko_listed, the track record input of #43) and `contradictions` analyses only; authenticated reads every curation column and every analysis kind;
-- vc_portfolios, alphadrops_raises and claim_pages are service role only; the web roles write nothing.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(73);

-- Rows visible to the current role. A refused read (no privilege, 42501) is what PostgREST answers with an error and
-- no data, so it counts as zero rows, the same as rows filtered out by RLS.
create function pg_temp.visible_rows(tbl regclass) returns bigint language plpgsql as $f$
declare n bigint;
begin
  execute format('select count(*) from %s', tbl) into n;
  return n;
exception when insufficient_privilege then
  return 0;
end
$f$;

-- Fixtures (run as the migration/test owner role, which bypasses RLS).
insert into documents (id, source_kind, source_key, url, text, content_hash, fetched_at) values
  ('c0000000-0000-4000-8000-0000000000d1', 'airdrops_io', 'airdrops.io', 'https://curation.test/a', 't', 'h', now());
insert into projects (id, slug, name, name_key, first_seen, last_seen) values
  ('c0000000-0000-4000-8000-0000000000b1', 'curation-test', 'Curation Test', 'curationtest', now(), now()),
  ('c0000000-0000-4000-8000-0000000000b2', 'curation-test-2', 'Curation Test 2', 'curationtest2', now(), now());
insert into tasks (project_id, document_id, description, text_id) values
  ('c0000000-0000-4000-8000-0000000000b1', 'c0000000-0000-4000-8000-0000000000d1', 'Bridge to Ink', 'Bridge ke Ink');

insert into project_signals (project_id, kind, value, source, verified, observed_at) values
  ('c0000000-0000-4000-8000-0000000000b1', 'tvl', '{"tvl_usd": 25000000}', 'defillama', true, now()),
  ('c0000000-0000-4000-8000-0000000000b1', 'vc_backer', '{"investor": "Paradigm", "tier": 1}', 'vc_portfolio', true, now());
insert into link_checks (url, status, checked_at) values ('https://claim.curation.test/', 'official', now());
insert into vc_portfolios (vc_id, domain, fetched_at) values ('paradigm', 'curation.test', now());
insert into claim_pages (url, text, fetched_at) values ('https://claim.curation.test/', 'Claim your tokens', now());
insert into alphadrops_raises (slug, official_domain, rounds, fetched_at) values
  ('curation-test', 'curation.test', '[{"round": "seed", "amount_usd": 5000000}]', now());
insert into ai_analyses (project_id, kind, input_hash, result, model, prompt_version) values
  ('c0000000-0000-4000-8000-0000000000b1', 'analyst', 'h1', '{"verdict": "garap"}', 'm', 'analyst-1'),
  ('c0000000-0000-4000-8000-0000000000b1', 'scam', 'h1', '{"patterns": []}', 'm', 'scam-1'),
  ('c0000000-0000-4000-8000-0000000000b1', 'contradictions', 'h1', '{"items": []}', 'm', 'contradictions-1');
insert into curations (project_id, passed, worth_level, tab, status_at, ended_on, reasons, coverage, public_fail_reason,
                       coingecko_listed, computed_at) values
  ('c0000000-0000-4000-8000-0000000000b1', true, 'high', 'live_now', 'live', null,
   '[{"code": "tvl_high", "message": "TVL di atas $100 juta", "kind": "worth"}]', '{"defillama": true}', null, true, now()),
  ('c0000000-0000-4000-8000-0000000000b2', false, null, null, 'live', null,
   '[{"code": "insufficient_checks", "message": "Cek kunci belum lengkap", "kind": "fail"}]', '{}',
   'Cek kunci belum lengkap', null, now());

-- ---------- shape ----------
-- 1. RLS on every new table.
select results_eq(
  $$ select relname::text collate "default", relrowsecurity from pg_class
     where relnamespace = 'public'::regnamespace
       and relname in ('project_signals', 'alphadrops_raises', 'link_checks', 'vc_portfolios', 'ai_analyses', 'curations',
                       'claim_pages')
     order by 1 $$,
  $$ values ('ai_analyses'::text, true), ('alphadrops_raises'::text, true), ('claim_pages'::text, true),
            ('curations'::text, true), ('link_checks'::text, true), ('project_signals'::text, true),
            ('vc_portfolios'::text, true) $$,
  'row level security is enabled on all seven new tables');

-- 2-3. tasks.text_id: the Indonesian step text, nullable.
select col_type_is('public', 'tasks', 'text_id', 'text', 'tasks.text_id is text');
select col_is_null('public', 'tasks', 'text_id', 'tasks.text_id is nullable');

-- 4. curations columns.
select columns_are('public', 'curations',
  array['id', 'project_id', 'passed', 'worth_level', 'tab', 'status_at', 'ended_on', 'reasons', 'coverage',
        'public_fail_reason', 'computed_at', 'seq', 'worth_points', 'coingecko_listed'],
  'curations has the spec §4.2 columns plus public_fail_reason (#55), worth_points and coingecko_listed (#43)');
-- 4a. claim_pages: the text of a claim portal page as last fetched (#56), one row per url.
select columns_are('public', 'claim_pages', array['url', 'text', 'fetched_at'], 'claim_pages caches url, text, fetched_at');
-- 4b-4c. coingecko_listed: null when it is not known whether the token traded on that run.
select col_type_is('public', 'curations', 'coingecko_listed', 'boolean', 'curations.coingecko_listed is boolean');
select col_is_null('public', 'curations', 'coingecko_listed', 'curations.coingecko_listed is nullable');

-- 5. Defaults of curations.reasons and coverage.
insert into curations (project_id, passed, status_at, computed_at) values
  ('c0000000-0000-4000-8000-0000000000b2', false, 'unknown', now() - interval '1 day');
select results_eq(
  $$ select reasons::text, coverage::text from curations
     where project_id = 'c0000000-0000-4000-8000-0000000000b2' and status_at = 'unknown' $$,
  $$ values ('[]'::text, '{}'::text) $$,
  'curations.reasons defaults to [] and coverage to {}');

-- ---------- checks: project_signals ----------
-- 6-12.
select throws_ok(
  $$ insert into project_signals (project_id, kind, value, source, verified, observed_at) values
       ('c0000000-0000-4000-8000-0000000000b1', 'claimed_backer', '{"investor": "a16z", "quote": "backed by a16z"}', 'llm_text', true, now()) $$,
  '23514', null, 'a verified claimed_backer violates the check constraint');
select throws_ok(
  $$ insert into project_signals (project_id, kind, value, source, verified, observed_at) values
       ('c0000000-0000-4000-8000-0000000000b1', 'reported_backer', '{"investor": "a16z"}', 'alphadrops', true, now()) $$,
  '23514', null, 'a verified reported_backer violates the check constraint');
select lives_ok(
  $$ insert into project_signals (project_id, kind, value, source, verified, observed_at) values
       ('c0000000-0000-4000-8000-0000000000b1', 'claimed_backer', '{"investor": "a16z", "quote": "backed by a16z"}', 'llm_text', false, now()),
       ('c0000000-0000-4000-8000-0000000000b1', 'reported_backer', '{"investor": "a16z", "lead": true}', 'alphadrops', false, now()) $$,
  'unverified claimed_backer and reported_backer (source alphadrops) are accepted');
select throws_ok(
  $$ insert into project_signals (project_id, kind, value, source, verified, observed_at) values
       ('c0000000-0000-4000-8000-0000000000b1', 'rumour', '{}', 'telegram', false, now()) $$,
  '23514', null, 'an unknown signal kind violates the check constraint');
select throws_ok(
  $$ insert into project_signals (project_id, kind, value, source, verified, observed_at) values
       ('c0000000-0000-4000-8000-0000000000b1', 'curated_source', '{}', 'twitter', false, now()) $$,
  '23514', null, 'an unknown signal source violates the check constraint');
select lives_ok(
  $$ insert into project_signals (project_id, kind, value, source, verified, observed_at) values
       ('c0000000-0000-4000-8000-0000000000b1', 'curated_source', '{"source_kind": "airdrops_io"}', 'airdrops_io', true, now()),
       ('c0000000-0000-4000-8000-0000000000b1', 'curated_source', '{"source_kind": "alphadrops"}', 'alphadrops', true, now()),
       ('c0000000-0000-4000-8000-0000000000b1', 'vc_backer', '{"investor": "Binance Labs", "tier": 1}', 'vc_portfolio', true, now()) $$,
  'one kind from two sources, and one backer kind with two investors, are distinct signals');
select throws_ok(
  $$ insert into project_signals (project_id, kind, value, source, verified, observed_at) values
       ('c0000000-0000-4000-8000-0000000000b1', 'vc_backer', '{"investor": "Paradigm", "tier": 2}', 'vc_portfolio', true, now()) $$,
  '23505', null, 'the same (project, kind, source, investor) twice violates the unique index');

-- ---------- checks: curations ----------
-- 13-16.
select lives_ok(
  $$ insert into curations (project_id, passed, worth_level, tab, status_at, ended_on, computed_at) values
       ('c0000000-0000-4000-8000-0000000000b2', true, 'medium', 'ended', 'ended', '2026-10-05', now() - interval '2 day') $$,
  'tab ended (#40) with an ended_on date is accepted');
select throws_ok(
  $$ insert into curations (project_id, passed, tab, status_at, computed_at) values
       ('c0000000-0000-4000-8000-0000000000b2', true, 'x', 'live', now()) $$,
  '23514', null, 'an unknown tab violates the check constraint');
select throws_ok(
  $$ insert into curations (project_id, passed, worth_level, status_at, computed_at) values
       ('c0000000-0000-4000-8000-0000000000b2', true, 'huge', 'live', now()) $$,
  '23514', null, 'an unknown worth_level violates the check constraint');
select throws_ok(
  $$ insert into curations (project_id, passed, status_at, computed_at) values
       ('c0000000-0000-4000-8000-0000000000b2', true, 'expired', now()) $$,
  '23514', null, 'an unknown status_at violates the check constraint');
-- 16a. Only a passing curation has a tab.
select throws_ok(
  $$ insert into curations (project_id, passed, tab, status_at, computed_at) values
       ('c0000000-0000-4000-8000-0000000000b2', false, 'live_now', 'live', now()) $$,
  '23514', null, 'a failed curation with a tab violates the check constraint');

-- ---------- checks: other tables ----------
-- 17-20.
select throws_ok(
  $$ insert into ai_analyses (project_id, kind, input_hash, result, model, prompt_version) values
       ('c0000000-0000-4000-8000-0000000000b1', 'coach', 'h', '{}', 'm', 'v') $$,
  '23514', null, 'an unknown ai_analyses kind violates the check constraint');
select throws_ok(
  $$ insert into link_checks (url, status, checked_at) values ('https://x.curation.test/', 'maybe', now()) $$,
  '23514', null, 'an unknown link_checks status violates the check constraint');
select lives_ok(
  $$ insert into project_changes (project_id, field, old_value, new_value, changed_at) values
       ('c0000000-0000-4000-8000-0000000000b1', 'curated', 'false', 'true', now()) $$,
  'project_changes accepts field curated');
select throws_ok(
  $$ insert into project_changes (project_id, field, old_value, new_value, changed_at) values
       ('c0000000-0000-4000-8000-0000000000b1', 'worth_level', 'low', 'high', now()) $$,
  '23514', null, 'project_changes still rejects other fields');

-- ---------- privileges ----------
-- 21. Table-level privileges of the web roles on the new tables: SELECT on the readable ones, nothing else
-- (Supabase's default privileges grant everything on new public tables, so this proves they were revoked).
select results_eq(
  $$ select c.relname::text collate "default", r.rolname::text collate "default", string_agg(a.privilege_type, ',' order by a.privilege_type)
     from pg_class c
     cross join lateral aclexplode(c.relacl) a
     join pg_roles r on r.oid = a.grantee
     where c.relnamespace = 'public'::regnamespace
       and c.relname in ('project_signals', 'alphadrops_raises', 'link_checks', 'vc_portfolios', 'ai_analyses', 'curations',
                         'claim_pages')
       and r.rolname in ('anon', 'authenticated')
     group by 1, 2 order by 1, 2 $$,
  $$ values ('ai_analyses'::text, 'anon'::text, 'SELECT'::text), ('ai_analyses', 'authenticated', 'SELECT'),
            ('curations', 'authenticated', 'SELECT'),
            ('link_checks', 'anon', 'SELECT'), ('link_checks', 'authenticated', 'SELECT'),
            ('project_signals', 'anon', 'SELECT'), ('project_signals', 'authenticated', 'SELECT') $$,
  'the web roles hold table-level SELECT on the readable new tables only, and no write privilege');

-- 22. anon's column-level grants on curations: exactly the non-worth columns, SELECT only.
select results_eq(
  $$ select column_name::text collate "default", privilege_type::text collate "default"
     from information_schema.column_privileges
     where table_schema = 'public' and table_name = 'curations' and grantee = 'anon'
     order by 1, 2 $$,
  $$ values ('coingecko_listed'::text, 'SELECT'::text), ('computed_at', 'SELECT'), ('ended_on', 'SELECT'), ('id', 'SELECT'),
            ('passed', 'SELECT'), ('project_id', 'SELECT'), ('public_fail_reason', 'SELECT'), ('seq', 'SELECT'),
            ('status_at', 'SELECT'), ('tab', 'SELECT') $$,
  'anon may select exactly id, project_id, passed, tab, status_at, ended_on, public_fail_reason, coingecko_listed, computed_at, seq');

-- ---------- anon ----------
set local role anon;
-- 23-29. Public reads.
select results_eq(
  $$ select passed, tab, public_fail_reason from curations
     where project_id in ('c0000000-0000-4000-8000-0000000000b1', 'c0000000-0000-4000-8000-0000000000b2')
       and computed_at > now() - interval '1 hour'
     order by passed desc $$,
  $$ values (true, 'live_now'::text, null::text), (false, null::text, 'Cek kunci belum lengkap'::text) $$,
  'anon reads passed, tab and public_fail_reason of curations');
select lives_ok(
  $$ select id, project_id, passed, tab, status_at, ended_on, public_fail_reason, coingecko_listed, computed_at, seq
     from curations $$,
  'anon can select every public curations column');
select results_eq(
  $$ select coingecko_listed from curations
     where project_id in ('c0000000-0000-4000-8000-0000000000b1', 'c0000000-0000-4000-8000-0000000000b2')
       and computed_at > now() - interval '1 hour'
     order by passed desc $$,
  $$ values (true), (null::boolean) $$,
  'anon reads coingecko_listed of curations (track record input, #43)');
select throws_ok($$ select worth_level from curations $$, '42501', null, 'anon cannot select curations.worth_level');
select throws_ok($$ select worth_points from curations $$, '42501', null, 'anon cannot select curations.worth_points');
select throws_ok($$ select reasons from curations $$, '42501', null, 'anon cannot select curations.reasons');
select throws_ok($$ select coverage from curations $$, '42501', null, 'anon cannot select curations.coverage');
select results_eq(
  $$ select kind from ai_analyses where project_id = 'c0000000-0000-4000-8000-0000000000b1' order by kind $$,
  $$ values ('contradictions'::text) $$,
  'anon sees only contradictions analyses (analyst and scam are member-only, #54)');
select is(
  (select count(*)::int from project_signals where project_id = 'c0000000-0000-4000-8000-0000000000b1'), 7,
  'anon reads project_signals');
-- 30-31.
select is((select status from link_checks where url = 'https://claim.curation.test/'), 'official', 'anon reads link_checks');
select is(
  (select text_id from tasks where project_id = 'c0000000-0000-4000-8000-0000000000b1'), 'Bridge ke Ink',
  'anon reads tasks.text_id');
-- 32-35. Service-role-only tables.
select throws_ok($$ select * from vc_portfolios $$, '42501', null, 'anon cannot select vc_portfolios');
select throws_ok($$ select * from alphadrops_raises $$, '42501', null, 'anon cannot select alphadrops_raises');
select is(pg_temp.visible_rows('public.vc_portfolios'), 0::bigint, 'anon reads no vc_portfolios rows');
select is(pg_temp.visible_rows('public.alphadrops_raises'), 0::bigint, 'anon reads no alphadrops_raises rows');
-- 36-41. No writes.
select throws_ok(
  $$ insert into project_signals (project_id, kind, value, source, verified, observed_at) values
       ('c0000000-0000-4000-8000-0000000000b1', 'tvl', '{}', 'defillama', true, now()) $$,
  '42501', null, 'anon cannot insert into project_signals');
select throws_ok(
  $$ insert into curations (project_id, passed, status_at, computed_at) values
       ('c0000000-0000-4000-8000-0000000000b1', true, 'live', now()) $$,
  '42501', null, 'anon cannot insert into curations');
select throws_ok(
  $$ insert into ai_analyses (project_id, kind, input_hash, result, model, prompt_version) values
       ('c0000000-0000-4000-8000-0000000000b1', 'contradictions', 'h', '{}', 'm', 'v') $$,
  '42501', null, 'anon cannot insert into ai_analyses');
select throws_ok(
  $$ insert into link_checks (url, status, checked_at) values ('https://anon.curation.test/', 'official', now()) $$,
  '42501', null, 'anon cannot insert into link_checks');
select throws_ok(
  $$ insert into vc_portfolios (vc_id, domain, fetched_at) values ('anon', 'anon.test', now()) $$,
  '42501', null, 'anon cannot insert into vc_portfolios');
select throws_ok(
  $$ insert into alphadrops_raises (slug, rounds, fetched_at) values ('anon', '[]', now()) $$,
  '42501', null, 'anon cannot insert into alphadrops_raises');
-- 42-43.
select throws_ok($$ update curations set passed = true $$, '42501', null, 'anon cannot update curations');
select throws_ok($$ delete from project_signals $$, '42501', null, 'anon cannot delete project_signals');
-- 43a-43c. claim_pages is service role only: the page text is untrusted third-party content, read by the pipeline only.
select throws_ok($$ select * from claim_pages $$, '42501', null, 'anon cannot select claim_pages');
select is(pg_temp.visible_rows('public.claim_pages'), 0::bigint, 'anon reads no claim_pages rows');
select throws_ok(
  $$ insert into claim_pages (url, text, fetched_at) values ('https://anon.curation.test/', 'x', now()) $$,
  '42501', null, 'anon cannot insert into claim_pages');
reset role;

-- ---------- authenticated ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"c0000000-0000-4000-8000-00000000aaaa","role":"authenticated"}';
-- 44-46. Member reads.
select results_eq(
  $$ select worth_level, reasons->0->>'code', coverage->>'defillama' from curations
     where project_id = 'c0000000-0000-4000-8000-0000000000b1' $$,
  $$ values ('high'::text, 'tvl_high'::text, 'true'::text) $$,
  'authenticated reads worth_level, reasons and coverage of curations');
select results_eq(
  $$ select kind from ai_analyses where project_id = 'c0000000-0000-4000-8000-0000000000b1' order by kind $$,
  $$ values ('analyst'::text), ('contradictions'::text), ('scam'::text) $$,
  'authenticated sees every analysis kind');
select is(
  (select count(*)::int from project_signals where project_id = 'c0000000-0000-4000-8000-0000000000b1'), 7,
  'authenticated reads project_signals');
-- 47-50. Service-role-only tables.
select throws_ok($$ select * from vc_portfolios $$, '42501', null, 'authenticated cannot select vc_portfolios');
select throws_ok($$ select * from alphadrops_raises $$, '42501', null, 'authenticated cannot select alphadrops_raises');
select is(pg_temp.visible_rows('public.vc_portfolios'), 0::bigint, 'authenticated reads no vc_portfolios rows');
select is(pg_temp.visible_rows('public.alphadrops_raises'), 0::bigint, 'authenticated reads no alphadrops_raises rows');
-- 51-58. No writes.
select throws_ok(
  $$ insert into project_signals (project_id, kind, value, source, verified, observed_at) values
       ('c0000000-0000-4000-8000-0000000000b1', 'tvl', '{}', 'defillama', true, now()) $$,
  '42501', null, 'authenticated cannot insert into project_signals');
select throws_ok(
  $$ insert into curations (project_id, passed, status_at, computed_at) values
       ('c0000000-0000-4000-8000-0000000000b1', true, 'live', now()) $$,
  '42501', null, 'authenticated cannot insert into curations');
select throws_ok(
  $$ insert into ai_analyses (project_id, kind, input_hash, result, model, prompt_version) values
       ('c0000000-0000-4000-8000-0000000000b1', 'analyst', 'h', '{}', 'm', 'v') $$,
  '42501', null, 'authenticated cannot insert into ai_analyses');
select throws_ok(
  $$ insert into link_checks (url, status, checked_at) values ('https://member.curation.test/', 'official', now()) $$,
  '42501', null, 'authenticated cannot insert into link_checks');
select throws_ok(
  $$ insert into vc_portfolios (vc_id, domain, fetched_at) values ('member', 'member.test', now()) $$,
  '42501', null, 'authenticated cannot insert into vc_portfolios');
select throws_ok(
  $$ insert into alphadrops_raises (slug, rounds, fetched_at) values ('member', '[]', now()) $$,
  '42501', null, 'authenticated cannot insert into alphadrops_raises');
select throws_ok($$ update ai_analyses set model = 'x' $$, '42501', null, 'authenticated cannot update ai_analyses');
select throws_ok($$ delete from curations $$, '42501', null, 'authenticated cannot delete curations');
-- 58a-58c. claim_pages is service role only.
select throws_ok($$ select * from claim_pages $$, '42501', null, 'authenticated cannot select claim_pages');
select is(pg_temp.visible_rows('public.claim_pages'), 0::bigint, 'authenticated reads no claim_pages rows');
select throws_ok(
  $$ insert into claim_pages (url, text, fetched_at) values ('https://member.curation.test/', 'x', now()) $$,
  '42501', null, 'authenticated cannot insert into claim_pages');
reset role;

-- ---------- cascade ----------
-- 59-61. Deleting a project removes its signals, analyses and curations.
delete from projects where id = 'c0000000-0000-4000-8000-0000000000b1';
select is((select count(*)::int from project_signals where project_id = 'c0000000-0000-4000-8000-0000000000b1'), 0,
  'project_signals cascade on project delete');
select is((select count(*)::int from ai_analyses where project_id = 'c0000000-0000-4000-8000-0000000000b1'), 0,
  'ai_analyses cascade on project delete');
select is((select count(*)::int from curations where project_id = 'c0000000-0000-4000-8000-0000000000b1'), 0,
  'curations cascade on project delete');

select * from finish();
rollback;
