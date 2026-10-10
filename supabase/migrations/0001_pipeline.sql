-- Pipeline data model (spec section 5). The pipeline writes with the service role (bypasses RLS);
-- the web app reads the public tables with the anon/authenticated roles.

create table documents (
  id uuid primary key default gen_random_uuid(),
  source_kind text not null check (source_kind in ('airdrops_io', 'telegram', 'defillama')),
  source_key text not null,
  -- C collation: byte-order sorting, so ORDER BY url matches the in-memory repo whatever the database locale.
  url text collate "C" not null unique,
  text text not null default '',
  content_hash text not null,
  published_at timestamptz,
  page_updated_at timestamptz,
  fetched_at timestamptz not null,
  extraction_status text not null default 'pending' check (extraction_status in ('pending', 'done', 'not_airdrop', 'merge_failed'))
);
create index documents_extraction_status_idx on documents (extraction_status);
create index documents_source_key_idx on documents (source_key);
create index documents_fetched_at_idx on documents (fetched_at);

create table extractions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents (id) on delete cascade,
  model text not null,
  prompt_version text not null,
  raw text not null,
  http_status integer not null,
  finish_reason text,
  latency_ms integer not null,
  error text,
  created_at timestamptz not null default now()
);
create index extractions_document_id_idx on extractions (document_id);

create table projects (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  -- Normalized name; NOT unique: lookalike projects share a name_key.
  name_key text not null,
  token_symbol text,
  chains text[] not null default '{}',
  official_domains text[] not null default '{}',
  status text not null default 'unknown' check (status in ('live', 'announced', 'speculative', 'ended', 'unknown')),
  conflict boolean not null default false,
  lookalike_of uuid references projects (id) on delete set null,
  first_seen timestamptz not null,
  last_seen timestamptz not null
);
create index projects_name_key_idx on projects (name_key);
create index projects_last_seen_idx on projects (last_seen);

create table evidence (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  document_id uuid not null references documents (id) on delete cascade,
  field text not null,
  value text not null,
  quote text not null,
  at timestamptz not null,
  -- documents.url of document_id, copied at insert by the evidence_source_url trigger, so the web app can
  -- link the source without reading documents (which it cannot).
  source_url text not null,
  -- Insertion order, used as a deterministic tie-break when evidence shares the same `at`.
  seq bigint generated always as identity,
  unique (project_id, document_id, field, value)
);
create index evidence_document_id_idx on evidence (document_id);

create function evidence_source_url() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  select d.url into new.source_url from public.documents d where d.id = new.document_id;
  return new;
end;
$$;

create trigger evidence_source_url
  before insert on evidence
  for each row execute function evidence_source_url();

create table deadlines (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  document_id uuid not null references documents (id) on delete cascade,
  kind text not null check (kind in ('claim', 'snapshot', 'campaign_end', 'withdraw_funds', 'tge', 'other')),
  date date,
  precision text not null check (precision in ('exact', 'approximate', 'month', 'quarter')),
  text text not null
);
create index deadlines_project_id_idx on deadlines (project_id);
create index deadlines_document_id_idx on deadlines (document_id);

create table tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  document_id uuid not null references documents (id) on delete cascade,
  description text not null
);
create index tasks_project_id_idx on tasks (project_id);
create index tasks_document_id_idx on tasks (document_id);

create table links (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  url text not null,
  kind text not null check (kind in ('website', 'app', 'docs', 'claim', 'social')),
  referral_stripped boolean not null default false,
  unique (project_id, url)
);

-- History: one row per assessment. "Latest" = max(computed_at).
create table risk_assessments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  level text not null check (level in ('low', 'medium', 'high', 'critical', 'insufficient_data')),
  points integer not null,
  reasons jsonb not null default '[]',
  checks jsonb not null default '[]',
  computed_at timestamptz not null,
  -- Insertion order, used as a deterministic tie-break when assessments share the same computed_at.
  seq bigint generated always as identity
);
create index risk_assessments_project_computed_idx on risk_assessments (project_id, computed_at desc);

-- Consumed by the service-role notifier (digest); not publicly readable.
create table project_changes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  field text not null check (field in ('status', 'risk_level')),
  old_value text,
  new_value text not null,
  changed_at timestamptz not null
);
create index project_changes_project_id_idx on project_changes (project_id);
create index project_changes_changed_at_idx on project_changes (changed_at);

-- Aggregate numeric counters only (spec section 9: no emails, wallets or watchlists).
create table pipeline_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null,
  finished_at timestamptz,
  stats jsonb not null default '{}'
);

-- Row Level Security on every table.
alter table documents enable row level security;
alter table extractions enable row level security;
alter table projects enable row level security;
alter table evidence enable row level security;
alter table deadlines enable row level security;
alter table tasks enable row level security;
alter table links enable row level security;
alter table risk_assessments enable row level security;
alter table project_changes enable row level security;
alter table pipeline_runs enable row level security;

-- Defence in depth: even if a write policy is added by mistake, the web roles hold no write privileges.
revoke insert, update, delete, truncate on
  documents, extractions, projects, evidence, deadlines, tasks, links, risk_assessments, project_changes, pipeline_runs
  from anon, authenticated;

-- Public read on display tables only. No write policies: the pipeline writes with the service role.
-- documents, extractions and project_changes get no policy, so anon/authenticated cannot read them.
create policy "public read" on projects for select to anon, authenticated using (true);
create policy "public read" on evidence for select to anon, authenticated using (true);
create policy "public read" on deadlines for select to anon, authenticated using (true);
create policy "public read" on tasks for select to anon, authenticated using (true);
create policy "public read" on links for select to anon, authenticated using (true);
create policy "public read" on risk_assessments for select to anon, authenticated using (true);
create policy "public read" on pipeline_runs for select to anon, authenticated using (true);
