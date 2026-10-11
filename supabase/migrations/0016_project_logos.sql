-- Project logos (owner request 2026-10-11: /airdrops as cards, 3 per row, with each project's logo).
-- The pipeline downloads one logo per project (pipeline/src/steps/logos.ts), in this order: the project's DefiLlama
-- logo (icons.llama.fi only), its X avatar through unavatar.io, the favicon of a clean official domain. The web serves
-- the stored bytes from its own route (apps/web/app/logo/[projectId]/route.ts), so a visitor's browser never contacts
-- a project domain, and shows a letter tile when there is no row.
--
-- Written for the Supabase connector, which refuses DROP and mass UPDATE: create, alter add, grant/revoke and
-- create or replace view only.
--
-- The table refuses what the web must never serve, whatever the writer does: a mime outside the raster allow-list
-- (never SVG, which can carry script), bytes whose leading magic bytes do not match the stored mime, and more than
-- 64 KB (65,536 bytes; base64 of that is 87,384 characters).

create table public.project_logos (
  project_id uuid primary key references public.projects (id) on delete cascade,
  -- x_avatar: the avatar of the project's X account, read through unavatar.io (free plan: attribution on the page).
  source text not null check (source in ('defillama', 'x_avatar', 'favicon')),
  mime text not null check (
    mime in ('image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/x-icon', 'image/vnd.microsoft.icon')
  ),
  -- Standard base64 without line breaks, 1 to 65,536 bytes.
  data_b64 text not null check (
    char_length(data_b64) between 4 and 87384
    and char_length(data_b64) % 4 = 0
    and data_b64 ~ '^[A-Za-z0-9+/]+={0,2}$'
  ),
  fetched_at timestamptz not null,
  -- The bytes are what the mime says (PNG, JPEG, GIF87a/89a, RIFF....WEBP, ICO).
  constraint project_logos_magic check (
    case
      when mime = 'image/png' then substring(decode(data_b64, 'base64') from 1 for 8) = '\x89504e470d0a1a0a'::bytea
      when mime = 'image/jpeg' then substring(decode(data_b64, 'base64') from 1 for 3) = '\xffd8ff'::bytea
      when mime = 'image/gif' then substring(decode(data_b64, 'base64') from 1 for 6) in ('\x474946383761'::bytea,
                                                                                        '\x474946383961'::bytea)
      when mime = 'image/webp' then substring(decode(data_b64, 'base64') from 1 for 4) = '\x52494646'::bytea
                                    and substring(decode(data_b64, 'base64') from 9 for 4) = '\x57454250'::bytea
      when mime in ('image/x-icon', 'image/vnd.microsoft.icon')
        then substring(decode(data_b64, 'base64') from 1 for 4) = '\x00000100'::bytea
      else false
    end
  ),
  constraint project_logos_size check (octet_length(decode(data_b64, 'base64')) between 1 and 65536)
);

alter table public.project_logos enable row level security;

-- A logo is public. Only the pipeline (service role, which bypasses RLS) writes.
revoke all on public.project_logos from anon, authenticated;
grant select on public.project_logos to anon, authenticated;
create policy "project logos public read" on public.project_logos for select to anon, authenticated using (true);

-- The list views gain logo_source (null without a logo), so a card renders an <img> only when there is a logo, and
-- the unavatar.io attribution only under an X avatar. One query for the page, an index lookup per row.
-- The definitions below are those of 0012 with logo_source added at the end (create or replace view can only add
-- columns at the end); security_invoker is restated because create or replace view resets options it does not name.
-- Grants stay as 0012 set them (create or replace view keeps them). project_logos is public, so this column never
-- refuses anon the view, and public_list still references no member-only curations column (see 0012).
create or replace view public.public_list with (security_invoker = true) as
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
  public.key_checks_ran(pl.id) as key_checks_ran,
  -- The card's logo (0016): which source it came from, null when there is none.
  (select lg.source from public.project_logos lg where lg.project_id = pl.id) as logo_source
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

-- Member list: the public list plus the latest curation's worth level and its sort rank (high first), then the logo
-- source. Columns are listed by name: 0012's `p.*` would now put logo_source before worth_level, which create or
-- replace view refuses.
create or replace view public.curated_list with (security_invoker = true) as
select
  p.id,
  p.slug,
  p.name,
  p.status,
  p.chains,
  p.chains_lower,
  p.last_seen,
  p.next_deadline_date,
  p.next_deadline_kind,
  p.next_deadline_precision,
  p.latest_risk_level,
  p.curation_id,
  p.tab,
  p.ended_on,
  p.checked_at,
  p.signals,
  p.signal_rank,
  p.claim_open_checked,
  p.capital,
  p.capital_min_usd,
  p.key_checks_ran,
  c.worth_level,
  case c.worth_level
    when 'high' then 1
    when 'medium' then 2
    when 'low' then 3
    when 'insufficient_data' then 4
  end as worth_rank,
  p.logo_source
from public.public_list p
join public.curations c on c.id = p.curation_id;
