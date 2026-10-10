-- Farming tracker "Garapan saya" (Plan 8, Task 1; curation spec §14). Private per member: every row is readable and
-- writable only by its owner, anon gets nothing. A "day" is the member's local date in profiles.timezone, computed
-- by the server; checks are written only through toggle_farming_check(), for today, so a client never sends a date.
-- Deleting the auth user or the project cascades to everything here.

-- A project the member farms. "Berhenti garap" archives the row; the history stays.
create table farming_projects (
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references projects (id) on delete cascade,
  started_at timestamptz not null default now(),
  archived_at timestamptz,
  primary key (user_id, project_id)
);
create index farming_projects_project_id_idx on farming_projects (project_id);

-- One checklist item: a step copied from the source ('source') or added by the member ('custom').
-- The text never changes after insert, so past checks keep the text they were made for.
create table farming_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null,
  text text not null check (char_length(text) between 1 and 200),
  cadence text not null check (cadence in ('once', 'daily', 'weekly')),
  origin text not null check (origin in ('source', 'custom')),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  foreign key (user_id, project_id) references farming_projects (user_id, project_id) on delete cascade
);
create index farming_tasks_user_project_idx on farming_tasks (user_id, project_id);

-- A task done on a member-local day. user_id is copied from the task for RLS.
create table farming_checks (
  task_id uuid not null references farming_tasks (id) on delete cascade,
  user_id uuid not null,
  day date not null,
  checked_at timestamptz not null default now(),
  primary key (task_id, day)
);
create index farming_checks_user_day_idx on farming_checks (user_id, day);

alter table farming_projects enable row level security;
alter table farming_tasks enable row level security;
alter table farming_checks enable row level security;

-- Privileges: start from nothing for the web roles, then grant exactly what each table needs.
revoke all on farming_projects, farming_tasks, farming_checks from anon, authenticated;

-- started_at is always the server's now(); only archiving/resuming is an update.
grant select, delete on farming_projects to authenticated;
grant insert (user_id, project_id) on farming_projects to authenticated;
grant update (archived_at) on farming_projects to authenticated;
create policy "own farming projects read" on farming_projects for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own farming projects insert" on farming_projects for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "own farming projects update" on farming_projects for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy "own farming projects delete" on farming_projects for delete to authenticated
  using (user_id = (select auth.uid()));

-- id, created_at and archived_at come from defaults on insert; afterwards only order and archiving change.
grant select, delete on farming_tasks to authenticated;
grant insert (user_id, project_id, text, cadence, origin, position) on farming_tasks to authenticated;
grant update (position, archived_at) on farming_tasks to authenticated;
create policy "own farming tasks read" on farming_tasks for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own farming tasks insert" on farming_tasks for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "own farming tasks update" on farming_tasks for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy "own farming tasks delete" on farming_tasks for delete to authenticated
  using (user_id = (select auth.uid()));

-- Read only: checks are written and removed only by toggle_farming_check(), and only for today, so a past day never
-- changes. No insert, update or delete grant (a direct delete fails with 42501). Cascades from the task, the farming
-- project, the project and the user do not need the privilege.
grant select on farming_checks to authenticated;
create policy "own farming checks read" on farming_checks for select to authenticated
  using (user_id = (select auth.uid()));

-- Limits: 50 active farming projects per member, 30 active tasks per farming project. They apply when a row becomes
-- active: on insert, and when an archived row is resumed. The advisory lock (per member, its own key space)
-- serialises concurrent writers so two tabs cannot both take the last slot.
-- A BEFORE INSERT trigger runs before ON CONFLICT is decided, so an insert of a (user_id, project_id) that already
-- exists skips the check: "insert ... on conflict do nothing" on an already-farmed project stays a no-op at 50 active.
-- Without ON CONFLICT such an insert still ends in the primary key error (23505).
create function public.enforce_farming_project_limit() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and exists (select 1 from public.farming_projects fp
                                  where fp.user_id = new.user_id and fp.project_id = new.project_id) then
    return new;
  end if;
  if new.archived_at is null and (tg_op = 'INSERT' or old.archived_at is not null) then
    perform pg_advisory_xact_lock(hashtextextended('farming:' || new.user_id::text, 0));
    if (select count(*) from public.farming_projects fp
        where fp.user_id = new.user_id and fp.archived_at is null) >= 50 then
      raise exception 'farming project limit reached (50)' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.enforce_farming_project_limit() from public, anon, authenticated;

