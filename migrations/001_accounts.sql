create table if not exists accounts (
  id text primary key,
  name text not null,
  contact text not null default '',
  born text not null default '',
  salt text not null,
  hash text not null,
  verified boolean not null default false,
  role text not null default 'user',
  created_at timestamptz not null default now()
);

create table if not exists sessions (
  token_hash text primary key,
  account_id text not null references accounts (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists verification_requests (
  id text primary key,
  account_id text not null references accounts (id),
  full_name text not null,
  category text not null,
  audience text not null default '',
  reason text not null,
  link text not null default '',
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create index if not exists verification_requests_account on verification_requests (account_id, created_at);
