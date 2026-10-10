-- The model that actually answered an extraction attempt (Plan 4, Task 3; curation spec decision #30). The
-- configured model in `model` is now "<provider>:<id>" (e.g. "freellm:auto"); the freellm router picks a different
-- model per request, so the `model` field of the response stream is stored here to trace quality changes to a
-- specific model. Null when the request failed or the stream named no model, and for rows written before 0008.
alter table extractions add column served_model text;
