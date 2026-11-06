create table if not exists profiles (
  account_id text primary key references accounts (id) on delete cascade,
  bio text not null default '',
  note text not null default '',
  pronouns text not null default '',
  category text not null default '',
  link text not null default '',
  avatar text not null default '',
  closed boolean not null default false
);

create table if not exists media (
  id text primary key,
  account_id text not null references accounts (id) on delete cascade,
  mime text not null,
  bytes bytea not null,
  created_at timestamptz not null default now()
);

create table if not exists posts (
  id text primary key,
  account_id text not null references accounts (id) on delete cascade,
  kind text not null default 'post',
  caption text not null default '',
  location text not null default '',
  topic text not null default '',
  alt text not null default '',
  ai boolean not null default false,
  comments_closed boolean not null default false,
  collaborators text not null default '',
  src text not null default '',
  poster text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists post_media (
  post_id text not null references posts (id) on delete cascade,
  position integer not null,
  src text not null,
  primary key (post_id, position)
);

create table if not exists likes (
  account_id text not null references accounts (id) on delete cascade,
  post_id text not null references posts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (account_id, post_id)
);

create table if not exists saves (
  account_id text not null references accounts (id) on delete cascade,
  post_id text not null references posts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (account_id, post_id)
);

create table if not exists hides (
  account_id text not null references accounts (id) on delete cascade,
  post_id text not null references posts (id) on delete cascade,
  primary key (account_id, post_id)
);

create table if not exists comments (
  id text primary key,
  post_id text not null references posts (id) on delete cascade,
  account_id text not null references accounts (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists follows (
  follower_id text not null references accounts (id) on delete cascade,
  following_id text not null references accounts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id)
);

create table if not exists stories (
  id text primary key,
  account_id text not null references accounts (id) on delete cascade,
  src text not null,
  text text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists story_seen (
  account_id text not null references accounts (id) on delete cascade,
  story_id text not null references stories (id) on delete cascade,
  primary key (account_id, story_id)
);

create table if not exists story_replies (
  id text primary key,
  story_id text not null references stories (id) on delete cascade,
  account_id text not null references accounts (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists messages (
  id text primary key,
  sender_id text not null references accounts (id) on delete cascade,
  recipient_id text not null references accounts (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists reads (
  account_id text not null references accounts (id) on delete cascade,
  peer_id text not null references accounts (id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (account_id, peer_id)
);

create table if not exists highlights (
  id text primary key,
  account_id text not null references accounts (id) on delete cascade,
  title text not null,
  cover text not null,
  frames text not null default '[]',
  created_at timestamptz not null default now()
);

create index if not exists posts_created on posts (created_at desc);
create index if not exists likes_post on likes (post_id);
create index if not exists comments_post on comments (post_id, created_at);
create index if not exists messages_pair on messages (sender_id, recipient_id, created_at);
create index if not exists stories_created on stories (created_at desc);
