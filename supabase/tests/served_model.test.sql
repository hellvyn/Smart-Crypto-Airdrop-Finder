-- pgTAP tests for 0008_served_model.sql: extractions.served_model holds the model that actually answered.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(4);

select has_column('public', 'extractions', 'served_model', 'extractions has a served_model column');
select col_type_is('public', 'extractions', 'served_model', 'text', 'served_model is text');
select col_is_null('public', 'extractions', 'served_model', 'served_model is nullable (failed requests name no model)');

insert into documents (id, source_kind, source_key, url, text, content_hash, fetched_at) values
  ('5e900000-0000-4000-8000-0000000000a1', 'airdrops_io', 'airdrops.io', 'https://served-model.test/a', 't', 'h', now());
insert into extractions (document_id, model, prompt_version, raw, http_status, latency_ms) values
  ('5e900000-0000-4000-8000-0000000000a1', 'nvidia:z-ai/glm-5.3-flash', 'v', '', 0, 1);
select is(
  (select served_model from extractions where document_id = '5e900000-0000-4000-8000-0000000000a1'),
  null,
  'an insert without served_model (older pipeline) still works and stores null');

select * from finish();
rollback;
