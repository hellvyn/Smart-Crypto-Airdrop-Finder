-- Manual membership (Plan 7): accounts are created by an admin, and nothing sends email any more.
-- Part A drops the digest and unsubscribe machinery. Existing profiles, watchlists, wallets and wallet checks stay.

-- The one-click unsubscribe (0005) reads profiles.unsubscribe_token and writes digest_enabled, so it goes first.
drop function public.unsubscribe_digest(uuid);

-- The digest send log (0005): service role only, no policies, nothing else references it.
drop table public.notification_log;

-- Dropping a column also drops its unique constraint (unsubscribe_token) and its entries in the column-level
-- UPDATE grant from 0002, so `grant update (timezone)` is what remains for the web roles.
alter table public.profiles
  drop column digest_enabled,
  drop column new_airdrops_opt_in,
  drop column unsubscribe_token;
