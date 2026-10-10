-- Extraction v3 (Plan 4, Task 5; curation spec §4.6). `tasks` now holds the ordered `steps` of an extraction:
-- `position` is the step's index in the document's step list (order within one document), and `cadence` says
-- whether the step is done once or repeats daily/weekly. Rows written before 0009 (and writers that omit the
-- columns) get position 0 and cadence 'once'.
-- The other v3 fields (key parameters, source ratings, latest update, claimed backers, capital) are stored as
-- rows of the existing `evidence` table, so they need no schema change. Grants and RLS of `tasks` stay as in
-- 0001: public read, no writes for anon/authenticated.
alter table tasks
  add column position integer not null default 0,
  add column cadence text not null default 'once' check (cadence in ('once', 'daily', 'weekly'));
