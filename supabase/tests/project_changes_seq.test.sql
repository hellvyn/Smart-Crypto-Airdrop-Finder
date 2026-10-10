-- pgTAP tests for 0006_project_changes_seq.sql: project_changes.seq follows insertion order.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(2);

insert into projects (id, slug, name, name_key, first_seen, last_seen) values
  ('5e900000-0000-4000-8000-000000000001', 'seq-test', 'Seq Test', 'seqtest', now(), now());
insert into project_changes (project_id, field, old_value, new_value, changed_at) values
  ('5e900000-0000-4000-8000-000000000001', 'status', 'announced', 'live', '2026-10-10T23:00:00Z'),
  ('5e900000-0000-4000-8000-000000000001', 'status', 'live', 'ended', '2026-10-10T23:00:00Z');

select has_column('public', 'project_changes', 'seq', 'project_changes has a seq column');
select results_eq(
  $$ select new_value from project_changes
     where project_id = '5e900000-0000-4000-8000-000000000001'
     order by changed_at, seq $$,
  $$ values ('live'), ('ended') $$,
  'changes with the same changed_at come back in insertion order');

select * from finish();
rollback;
