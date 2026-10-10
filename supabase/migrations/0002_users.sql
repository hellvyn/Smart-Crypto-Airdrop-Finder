-- User data model (Plan 2): profiles, watchlist, wallets, wallet-check cache and request log.
-- Every table has Row Level Security. Web roles get only the privileges they need, and anon gets none.

create table profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  plan text not null default 'free',
  digest_enabled boolean not null default true,
  new_airdrops_opt_in boolean not null default false,
  timezone text not null default 'UTC',
  unsubscribe_token uuid not null default gen_random_uuid() unique
);

create table watchlist (
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references projects (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, project_id)
);
create index watchlist_project_id_idx on watchlist (project_id);

create table wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Always stored lowercase, so checksum-cased and lowercase input is the same wallet (no duplicates, no cache misses).
  address text not null check (address = lower(address)),
  chain_family text not null check (chain_family in ('evm')),
  label text check (char_length(label) <= 64),
  unique (user_id, address)
);
create index wallets_address_idx on wallets (address);

-- Per-user cache of wallet activity per (address, chain). Per user on purpose: a shared cache would let one user
-- poison (or probe) another user's result by adding the victim's address as their own wallet.
-- Never readable or writable directly by web roles; only through get_wallet_check / save_wallet_check.
create table wallet_checks (
  user_id uuid not null references auth.users (id) on delete cascade,
  address text not null,
  chain text not null,
  result jsonb not null,
  checked_at timestamptz not null default now(),
  primary key (user_id, address, chain)
);

-- Rate-limit log: one row per wallet check request.
create table wallet_check_requests (
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index wallet_check_requests_user_created_idx on wallet_check_requests (user_id, created_at);

alter table profiles enable row level security;
alter table watchlist enable row level security;
alter table wallets enable row level security;
alter table wallet_checks enable row level security;
alter table wallet_check_requests enable row level security;

-- Privileges: start from nothing for the web roles, then grant exactly what each table needs.
revoke all on profiles, watchlist, wallets, wallet_checks, wallet_check_requests from anon, authenticated;

-- profiles: created by the signup trigger, never inserted or deleted by the user. `plan` is not user-editable.
grant select on profiles to authenticated;
grant update (digest_enabled, new_airdrops_opt_in, timezone) on profiles to authenticated;
create policy "own profile read" on profiles for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own profile update" on profiles for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, delete on watchlist to authenticated;
create policy "own watchlist read" on watchlist for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own watchlist insert" on watchlist for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "own watchlist delete" on watchlist for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, delete on wallets to authenticated;
grant update (label) on wallets to authenticated;
create policy "own wallets read" on wallets for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own wallets insert" on wallets for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "own wallets update" on wallets for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy "own wallets delete" on wallets for delete to authenticated
  using (user_id = (select auth.uid()));

-- Read and append only: users cannot delete their request log to dodge the hourly limit, and created_at
-- (insert is granted on user_id alone) is always the server's now().
grant select on wallet_check_requests to authenticated;
grant insert (user_id) on wallet_check_requests to authenticated;
create policy "own requests read" on wallet_check_requests for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own requests insert" on wallet_check_requests for insert to authenticated
  with check (user_id = (select auth.uid()));

-- wallet_checks: no policies on purpose; the revoke above plus RLS deny everything for web roles.

-- Signup trigger: every new auth user gets a profile.
create function public.handle_new_user() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  insert into public.profiles (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- At most 20 wallets per user. The advisory lock serialises concurrent inserts for the same user.
create function public.enforce_wallet_limit() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 0));
  if (select count(*) from public.wallets w where w.user_id = new.user_id) >= 20 then
    raise exception 'wallet limit reached (20)' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke execute on function public.enforce_wallet_limit() from public, anon, authenticated;

create trigger wallets_limit
  before insert on wallets
  for each row execute function public.enforce_wallet_limit();

-- Removing a wallet removes that user's cached checks for its address (also fires on account deletion cascade).
create function public.delete_wallet_checks() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  delete from public.wallet_checks wc where wc.user_id = old.user_id and wc.address = old.address;
  return old;
end;
$$;
revoke execute on function public.delete_wallet_checks() from public, anon, authenticated;

create trigger wallets_delete_checks
  after delete on wallets
  for each row execute function public.delete_wallet_checks();

-- The caller's own cached check for one of the caller's own wallets; no rows otherwise.
create function public.get_wallet_check(p_wallet_id uuid, p_chain text)
  returns table (result jsonb, checked_at timestamptz)
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select wc.result, wc.checked_at
  from public.wallets w
  join public.wallet_checks wc on wc.user_id = w.user_id and wc.address = w.address and wc.chain = p_chain
  where w.id = p_wallet_id
    and w.user_id = (select auth.uid());
$$;

create function public.save_wallet_check(p_wallet_id uuid, p_chain text, p_result jsonb)
  returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_address text;
begin
  if p_chain is null or p_chain !~ '^[a-z0-9-]{1,32}$' then
    raise exception 'invalid chain' using errcode = '22023';
  end if;
  if p_result is null or pg_column_size(p_result) > 8192 then
    raise exception 'invalid result' using errcode = '22023';
  end if;

  select w.address into v_address
  from public.wallets w
  where w.id = p_wallet_id
    and w.user_id = (select auth.uid());
  if not found then
    raise exception 'wallet not found' using errcode = '42501';
  end if;

  insert into public.wallet_checks as wc (user_id, address, chain, result, checked_at)
  values ((select auth.uid()), v_address, p_chain, p_result, now())
  on conflict (user_id, address, chain) do update
    set result = excluded.result, checked_at = excluded.checked_at;
end;
$$;

-- Self-service account deletion. Deleting the auth user cascades to profiles, watchlist, wallets (whose delete
-- trigger drops the cached checks), wallet_checks and the request log.
create function public.delete_my_account() returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  delete from auth.users where id = v_uid;
end;
$$;

revoke execute on function public.get_wallet_check(uuid, text) from public, anon;
revoke execute on function public.save_wallet_check(uuid, text, jsonb) from public, anon;
revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.get_wallet_check(uuid, text) to authenticated;
grant execute on function public.save_wallet_check(uuid, text, jsonb) to authenticated;
grant execute on function public.delete_my_account() to authenticated;
