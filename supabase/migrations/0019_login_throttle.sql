-- Login throttle (owner 2026-10-11: at most 5 login attempts). The login server action asks `login_throttle_allowed`
-- before it calls Supabase Auth and reports each wrong-password attempt with `login_throttle_fail`. Both take keyed
-- hashes (64 hex characters, made by the server from the email and from the client address), never an email or an IP.
-- 5 failures under one email key inside 15 minutes block that email until the oldest of them is 15 minutes old. The
-- client address has a looser limit of 30, because one address (an office, a mobile carrier) is shared by many people.
-- Failures are only added through these functions; nothing returns a hash, and the table has no grants.

create table public.login_attempts (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('email', 'ip')),
  key text not null check (key ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);
create index login_attempts_key_created_idx on public.login_attempts (kind, key, created_at desc);
alter table public.login_attempts enable row level security;
revoke all on public.login_attempts from public, anon, authenticated;

-- True when the email key has fewer than 5 failures and the address key fewer than 30 in the last 15 minutes. A key
-- that is not 64 hex characters (or null) is ignored.
create function public.login_throttle_allowed(p_email_key text, p_ip_key text) returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select
    (p_email_key is null or p_email_key !~ '^[0-9a-f]{64}$'
      or (select count(*) from public.login_attempts a
          where a.kind = 'email' and a.key = p_email_key and a.created_at > now() - interval '15 minutes') < 5)
    and
    (p_ip_key is null or p_ip_key !~ '^[0-9a-f]{64}$'
      or (select count(*) from public.login_attempts a
          where a.kind = 'ip' and a.key = p_ip_key and a.created_at > now() - interval '15 minutes') < 30);
$$;

-- Records one failed attempt under each valid key. Rows older than a day are removed by the daily pipeline purge.
create function public.login_throttle_fail(p_email_key text, p_ip_key text) returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if p_email_key ~ '^[0-9a-f]{64}$' then
    insert into public.login_attempts (kind, key) values ('email', p_email_key);
  end if;
  if p_ip_key ~ '^[0-9a-f]{64}$' then
    insert into public.login_attempts (kind, key) values ('ip', p_ip_key);
  end if;
end;
$$;

revoke execute on function public.login_throttle_allowed(text, text) from public;
revoke execute on function public.login_throttle_fail(text, text) from public;
grant execute on function public.login_throttle_allowed(text, text) to anon, authenticated;
grant execute on function public.login_throttle_fail(text, text) to anon, authenticated;
