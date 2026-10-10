-- Notifications (Plan 3): the digest send log and the one-click digest unsubscribe.

-- One row per (user, kind, UTC date) that was sent. The unique key is the "at most one digest per user per day"
-- guarantee: a re-run of the daily job on the same day cannot send (or log) a second one.
-- Service role only: RLS on, no policies, no grants for the web roles.
create table notification_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('digest')),
  ref_date date not null,
  sent_at timestamptz not null default now(),
  unique (user_id, kind, ref_date)
);
create index notification_log_kind_ref_date_idx on notification_log (kind, ref_date);

alter table notification_log enable row level security;
revoke all on notification_log from anon, authenticated;

-- Unsubscribe by the secret per-user token from the email link. Callable by anon (the visitor is logged out).
-- Returns true when a profile with that token exists, including one that was already unsubscribed, so repeating the
-- link (or a link scanner replaying it) keeps showing "done"; false for an unknown or null token.
create function public.unsubscribe_digest(token uuid) returns boolean
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_exists boolean;
begin
  if token is null then
    return false;
  end if;

  update public.profiles p
    set digest_enabled = false
    where p.unsubscribe_token = token
      and p.digest_enabled = true;
  if found then
    return true;
  end if;

  select exists (select 1 from public.profiles p where p.unsubscribe_token = token) into v_exists;
  return v_exists;
end;
$$;

revoke execute on function public.unsubscribe_digest(uuid) from public;
grant execute on function public.unsubscribe_digest(uuid) to anon, authenticated;
