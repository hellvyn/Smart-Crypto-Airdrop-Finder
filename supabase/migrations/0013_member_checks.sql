-- What each risk check looked at (Plan 6 Task 5; decisions #53, #54). risk_assessments.checks now carries a `detail`
-- per check (packages/core RiskCheck). The 4 key checks and their detail are public, like the security check block of
-- the project page; the details of the other ("advanced") checks are member-only. Locked here, not only in the UI,
-- because the anon key is public:
--   anon            risk_assessments without the checks column, and public_risk_checks (key checks with detail,
--                   advanced checks as id, ran and flagged only);
--   authenticated   every column of risk_assessments, as before, and public_risk_checks.
-- Every view anon already read keeps working: project_list (0003) reads risk_assessments.level only, and
-- public_list.key_checks_ran (0012) goes through the security definer function key_checks_ran().

-- A column-level REVOKE does not take away a table-level grant, so anon loses the table-level SELECT and gets back every
-- column except checks. A column added later is not readable by anon unless it is listed here. Nothing else changes:
-- 0001 already revoked the writes; REFERENCES and TRIGGER stay as Supabase's default privileges left them.
revoke select on public.risk_assessments from anon;
grant select (id, project_id, level, points, reasons, computed_at, seq) on public.risk_assessments to anon;

-- One row per assessed project, from its latest assessment (greatest computed_at, ties broken by greatest seq).
--   key_checks       the dangerous_asks, phishing_list, domain_age and lookalike entries in stored order, as
--                    { id, ran, detail } (no detail key on a row stored before details existed);
--   advanced_checks  every other entry, as { id, ran, flagged } only: flagged = the assessment has a warning that
--                    check raised (the reason-to-check map below is CHECK_OF_REASON of @saf/core,
--                    packages/core/src/risk/assess.ts; apps/web/test/member-checks-sql.test.ts fails if they drift).
-- ran is true only for the JSON boolean true; checks or reasons that are not an array count as empty.
-- Security definer (security_invoker off, owner postgres): it reads risk_assessments.checks for anon, and hands out
-- only the parts above.
create view public.public_risk_checks with (security_invoker = false) as
select
  ra.project_id,
  ra.id as assessment_id,
  ra.computed_at,
  coalesce((
    select jsonb_agg(
      case
        when e.c ? 'detail' then
          jsonb_build_object('id', e.c->'id', 'ran', coalesce(e.c->'ran' = 'true'::jsonb, false), 'detail', e.c->'detail')
        else jsonb_build_object('id', e.c->'id', 'ran', coalesce(e.c->'ran' = 'true'::jsonb, false))
      end
      order by e.ord)
    from jsonb_array_elements(ra.checks) with ordinality e(c, ord)
    where e.c->>'id' in ('dangerous_asks', 'phishing_list', 'domain_age', 'lookalike')
  ), '[]'::jsonb) as key_checks,
  coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', e.c->'id',
        'ran', coalesce(e.c->'ran' = 'true'::jsonb, false),
        'flagged', exists (
          select 1
          from jsonb_array_elements(ra.reasons) r
          join (values
            ('asks_secret', 'dangerous_asks'),
            ('asks_payment', 'dangerous_asks'),
            ('phishing_listed', 'phishing_list'),
            ('phishing_claim_link', 'phishing_list'),
            ('young_domain', 'domain_age'),
            ('new_claim_domain', 'domain_age'),
            ('lookalike_domain', 'lookalike'),
            ('token_honeypot', 'token_security'),
            ('token_owner_powers', 'token_security'),
            ('malicious_creator', 'token_security'),
            ('unverified_contract', 'contract_verified'),
            ('hack_history', 'hack_history'),
            ('single_source', 'corroboration'),
            ('conflicting_evidence', 'corroboration'),
            ('ai_contradiction', 'corroboration'),
            ('ai_scam_pattern', 'ai_review')
          ) m(reason_code, check_id) on m.reason_code = r->>'code'
          where m.check_id = e.c->>'id'
        )
      )
      order by e.ord)
    from jsonb_array_elements(ra.checks) with ordinality e(c, ord)
    where e.c->>'id' not in ('dangerous_asks', 'phishing_list', 'domain_age', 'lookalike')
  ), '[]'::jsonb) as advanced_checks
from public.projects p
cross join lateral (
  select
    r.id,
    r.project_id,
    r.computed_at,
    case when jsonb_typeof(r.checks) = 'array' then r.checks else '[]'::jsonb end as checks,
    case when jsonb_typeof(r.reasons) = 'array' then r.reasons else '[]'::jsonb end as reasons
  from public.risk_assessments r
  where r.project_id = p.id
  order by r.computed_at desc, r.seq desc
  limit 1
) ra;

alter view public.public_risk_checks owner to postgres;

-- Privileges: start from nothing (Supabase's default privileges grant everything on new views), then grant reads.
revoke all on public.public_risk_checks from anon, authenticated;
grant select on public.public_risk_checks to anon, authenticated;
