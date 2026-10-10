-- Read models for the public web pages (Plan 2, Task 3). The airdrop list is filtered, ordered and paged in SQL,
-- so it never depends on PostgREST's 1000-row cap. security_invoker: the views run with the caller's rights, so the
-- "public read" policies on the base tables still decide what anon and authenticated can see.

create view public.project_list with (security_invoker = true) as
select
  p.id,
  p.slug,
  p.name,
  p.status,
  p.chains,
  -- Trimmed (ASCII whitespace), lowercased copy without blank names, so the chain filter is a case-insensitive
  -- `chains_lower @> array['base']` that also matches a scraped "Base " (same normalisation as project_chains).
  coalesce(
    (select array_agg(distinct lower(btrim(c, E' \t\n\r\f\x0b')) order by lower(btrim(c, E' \t\n\r\f\x0b')))
     from unnest(p.chains) as c
     where btrim(c, E' \t\n\r\f\x0b') <> ''),
    '{}'::text[]
  ) as chains_lower,
  p.last_seen,
  d.date as next_deadline_date,
  d.kind as next_deadline_kind,
  d.precision as next_deadline_precision,
  r.level as latest_risk_level
from public.projects p
-- Earliest deadline from today (UTC) on whose date is exact or approximate; month and quarter dates do not count.
left join lateral (
  select dl.date, dl.kind, dl.precision
  from public.deadlines dl
  where dl.project_id = p.id
    and dl.date >= (now() at time zone 'utc')::date
    and dl.precision in ('exact', 'approximate')
  order by dl.date asc, dl.id asc
  limit 1
) d on true
-- Latest risk assessment: greatest computed_at, ties broken by greatest seq.
left join lateral (
  select ra.level
  from public.risk_assessments ra
  where ra.project_id = p.id
  order by ra.computed_at desc, ra.seq desc
  limit 1
) r on true;

-- Distinct trimmed, lowercase chain names, for the chain filter (same normalisation as project_list.chains_lower).
create view public.project_chains with (security_invoker = true) as
select distinct lower(btrim(c, E' \t\n\r\f\x0b')) as chain
from public.projects p, unnest(p.chains) as c
where btrim(c, E' \t\n\r\f\x0b') <> '';

-- Read-only for the web roles.
revoke all on public.project_list, public.project_chains from anon, authenticated;
grant select on public.project_list, public.project_chains to anon, authenticated;
