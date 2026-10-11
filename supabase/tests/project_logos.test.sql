-- pgTAP tests for 0016_project_logos.sql (owner request 2026-10-11: the list as cards with each project's logo).
-- project_logos holds one logo per project (DefiLlama, X avatar through unavatar.io, or the official domain's
-- favicon), downloaded by the pipeline and served by the web through its own route. A logo is public: anon and
-- authenticated read it, nobody but the pipeline (service role) writes it. The table refuses anything the web must
-- never serve: a mime outside the raster allow-list (so never SVG), bytes whose magic does not match the mime, and
-- more than 64 KB. public_list and curated_list gain logo_source (null without a logo) at the end, keeping every
-- column, security_invoker and their grants.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(49);

-- 1x1 images (or just their headers: only the leading magic bytes are checked).
create temp table img (k text primary key, b64 text);
insert into img values
  ('png', 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='),
  ('jpeg', '/9j/4AAQSkZJRg=='),
  ('gif', 'R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw=='),
  ('webp', 'UklGRhoAAABXRUJQVlA4IA=='),
  ('ico', 'AAABAAEA'),
  ('svg', 'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4='),
  -- A PNG header padded to exactly 64 KB (65,536 bytes), and one byte more.
  ('png_64k', replace(encode('\x89504e470d0a1a0a'::bytea || decode(repeat('00', 65528), 'hex'), 'base64'), E'\n', '')),
  ('png_64k_plus', replace(encode('\x89504e470d0a1a0a'::bytea || decode(repeat('00', 65529), 'hex'), 'base64'), E'\n', ''));
grant select on img to anon, authenticated;

insert into projects (id, slug, name, name_key, status, chains, first_seen, last_seen) values
  ('1a000000-0000-4000-8000-000000000001', 'lg-png', 'LG Png', 'lgpng', 'live', '{}', now(), now()),
  ('1a000000-0000-4000-8000-000000000002', 'lg-jpeg', 'LG Jpeg', 'lgjpeg', 'live', '{}', now(), now()),
  ('1a000000-0000-4000-8000-000000000003', 'lg-gif', 'LG Gif', 'lggif', 'live', '{}', now(), now()),
  ('1a000000-0000-4000-8000-000000000004', 'lg-webp', 'LG Webp', 'lgwebp', 'live', '{}', now(), now()),
  ('1a000000-0000-4000-8000-000000000005', 'lg-ico', 'LG Ico', 'lgico', 'live', '{}', now(), now()),
  ('1a000000-0000-4000-8000-000000000006', 'lg-none', 'LG None', 'lgnone', 'live', '{}', now(), now()),
  ('1a000000-0000-4000-8000-000000000007', 'lg-gone', 'LG Gone', 'lggone', 'live', '{}', now(), now());

-- lg-png and lg-none pass curation (on the list); the others are not on the list.
insert into curations (project_id, passed, worth_level, tab, status_at, computed_at) values
  ('1a000000-0000-4000-8000-000000000001', true, 'high', 'live_now', 'live', now()),
  ('1a000000-0000-4000-8000-000000000006', true, 'low', 'live_now', 'live', now());

-- ---------- shape ----------
-- 1-3.
select has_table('public', 'project_logos', 'project_logos exists');
select columns_are('public', 'project_logos', array['project_id', 'source', 'mime', 'data_b64', 'fetched_at'],
  'project_logos holds the project, source, mime, bytes and fetch time only');
select col_is_pk('public', 'project_logos', 'project_id', 'one logo per project');
-- 4.
select results_eq(
  $$ select column_name::text collate "default", is_nullable::text collate "default" from information_schema.columns
     where table_schema = 'public' and table_name = 'project_logos' order by column_name $$,
  $$ values ('data_b64'::text, 'NO'::text), ('fetched_at', 'NO'), ('mime', 'NO'), ('project_id', 'NO'), ('source', 'NO') $$,
  'every column is not null');
-- 5.
select is((select relrowsecurity from pg_class where oid = 'public.project_logos'::regclass), true,
  'row level security is enabled on project_logos');
-- 6. Effective privileges (Supabase's default privileges grant everything on new tables, so this proves the revoke).
select results_eq(
  $$ select r, p from unnest(array['anon', 'authenticated']) r,
       unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
     where has_table_privilege(r, 'public.project_logos', p) order by 1, 2 $$,
  $$ values ('anon'::text, 'SELECT'::text), ('authenticated', 'SELECT') $$,
  'anon and authenticated may only select project_logos');
-- 7. The only policy is a public read.
select results_eq(
  $$ select cmd::text collate "default", array_to_string(roles, ',') collate "default", qual collate "default" from pg_policies where schemaname = 'public' and tablename = 'project_logos' $$,
  $$ values ('SELECT'::text, 'anon,authenticated'::text, 'true'::text) $$,
  'one policy: select for anon and authenticated, every row');

-- ---------- checks (owner role) ----------
-- 8. Every allowed raster mime with matching bytes is stored.
select lives_ok(
  $$ insert into project_logos (project_id, source, mime, data_b64, fetched_at)
     select '1a000000-0000-4000-8000-000000000001'::uuid, 'defillama', 'image/png', b64, now() from img where k = 'png'
     union all select '1a000000-0000-4000-8000-000000000002', 'x_avatar', 'image/jpeg', b64, now() from img where k = 'jpeg'
     union all select '1a000000-0000-4000-8000-000000000003', 'favicon', 'image/gif', b64, now() from img where k = 'gif'
     union all select '1a000000-0000-4000-8000-000000000004', 'favicon', 'image/webp', b64, now() from img where k = 'webp'
     union all select '1a000000-0000-4000-8000-000000000005', 'favicon', 'image/x-icon', b64, now() from img where k = 'ico' $$,
  'png, jpeg, gif, webp and x-icon logos with matching magic bytes are stored, from each of the three sources');
-- 9.
select lives_ok(
  $$ update project_logos set mime = 'image/vnd.microsoft.icon' where project_id = '1a000000-0000-4000-8000-000000000005' $$,
  'image/vnd.microsoft.icon is the other ICO mime');
-- 10-11. Never SVG: not as its own mime, not as bytes behind a raster mime.
select throws_ok(
  $$ insert into project_logos (project_id, source, mime, data_b64, fetched_at)
     select '1a000000-0000-4000-8000-000000000006', 'favicon', 'image/svg+xml', b64, now() from img where k = 'svg' $$,
  '23514', null, 'image/svg+xml is refused');
select throws_ok(
  $$ insert into project_logos (project_id, source, mime, data_b64, fetched_at)
     select '1a000000-0000-4000-8000-000000000006', 'favicon', 'image/png', b64, now() from img where k = 'svg' $$,
  '23514', null, 'SVG bytes stored as image/png are refused (the magic bytes must match the mime)');
-- 12-14. Bytes that do not match the mime.
select throws_ok(
  $$ insert into project_logos (project_id, source, mime, data_b64, fetched_at)
     select '1a000000-0000-4000-8000-000000000006', 'favicon', 'image/jpeg', b64, now() from img where k = 'png' $$,
  '23514', null, 'PNG bytes stored as image/jpeg are refused');
select throws_ok(
  $$ insert into project_logos (project_id, source, mime, data_b64, fetched_at)
     select '1a000000-0000-4000-8000-000000000006', 'favicon', 'image/webp', b64, now() from img where k = 'gif' $$,
  '23514', null, 'GIF bytes stored as image/webp are refused');
select throws_ok(
  $$ insert into project_logos (project_id, source, mime, data_b64, fetched_at)
     values ('1a000000-0000-4000-8000-000000000006', 'favicon', 'image/x-icon', 'PGh0bWw+', now()) $$,
  '23514', null, 'HTML bytes stored as image/x-icon are refused');
-- 15-16. Mime and source allow-lists.
select throws_ok(
  $$ insert into project_logos (project_id, source, mime, data_b64, fetched_at)
     select '1a000000-0000-4000-8000-000000000006', 'favicon', 'text/html', b64, now() from img where k = 'png' $$,
  '23514', null, 'a mime outside the allow-list is refused');
select throws_ok(
  $$ insert into project_logos (project_id, source, mime, data_b64, fetched_at)
     select '1a000000-0000-4000-8000-000000000006', 'coingecko', 'image/png', b64, now() from img where k = 'png' $$,
  '23514', null, 'a source outside defillama, x_avatar and favicon is refused');
-- 17-19. Size: at most 64 KB of bytes, at least one.
select lives_ok(
  $$ insert into project_logos (project_id, source, mime, data_b64, fetched_at)
     select '1a000000-0000-4000-8000-000000000006', 'favicon', 'image/png', b64, now() from img where k = 'png_64k' $$,
  'a logo of exactly 64 KB is stored');
select throws_ok(
  $$ update project_logos set data_b64 = (select b64 from img where k = 'png_64k_plus')
     where project_id = '1a000000-0000-4000-8000-000000000006' $$,
  '23514', null, 'a logo of 64 KB + 1 byte is refused');
select throws_ok(
  $$ update project_logos set data_b64 = '' where project_id = '1a000000-0000-4000-8000-000000000006' $$,
  '23514', null, 'an empty logo is refused');
-- 20. Not base64 at all.
select throws_like(
  $$ update project_logos set data_b64 = '<svg onload=alert(1)>' where project_id = '1a000000-0000-4000-8000-000000000006' $$,
  '%', 'text that is not base64 is refused');
delete from project_logos where project_id = '1a000000-0000-4000-8000-000000000006';
-- 21. The logo goes with its project.
insert into project_logos (project_id, source, mime, data_b64, fetched_at)
  select '1a000000-0000-4000-8000-000000000007', 'favicon', 'image/png', b64, now() from img where k = 'png';
delete from projects where id = '1a000000-0000-4000-8000-000000000007';
select is((select count(*)::int from project_logos where project_id = '1a000000-0000-4000-8000-000000000007'), 0,
  'deleting a project deletes its logo');
-- 22. fetched_at has no default: the writer says when it fetched.
select throws_ok(
  $$ insert into project_logos (project_id, source, mime, data_b64)
     select '1a000000-0000-4000-8000-000000000006', 'favicon', 'image/png', b64 from img where k = 'png' $$,
  '23502', null, 'fetched_at is required');

-- ---------- list views ----------
-- 23-24. logo_source is added at the end; every other column stays as 0012 made it.
select columns_are('public', 'public_list',
  array['id', 'slug', 'name', 'status', 'chains', 'chains_lower', 'last_seen', 'next_deadline_date', 'next_deadline_kind',
        'next_deadline_precision', 'latest_risk_level', 'curation_id', 'tab', 'ended_on', 'checked_at', 'signals',
        'signal_rank', 'claim_open_checked', 'capital', 'capital_min_usd', 'key_checks_ran', 'logo_source'],
  'public_list gains logo_source');
select results_eq(
  $$ select attname::text collate "default" from pg_attribute where attrelid = 'public.curated_list'::regclass and attnum > 0
     and not attisdropped order by attnum desc limit 3 $$,
  $$ values ('logo_source'::text), ('worth_rank'), ('worth_level') $$,
  'curated_list gains logo_source after worth_level and worth_rank');
-- 25. Still security_invoker (create or replace view resets options that are not restated).
select results_eq(
  $$ select relname::text collate "default", coalesce(reloptions, '{}') @> array['security_invoker=true'] from pg_class
     where relnamespace = 'public'::regnamespace and relname in ('public_list', 'curated_list') order by 1 $$,
  $$ values ('curated_list'::text, true), ('public_list'::text, true) $$,
  'public_list and curated_list are still security_invoker');
-- 26. Grants kept: anon reads public_list only; nobody writes.
select results_eq(
  $$ select v, r, p from unnest(array['public_list', 'curated_list']) v, unnest(array['anon', 'authenticated']) r,
       unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
     where has_table_privilege(r, 'public.' || v, p) order by 1, 2, 3 $$,
  $$ values ('curated_list'::text, 'authenticated'::text, 'SELECT'::text), ('public_list', 'anon', 'SELECT'),
            ('public_list', 'authenticated', 'SELECT') $$,
  'list view grants are unchanged');
-- 27.
select results_eq(
  $$ select slug, logo_source from public_list where slug like 'lg-%' order by slug $$,
  $$ values ('lg-none'::text, null::text), ('lg-png', 'defillama') $$,
  'public_list gives the logo source of a listed project, null without a logo');
-- 28.
select results_eq(
  $$ select slug, worth_level, logo_source from curated_list where slug like 'lg-%' order by slug $$,
  $$ values ('lg-none'::text, 'low'::text, null::text), ('lg-png', 'high', 'defillama') $$,
  'curated_list gives the logo source next to worth_level');
-- 29.
select is(
  (select count(*)::int from curated_list c join public_list p using (id)
   where c.slug like 'lg-%' and c.checked_at = p.checked_at and c.key_checks_ran = p.key_checks_ran
     and c.signals = p.signals and c.capital = p.capital and c.logo_source is not distinct from p.logo_source),
  2, 'curated_list carries the public_list columns unchanged');

-- ---------- project_logo_attempts (fix round 1): pipeline bookkeeping, service role only ----------
-- 30-32.
select has_table('public', 'project_logo_attempts', 'project_logo_attempts exists');
select columns_are('public', 'project_logo_attempts', array['project_id', 'outcome', 'attempted_at'],
  'project_logo_attempts holds the project, the outcome and when');
select is((select relrowsecurity from pg_class where oid = 'public.project_logo_attempts'::regclass), true,
  'row level security is enabled on project_logo_attempts');
-- 33. No grant and no policy: anon and authenticated can do nothing with it.
select results_eq(
  $$ select count(*)::int from unnest(array['anon', 'authenticated']) r,
       unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
     where has_table_privilege(r, 'public.project_logo_attempts', p) $$,
  $$ values (0) $$,
  'anon and authenticated hold no privilege on project_logo_attempts');
-- 34.
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'project_logo_attempts'), 0,
  'project_logo_attempts has no policy');
-- 35. Outcome allow-list.
select throws_ok(
  $$ insert into project_logo_attempts (project_id, outcome, attempted_at)
     values ('1a000000-0000-4000-8000-000000000006', 'maybe', now()) $$,
  '23514', null, 'an outcome other than stored or failed is refused');
-- 36. Goes with its project.
insert into projects (id, slug, name, name_key, status, chains, first_seen, last_seen) values
  ('1a000000-0000-4000-8000-000000000008', 'lg-try', 'LG Try', 'lgtry', 'live', '{}', now(), now());
insert into project_logo_attempts (project_id, outcome, attempted_at)
  values ('1a000000-0000-4000-8000-000000000008', 'failed', now());
delete from projects where id = '1a000000-0000-4000-8000-000000000008';
select is((select count(*)::int from project_logo_attempts where project_id = '1a000000-0000-4000-8000-000000000008'), 0,
  'deleting a project deletes its logo attempt');

-- ---------- anon ----------
set local role anon;
-- 37-38.
select results_eq(
  $$ select project_id::text, source, mime, data_b64 = (select b64 from img where k = 'png') from project_logos
     where project_id = '1a000000-0000-4000-8000-000000000001' $$,
  $$ values ('1a000000-0000-4000-8000-000000000001'::text, 'defillama'::text, 'image/png'::text, true) $$,
  'anon reads a logo');
select is((select count(*)::int from project_logos where project_id::text like '1a000000-%'), 5,
  'anon reads every logo, listed project or not');
-- 39-41.
select throws_ok(
  $$ insert into project_logos (project_id, source, mime, data_b64, fetched_at)
     select '1a000000-0000-4000-8000-000000000006', 'favicon', 'image/png', b64, now() from img where k = 'png' $$,
  '42501', null, 'anon cannot insert a logo');
select throws_ok(
  $$ update project_logos set fetched_at = now() where project_id = '1a000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'anon cannot update a logo');
select throws_ok($$ delete from project_logos $$, '42501', null, 'anon cannot delete a logo');
-- 42-43.
select results_eq(
  $$ select slug, logo_source from public_list where slug like 'lg-%' order by slug $$,
  $$ values ('lg-none'::text, null::text), ('lg-png', 'defillama') $$,
  'anon reads logo_source through public_list');
select throws_ok($$ select logo_source from curated_list $$, '42501', null, 'anon still cannot read curated_list');
reset role;

-- ---------- authenticated ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"1a000000-0000-4000-8000-00000000aaaa","role":"authenticated"}';
-- 44-47.
select is((select count(*)::int from project_logos where project_id::text like '1a000000-%'), 5,
  'authenticated reads the logos');
select throws_ok(
  $$ insert into project_logos (project_id, source, mime, data_b64, fetched_at)
     select '1a000000-0000-4000-8000-000000000006', 'favicon', 'image/png', b64, now() from img where k = 'png' $$,
  '42501', null, 'authenticated cannot insert a logo');
select throws_ok(
  $$ update project_logos set mime = 'image/png' where project_id = '1a000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'authenticated cannot update a logo');
select throws_ok($$ delete from project_logos $$, '42501', null, 'authenticated cannot delete a logo');
-- 48-49.
select results_eq(
  $$ select slug, logo_source from curated_list where slug like 'lg-%' order by slug $$,
  $$ values ('lg-none'::text, null::text), ('lg-png', 'defillama') $$,
  'authenticated reads logo_source through curated_list');
select is((select count(*)::int from public_list where slug like 'lg-%'), 2, 'authenticated reads public_list');
reset role;

select * from finish();
rollback;
