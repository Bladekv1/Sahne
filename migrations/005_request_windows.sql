create table if not exists request_windows (
  bucket text primary key,
  hits integer not null default 0,
  window_until timestamptz not null
);
