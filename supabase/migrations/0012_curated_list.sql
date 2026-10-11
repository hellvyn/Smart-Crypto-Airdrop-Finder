-- The curated list (Plan 6, Task 3; curation spec §4.5, §7.1, §15.5): what the web reads for its three tabs.
-- Public vs member is locked here, not only in the UI, because the anon key is public (#45):
--   latest_curations  anon + authenticated  the latest curation of each project, public columns only;
--   public_list       anon + authenticated  projects whose latest curation passed, without worth, with how many of
--                                           the 4 key checks ran (key_checks_ran, through key_checks_ran());
--   curated_list      authenticated only    public_list + worth_level (the "Paling worth it" order is member-only).
-- Every view is security_invoker: it runs with the caller's rights, so RLS and the column grants of 0011 still apply.
-- That is also why public_list must never reference curations.worth_level/worth_points/reasons/coverage: anon has no
-- grant on them and would be refused the whole view.

-- Latest curation per project: greatest computed_at, ties broken by greatest seq (like risk_assessments). One index
-- lookup per project (curations_project_computed_idx) instead of sorting the whole history, which grows every run.
create view public.latest_curations with (security_invoker = true) as
select
  c.id,
  c.project_id,
  c.passed,
  c.tab,
  c.status_at,
  c.ended_on,
  c.public_fail_reason,
  c.coingecko_listed,
  c.computed_at,
  c.seq
from public.projects p
cross join lateral (
  select cu.id, cu.project_id, cu.passed, cu.tab, cu.status_at, cu.ended_on, cu.public_fail_reason, cu.coingecko_listed,
         cu.computed_at, cu.seq
  from public.curations cu
  where cu.project_id = p.id
  order by cu.computed_at desc, cu.seq desc
  limit 1
) c;

-- How many of the 4 key checks (dangerous_asks, phishing_list, domain_age, lookalike) ran in the latest risk assessment
-- of a project, for the row text "{k}/4 security check jalan" (Plan 6 Task 4). Security definer because public_list
-- runs with the caller's rights and 0013 takes risk_assessments.checks away from anon (the advanced checks in it are
-- member-only, #54): this function hands out only the key-check count, which is public, never the checks themselves.
-- A check listed twice counts once; "ran" must be the boolean true; a checks value that is not an array counts as 0.
-- The four ids are `KEY_CHECKS` of @saf/core (packages/core/src/curate/curate.ts), the checks curate() requires;
-- apps/web/test/key-checks-sql.test.ts fails if this list and that constant drift apart.
create function public.key_checks_ran(p_project_id uuid)
  returns integer
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select count(distinct c->>'id')::integer
  from (
    select ra.checks
    from public.risk_assessments ra
    where ra.project_id = p_project_id
    order by ra.computed_at desc, ra.seq desc
    limit 1
  ) latest
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(latest.checks) = 'array' then latest.checks else '[]'::jsonb end
  ) c
  where c->>'id' in ('dangerous_asks', 'phishing_list', 'domain_age', 'lookalike')
    and c->'ran' = 'true'::jsonb;
$$;

revoke all on function public.key_checks_ran(uuid) from public, anon, authenticated;
grant execute on function public.key_checks_ran(uuid) to anon, authenticated;

create view public.public_list with (security_invoker = true) as
select
  pl.id,
  pl.slug,
  pl.name,
  pl.status,
  pl.chains,
  pl.chains_lower,
  pl.last_seen,
  pl.next_deadline_date,
  pl.next_deadline_kind,
  pl.next_deadline_precision,
  pl.latest_risk_level,
  lc.id as curation_id,
  lc.tab,
  lc.ended_on,
  -- "Dicek {waktu}" (#44).
  lc.computed_at as checked_at,
  coalesce(sig.signals, '[]'::jsonb) as signals,
  sig.signal_rank,
  -- "Claim open · link dicek" (#42): a claim deadline from today (UTC) on, and at least one claim link, every one of
  -- them checked as official (a link without a link_checks row was not checked, so it is not official).
  (
    exists (
      select 1 from public.deadlines d
      where d.project_id = pl.id and d.kind = 'claim' and d.date >= (now() at time zone 'utc')::date
    )
    and exists (select 1 from public.links l where l.project_id = pl.id and l.kind = 'claim')
    and not exists (
      select 1
      from public.links l
      left join public.link_checks lk on lk.url = l.url
      where l.project_id = pl.id and l.kind = 'claim' and lk.status is distinct from 'official'
    )
  ) as claim_open_checked,
  cap.capital,
  capmin.capital_min_usd,
  -- "{k}/4 security check jalan".
  public.key_checks_ran(pl.id) as key_checks_ran
from public.project_list pl
join public.latest_curations lc on lc.project_id = pl.id and lc.passed
-- Signals curation used: P5 keeps a signal through a source outage but curation ignores one observed more than
-- 14 days ago, so the list leaves it out too and never shows a badge curation did not use.
left join lateral (
  select
    jsonb_agg(
      jsonb_build_object('kind', s.kind, 'value', s.value, 'verified', s.verified, 'source', s.source,
                         'observed_at', s.observed_at)
      order by s.kind, s.source, s.value::text
    ) as signals,
    -- Strongest signal, for the member order (§6.3): verified VC, verified TVL, CoinGecko listing, curated source.
    min(case
      when s.kind = 'vc_backer' and s.verified then 1
      when s.kind = 'tvl' and s.verified then 2
      when s.kind = 'coingecko_listed' and s.verified then 3
      when s.kind = 'curated_source' then 4
    end) as signal_rank
  from public.project_signals s
  where s.project_id = pl.id and s.observed_at >= now() - interval '14 days'
) sig on true
-- Capital (#52), from the latest capital_required fact of each document: any source saying low/high -> deposit;
-- every source that mentions it saying none -> free; no source -> unknown.
left join lateral (
  select case
    when bool_or(f.value in ('low', 'high')) then 'deposit'
    when bool_and(f.value = 'none') then 'free'
    else 'unknown'
  end as capital
  from (
    select distinct on (e.document_id) e.value
    from public.evidence e
    where e.project_id = pl.id and e.field = 'capital_required'
    order by e.document_id, e.at desc, e.seq desc
  ) f
) cap on true
-- The smallest minimum any source states, from the latest capital_min_usd fact of each document. A value that is not
-- a plain number is skipped: a failed cast would take the whole list down.
left join lateral (
  select min(f.value::numeric) as capital_min_usd
  from (
    select distinct on (e.document_id) e.value
    from public.evidence e
    where e.project_id = pl.id and e.field = 'capital_min_usd'
    order by e.document_id, e.at desc, e.seq desc
  ) f
  where f.value ~ '^[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]{1,3})?$'
) capmin on true;

-- Member list: the public list plus the latest curation's worth level and its sort rank (high first).
create view public.curated_list with (security_invoker = true) as
select
  p.*,
  c.worth_level,
  case c.worth_level
    when 'high' then 1
    when 'medium' then 2
    when 'low' then 3
    when 'insufficient_data' then 4
  end as worth_rank
from public.public_list p
join public.curations c on c.id = p.curation_id;

-- Privileges: start from nothing (Supabase's default privileges grant everything on new views), then grant reads.
revoke all on public.latest_curations, public.public_list, public.curated_list from anon, authenticated;
grant select on public.latest_curations, public.public_list to anon, authenticated;
grant select on public.curated_list to authenticated;
