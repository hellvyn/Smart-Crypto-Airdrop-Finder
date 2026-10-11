-- "Perubahan sejak kunjungan terakhir" (Plan 6 Task 7; decisions #34, #57). The web shows a member the changes of the
-- projects on their watchlist since they last marked them seen, in place of the dropped email digest (0007).
--
-- project_changes was service-role only (0001: no policy; anon/authenticated kept the default SELECT, REFERENCES
-- and TRIGGER privileges, which RLS made useless). Nothing public reads it: the pipeline writes it with the service
-- role and the digest that read it is gone (0007). Now anon gets nothing at all and a member reads only the changes
-- of projects on their own watchlist.

-- When a change was written. changed_at is the run's start time, shared by every change of a run, so a member who
-- marks the changes seen while a run is still writing would never see the rest of that run if the feed filtered on
-- changed_at. Existing rows take their changed_at; new ones get the database's now().
alter table public.project_changes add column recorded_at timestamptz;
update public.project_changes set recorded_at = changed_at;
alter table public.project_changes
  alter column recorded_at set default now(),
  alter column recorded_at set not null;

revoke all on public.project_changes from anon, authenticated;
grant select on public.project_changes to authenticated;
create policy "watched project changes read" on public.project_changes for select to authenticated
  using (exists (
    select 1 from public.watchlist w
    where w.user_id = (select auth.uid()) and w.project_id = project_changes.project_id
  ));

-- When the member last marked the changes seen; null until the first time. The table-level SELECT of 0002 covers the
-- new column, and the "own profile ..." policies of 0002 keep both reading and updating to the member's own row.
alter table public.profiles add column changes_seen_at timestamptz;
grant update (changes_seen_at) on public.profiles to authenticated;

-- changes_seen_at is always the server's now() when it is written, whatever the writer sent: the web never sends a
-- time of its own, and a member cannot backdate or postdate it through the API.
create function public.stamp_changes_seen_at() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  new.changes_seen_at := now();
  return new;
end;
$$;
revoke execute on function public.stamp_changes_seen_at() from public, anon, authenticated;

create trigger profiles_changes_seen_at
  before update of changes_seen_at on public.profiles
  for each row execute function public.stamp_changes_seen_at();
