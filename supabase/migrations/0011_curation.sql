-- Curation foundation (Plan 5, Task 2; curation spec §4.1-4.4, §15). The pipeline writes every table here with the
-- service role (bypasses RLS). What the web roles may read is locked in the database, not only in the UI, because the
-- anon key is public (spec §15.5, #45):
--   anon + authenticated: project_signals, link_checks, tasks.text_id, ai_analyses of kind 'contradictions';
--   anon:                 only the non-worth columns of curations (worth_level, reasons, coverage are member-only);
--   authenticated:        every curations column and every ai_analyses kind ('analyst' and 'scam' are member-only, #54);
--   nobody:               vc_portfolios, alphadrops_raises (service role only).

-- One row per signal per project, rewritten every run (signals not found again are deleted).
create table project_signals (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  kind text not null check (kind in
    ('vc_backer', 'tvl', 'coingecko_listed', 'curated_source', 'claimed_backer', 'reported_backer')),
  value jsonb not null,
  source text not null check (source in
    ('vc_portfolio', 'defillama', 'airdrops_io', 'telegram', 'llm_text', 'alphadrops')),
  verified boolean not null,
  observed_at timestamptz not null,
  -- A backer the project only claims, or that AlphaDrops reports, is never verified.
  check (kind not in ('claimed_backer', 'reported_backer') or verified = false)
);
-- One signal per (project, kind, source, investor): a project can hold one kind from several sources at once
-- (e.g. curated_source from airdrops_io and alphadrops), and one backer kind per investor.
create unique index project_signals_unique_idx
  on project_signals (project_id, kind, source, coalesce(value->>'investor', ''));

-- AlphaDrops fundraising rounds per AlphaDrops slug (#41). Service role only, like vc_portfolios.
create table alphadrops_raises (
  slug text primary key,
  official_domain text,
  rounds jsonb not null,
  fetched_at timestamptz not null
);

-- Result of checking a claim link against the project's official domain and the phishing list (#42).
create table link_checks (
  url text primary key,
  status text not null check (status in ('official', 'different_domain', 'phishing', 'unchecked')),
  checked_at timestamptz not null
);

-- Indonesian step text (#45), stored apart from the member-only Analyst result so it can be public.
alter table tasks add column text_id text;

-- Weekly cache of the domains on VC portfolio pages; domains only, never page text.
create table vc_portfolios (
  vc_id text not null,
  -- C collation: byte-order sorting, so ORDER BY domain matches the in-memory repo whatever the database locale.
  domain text collate "C" not null,
  fetched_at timestamptz not null,
  primary key (vc_id, domain)
);

-- History of AI analyses. "Latest" per (project, kind) = max(created_at), ties broken by seq.
create table ai_analyses (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  kind text not null check (kind in ('analyst', 'scam', 'contradictions')),
  input_hash text not null,
  result jsonb not null,
  model text not null,
  served_model text,
  prompt_version text not null,
  created_at timestamptz not null default now(),
  seq bigint generated always as identity
);
create index ai_analyses_project_kind_created_idx on ai_analyses (project_id, kind, created_at desc);

-- History of curation results, like risk_assessments: "latest" = max(computed_at), ties broken by seq.
create table curations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  passed boolean not null,
  worth_level text check (worth_level in ('high', 'medium', 'low', 'insufficient_data')),
  -- Null when the project did not pass.
  tab text check (tab in ('live_now', 'early_bets', 'ended')),
  -- Project status (after expireStatus) when the curation was computed; basis of "passed before it ended" (#40).
  status_at text not null check (status_at in ('live', 'announced', 'speculative', 'ended', 'unknown')),
  ended_on date,
  reasons jsonb not null default '[]',
  coverage jsonb not null default '{}',
  -- Message of the first `fail` reason, null when passed (#55): the public reason a project is not listed.
  public_fail_reason text,
  computed_at timestamptz not null,
  seq bigint generated always as identity
);
create index curations_project_computed_idx on curations (project_id, computed_at desc);

-- A project entering or leaving the curated list is a change too (old/new = 'true'/'false').
alter table project_changes drop constraint project_changes_field_check;
alter table project_changes add constraint project_changes_field_check
  check (field in ('status', 'risk_level', 'curated'));

-- Row Level Security on every new table.
alter table project_signals enable row level security;
alter table alphadrops_raises enable row level security;
alter table link_checks enable row level security;
alter table vc_portfolios enable row level security;
alter table ai_analyses enable row level security;
alter table curations enable row level security;

-- Privileges: start from nothing for the web roles (Supabase's default privileges grant everything on new public
-- tables, writes included), then grant exactly the reads below. vc_portfolios and alphadrops_raises get no grant and
-- no policy.
revoke all on project_signals, alphadrops_raises, link_checks, vc_portfolios, ai_analyses, curations
  from anon, authenticated;

grant select on project_signals, link_checks to anon, authenticated;
create policy "public read" on project_signals for select to anon, authenticated using (true);
create policy "public read" on link_checks for select to anon, authenticated using (true);

-- curations: members read every column; anon reads the non-worth columns only. A column-level REVOKE does not take
-- away a table-level grant, so anon gets no table-level SELECT at all (revoked above), only these columns.
grant select on curations to authenticated;
grant select (id, project_id, passed, tab, status_at, ended_on, public_fail_reason, computed_at, seq)
  on curations to anon;
create policy "public read" on curations for select to anon, authenticated using (true);

-- ai_analyses: anon sees contradictions only; analyst and scam results are member-only (#54). A scam pattern that is
-- found still reaches visitors as the public risk reason `ai_scam_pattern`.
grant select on ai_analyses to anon, authenticated;
create policy "public read contradictions" on ai_analyses for select to anon using (kind = 'contradictions');
create policy "member read" on ai_analyses for select to authenticated using (true);
