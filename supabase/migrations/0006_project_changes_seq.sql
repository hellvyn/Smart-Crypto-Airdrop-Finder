-- Insertion order of project_changes (Plan 3, Task 4). Merges in one pipeline run share the run's timestamp, so a
-- project's status can change twice with the same changed_at (A -> B -> C). The digest collapses changes per
-- project and field (old value of the first, new value of the last), which needs a deterministic tie-break, like
-- evidence.seq and risk_assessments.seq. Existing rows are numbered in their current physical order.
alter table project_changes add column seq bigint generated always as identity;
