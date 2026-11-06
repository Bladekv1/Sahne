alter table accounts add column if not exists iterations integer not null default 100000;

create table if not exists follow_requests (
  requester_id text not null references accounts (id) on delete cascade,
  target_id text not null references accounts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (requester_id, target_id)
);

create index if not exists follow_requests_target on follow_requests (target_id, created_at desc);
