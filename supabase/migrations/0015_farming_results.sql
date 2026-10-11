-- Airdrop results "Hasil garapan" (#51; Plan 6, Task 8). After a farmed project ends, the member records how much they
-- got (or "Gak dapet"), and the web stores its USD value at the claim date. Private per member like the rest of the
-- tracker (0010_farming.sql): every row is readable and writable only by its owner, anon gets nothing.
-- Members may opt in (share_anonymous) to an anonymous average per project, read only through
-- farming_result_stats(), which returns a count and an average and nothing per person.
--
-- Also: archived_at on farming_tasks and farming_projects is the server's now() whenever it is set or changed. The
-- column grants of 0010 let a member write any value there, and a backdated archive rewrites past heatmap totals
-- ("hari lalu gak bisa diubah").

create table farming_results (
  user_id uuid not null,
  project_id uuid not null,
  -- Tokens received; null only for "Gak dapet".
  amount numeric check (amount > 0 and amount <= 1e15),
  no_reward boolean not null default false,
  claimed_on date,
  -- amount x the token's USD price on claimed_on, written by the web; null when no price was found.
  usd_at_claim numeric check (usd_at_claim >= 0),
  share_anonymous boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, project_id),
  -- Only a project the member farms (or farmed: a stopped farming row stays); goes with it, its project and its user.
  foreign key (user_id, project_id) references farming_projects (user_id, project_id) on delete cascade,
  check (no_reward or amount is not null)
);
create index farming_results_project_id_idx on farming_results (project_id);

alter table farming_results enable row level security;

-- Privileges: nothing for anon, and for authenticated only what the owner-only policies below need. updated_at is
-- the server's (trigger below); the key columns cannot be updated, so a result never moves to another project.
revoke all on farming_results from anon, authenticated;
grant select, delete on farming_results to authenticated;
grant insert (user_id, project_id, amount, no_reward, claimed_on, usd_at_claim, share_anonymous)
  on farming_results to authenticated;
grant update (amount, no_reward, claimed_on, usd_at_claim, share_anonymous) on farming_results to authenticated;

create policy "own farming results read" on farming_results for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own farming results insert" on farming_results for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "own farming results update" on farming_results for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy "own farming results delete" on farming_results for delete to authenticated
  using (user_id = (select auth.uid()));

-- updated_at is always the time of the last write, whatever the writer sent.
create function public.stamp_farming_result_updated_at() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function public.stamp_farming_result_updated_at() from public, anon, authenticated;

create trigger farming_results_updated_at
  before update on farming_results
  for each row execute function public.stamp_farming_result_updated_at();

-- Anonymous member average for one project: the results whose owner opted in (share_anonymous) and that have a USD
-- value, a "Gak dapet" counting as $0. avg_usd is null below 5 contributors, so no single result can be read off it.
-- Security definer because RLS shows a member only their own rows; it returns two aggregates and never a user id or
-- an amount of one person. Members only (authenticated); anon cannot execute it.
create function public.farming_result_stats(p_project_id uuid)
  returns table (contributors integer, avg_usd numeric)
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  return query
    select s.n::integer,
           case when s.n >= 5 then round(s.total / s.n, 2) end
    from (
      select count(*) as n, sum(case when r.no_reward then 0 else r.usd_at_claim end) as total
      from public.farming_results r
      where r.project_id = p_project_id
        and r.share_anonymous
        and (r.no_reward or r.usd_at_claim is not null)
    ) s;
end;
$$;
revoke execute on function public.farming_result_stats(uuid) from public, anon;
grant execute on function public.farming_result_stats(uuid) to authenticated;

-- archived_at is the server's now() whenever it is set or changed (controller ruling, Plan 8 wave review M3). Clearing
-- it (resume) stays possible, and an update that leaves it alone keeps it. Applies to every writer.
create function public.stamp_archived_at() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if new.archived_at is not null and new.archived_at is distinct from old.archived_at then
    new.archived_at := now();
  end if;
  return new;
end;
$$;
revoke execute on function public.stamp_archived_at() from public, anon, authenticated;

create trigger farming_tasks_archived_at
  before update of archived_at on farming_tasks
  for each row execute function public.stamp_archived_at();
create trigger farming_projects_archived_at
  before update of archived_at on farming_projects
  for each row execute function public.stamp_archived_at();