create trigger farming_projects_limit
  before insert or update of archived_at on farming_projects
  for each row execute function public.enforce_farming_project_limit();

-- A task cannot be inserted into a stopped (archived) farming project: toggle_farming_check() refuses such tasks anyway
-- (22023), so a task there could never be checked. The insert fails with 23514 instead. The parent row is locked FOR
-- SHARE so a concurrent "Berhenti garap" cannot slip in between this check and the insert. A missing parent is left
-- to the foreign key (23503).
create function public.enforce_farming_task_limit() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_project_active boolean;
begin
  if tg_op = 'INSERT' then
    select fp.archived_at is null into v_project_active
    from public.farming_projects fp
    where fp.user_id = new.user_id and fp.project_id = new.project_id
    for share;
    if v_project_active is false then
      raise exception 'farming project is stopped' using errcode = '23514';
    end if;
  end if;
  if new.archived_at is null and (tg_op = 'INSERT' or old.archived_at is not null) then
    perform pg_advisory_xact_lock(hashtextextended('farming:' || new.user_id::text, 0));
    if (select count(*) from public.farming_tasks ft
        where ft.user_id = new.user_id and ft.project_id = new.project_id and ft.archived_at is null) >= 30 then
      raise exception 'farming task limit reached (30)' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.enforce_farming_task_limit() from public, anon, authenticated;

create trigger farming_tasks_limit
  before insert or update of archived_at on farming_tasks
  for each row execute function public.enforce_farming_task_limit();

-- Today in the caller's profile timezone (UTC when the profile has none).
create function public.farming_today() returns date
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select (now() at time zone coalesce(
    (select p.timezone from public.profiles p where p.user_id = (select auth.uid())), 'UTC'))::date;
$$;

-- Check (p_done = true) or uncheck one of the caller's active tasks for today, and return the resulting state.
-- Idempotent per (task, day), so two tabs toggling at once leave one row. A 'once' task is done once, not on a day:
-- checking adds today's row only when the task has none, unchecking removes all of its rows.
create function public.toggle_farming_check(p_task_id uuid, p_done boolean) returns boolean
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_cadence text;
  v_active boolean;
  v_today date;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_done is null then
    raise exception 'p_done is required' using errcode = '22023';
  end if;

  -- The row lock serialises toggles of the same task (two tabs, or a day boundary between them).
  select t.cadence, (t.archived_at is null and fp.archived_at is null)
    into v_cadence, v_active
  from public.farming_tasks t
  join public.farming_projects fp on fp.user_id = t.user_id and fp.project_id = t.project_id
  where t.id = p_task_id
    and t.user_id = v_uid
  for no key update of t;
  if not found then
    raise exception 'task not found' using errcode = '42501';
  end if;
  if not v_active then
    raise exception 'task is archived' using errcode = '22023';
  end if;

  v_today := public.farming_today();

  if v_cadence = 'once' then
    if p_done then
      if not exists (select 1 from public.farming_checks c where c.task_id = p_task_id) then
        insert into public.farming_checks (task_id, user_id, day) values (p_task_id, v_uid, v_today);
      end if;
    else
      delete from public.farming_checks c where c.task_id = p_task_id;
    end if;
  else
    if p_done then
      insert into public.farming_checks (task_id, user_id, day) values (p_task_id, v_uid, v_today)
      on conflict (task_id, day) do nothing;
    else
      delete from public.farming_checks c where c.task_id = p_task_id and c.day = v_today;
    end if;
  end if;

  return p_done;
end;
$$;

revoke execute on function public.farming_today() from public, anon;
revoke execute on function public.toggle_farming_check(uuid, boolean) from public, anon;
grant execute on function public.farming_today() to authenticated;
grant execute on function public.toggle_farming_check(uuid, boolean) to authenticated;
