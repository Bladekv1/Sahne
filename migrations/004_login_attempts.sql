create table if not exists login_attempts (
  account_id text primary key references accounts (id) on delete cascade,
  fails integer not null default 0,
  window_until timestamptz not null,
  locked_until timestamptz
);
