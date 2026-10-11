-- The point total behind curations.worth_level, so the owner's worth review (gate G10) can show why a project ranks
-- where it does. Null on rows stored before this column existed. Member-only like worth_level: anon's column-level
-- grant on curations (0011) lists its columns one by one, so a new column is not readable by anon.
alter table curations add column worth_points integer;
