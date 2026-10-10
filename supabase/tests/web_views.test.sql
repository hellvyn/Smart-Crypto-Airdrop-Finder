-- pgTAP tests for 0003_web_views.sql: project_list and project_chains are readable by anon and compute the right row.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(14);

insert into projects (id, slug, name, name_key, chains, status, first_seen, last_seen) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'v-one', 'V One', 'vone', '{Ethereum,Base}', 'live', now(), now()),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'v-two', 'V Two', 'vtwo', '{}', 'unknown', now(), now() - interval '1 day');

insert into documents (id, source_kind, source_key, url, content_hash, fetched_at) values
  ('dddddddd-0000-0000-0000-000000000001', 'airdrops_io', 'k', 'https://v.example/1', 'h', now());

insert into deadlines (project_id, document_id, kind, date, precision, text) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001', 'claim', current_date - 3, 'exact', 'past'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001', 'tge', current_date + 1, 'quarter', 'quarter'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001', 'snapshot', current_date + 20, 'approximate', 'later'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001', 'claim', current_date + 5, 'exact', 'soon');

insert into risk_assessments (project_id, level, points, computed_at) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'low', 0, '2026-10-01T00:00:00Z'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'medium', 10, '2026-10-02T00:00:00Z'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'high', 30, '2026-10-02T00:00:00Z'); -- same time, later seq wins

set local role anon;

select lives_ok($$ select * from project_list $$, 'anon can select project_list');
select lives_ok($$ select * from project_chains $$, 'anon can select project_chains');
select is(
  has_table_privilege('anon', 'public.project_list', 'insert,update,delete')
  or has_table_privilege('authenticated', 'public.project_list', 'insert,update,delete'),
  false, 'web roles hold no write privilege on project_list');

select results_eq(
  $$ select next_deadline_date - current_date, next_deadline_kind, next_deadline_precision
     from project_list where slug = 'v-one' $$,
  $$ values (5, 'claim'::text, 'exact'::text) $$,
  'next deadline is the earliest future exact/approximate one (not past, not quarter)');
select is((select latest_risk_level from project_list where slug = 'v-one'), 'high', 'latest risk: max computed_at, tiebreak seq desc');
select is((select chains_lower from project_list where slug = 'v-one'), '{base,ethereum}'::text[], 'chains_lower is lowercased');
select ok((select count(*) = 1 from project_list where chains_lower @> array['ethereum'] and slug = 'v-one'), 'case-insensitive chain match works');
select is((select next_deadline_date from project_list where slug = 'v-two'), null, 'no deadline gives null');
select is((select latest_risk_level from project_list where slug = 'v-two'), null, 'no assessment gives null risk');
select is((select chains_lower from project_list where slug = 'v-two'), '{}'::text[], 'empty chains give an empty lowercase array');
select is((select count(*)::int from project_list), 2, 'one row per project');
select results_eq(
  $$ select chain from project_chains where chain in ('base','ethereum') order by chain $$,
  $$ values ('base'::text), ('ethereum'::text) $$,
  'project_chains has distinct lowercase chains');
select is((select count(*)::int from project_chains where chain <> lower(chain)), 0, 'project_chains has no mixed-case value');
select is((select count(*)::int from documents), 0, 'anon still sees no documents (RLS, no policy)');

reset role;
select * from finish();
rollback;
