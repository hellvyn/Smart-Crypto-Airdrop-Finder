-- pgTAP tests for 0009_extraction_v3.sql: tasks hold ordered extraction steps with a cadence (curation spec §4.6).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(17);

select has_column('public', 'tasks', 'position', 'tasks has a position column');
select col_type_is('public', 'tasks', 'position', 'integer', 'position is an integer');
select col_not_null('public', 'tasks', 'position', 'position is not null');
select has_column('public', 'tasks', 'cadence', 'tasks has a cadence column');
select col_type_is('public', 'tasks', 'cadence', 'text', 'cadence is text');
select col_not_null('public', 'tasks', 'cadence', 'cadence is not null');
select has_column('public', 'extractions', 'served_model', 'extractions still has the served_model column from 0008');

insert into documents (id, source_kind, source_key, url, text, content_hash, fetched_at) values
  ('e3000000-0000-4000-8000-0000000000d1', 'airdrops_io', 'airdrops.io', 'https://extraction-v3.test/a', 't', 'h', now());
insert into projects (id, slug, name, name_key, first_seen, last_seen) values
  ('e3000000-0000-4000-8000-0000000000b1', 'extraction-v3-test', 'V3 Test', 'v3test', now(), now());

-- A row written the old way (no position, no cadence; e.g. the web e2e seed) gets the defaults.
insert into tasks (project_id, document_id, description) values
  ('e3000000-0000-4000-8000-0000000000b1', 'e3000000-0000-4000-8000-0000000000d1', 'Bridge');
select is(
  (select (position, cadence)::text from tasks where description = 'Bridge'),
  '(0,once)',
  'a task inserted without position or cadence defaults to position 0, cadence once');

select lives_ok(
  $$ insert into tasks (project_id, document_id, description, position, cadence) values
       ('e3000000-0000-4000-8000-0000000000b1', 'e3000000-0000-4000-8000-0000000000d1', 'Check in', 1, 'daily'),
       ('e3000000-0000-4000-8000-0000000000b1', 'e3000000-0000-4000-8000-0000000000d1', 'Vote', 2, 'weekly') $$,
  'daily and weekly cadences are accepted');
select throws_ok(
  $$ insert into tasks (project_id, document_id, description, position, cadence) values
       ('e3000000-0000-4000-8000-0000000000b1', 'e3000000-0000-4000-8000-0000000000d1', 'Spin', 3, 'hourly') $$,
  '23514', null, 'an unknown cadence violates the check constraint');

-- Grants regression: the web roles still cannot write tasks, and can still read them (as before 0009).
set local role anon;
select throws_ok(
  $$ insert into tasks (project_id, document_id, description) values
       ('e3000000-0000-4000-8000-0000000000b1', 'e3000000-0000-4000-8000-0000000000d1', 'Pwn') $$,
  '42501', null, 'anon cannot insert into tasks');
select is(
  (select array_agg(description || ':' || cadence order by position) from tasks
     where project_id = 'e3000000-0000-4000-8000-0000000000b1'),
  array['Bridge:once', 'Check in:daily', 'Vote:weekly'],
  'anon can still read tasks, including position and cadence');
reset role;

set local role authenticated;
select throws_ok(
  $$ insert into tasks (project_id, document_id, description) values
       ('e3000000-0000-4000-8000-0000000000b1', 'e3000000-0000-4000-8000-0000000000d1', 'Pwn') $$,
  '42501', null, 'authenticated cannot insert into tasks');
select is(
  (select count(*)::int from tasks where project_id = 'e3000000-0000-4000-8000-0000000000b1'),
  3,
  'authenticated can still read tasks');
reset role;

-- AlphaDrops collector (Task 9): 'alphadrops' is a document source kind; the existing kinds stay valid and
-- unknown kinds are still refused.
select lives_ok(
  $$ insert into documents (source_kind, source_key, url, text, content_hash, fetched_at) values
       ('alphadrops', 'alphadrops', 'https://alphadrops.net/airdrops/extraction-v3-test', 't', 'h', now()) $$,
  'an alphadrops document is accepted');
select lives_ok(
  $$ insert into documents (source_kind, source_key, url, text, content_hash, fetched_at) values
       ('telegram', 'airdrops_io', 'https://t.me/extraction_v3_test/1', 't', 'h', now()),
       ('defillama', 'defillama', 'https://defillama.com/protocol/extraction-v3-test', 't', 'h', now()) $$,
  'telegram and defillama documents are still accepted');
select throws_ok(
  $$ insert into documents (source_kind, source_key, url, text, content_hash, fetched_at) values
       ('alphadrop', 'alphadrops', 'https://extraction-v3.test/unknown-kind', 't', 'h', now()) $$,
  '23514', null, 'an unknown source kind violates the check constraint');

select * from finish();
rollback;
