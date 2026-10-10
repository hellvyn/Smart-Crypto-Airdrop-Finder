-- Atomic wallet-check rate limit (Plan 2 final review). The web app used to count the caller's requests in the last
-- hour and then insert one, so N parallel requests could all pass the count and each reach the chain provider.
-- claim_wallet_check() serialises claims per user with a transaction-scoped advisory lock, then counts and records
-- in the same transaction: at most 10 claims per user succeed in any rolling hour, however many run at once.

create function public.claim_wallet_check() returns boolean
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_recent int;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- Held until commit, so a concurrent claim by the same user counts this one's row (read committed: each
  -- statement below takes a fresh snapshot after the lock is granted).
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 1));

  select count(*) into v_recent
  from public.wallet_check_requests r
  where r.user_id = v_uid
    and r.created_at >= now() - interval '1 hour';

  if v_recent >= 10 then
    return false;
  end if;

  insert into public.wallet_check_requests (user_id) values (v_uid);
  return true;
end;
$$;

revoke execute on function public.claim_wallet_check() from public, anon;
grant execute on function public.claim_wallet_check() to authenticated;
