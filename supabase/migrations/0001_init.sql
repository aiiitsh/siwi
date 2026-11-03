-- Siwi schema. No auth: all writes go through server routes using the service role key.
create extension if not exists "pgcrypto";

create table games (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'Untitled',
  prompt text not null,
  cover_url text,
  current_season int not null default 1,
  status text not null default 'building', -- building | ready | failed
  created_at timestamptz not null default now()
);

create table seasons (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  number int not null,
  design jsonb,
  html text,
  assets jsonb not null default '{}'::jsonb,
  cost_usd numeric(10,5) not null default 0,
  usage jsonb not null default '{}'::jsonb,
  build_seconds int,
  model_route jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (game_id, number)
);

create table events (
  id bigint generated always as identity primary key,
  game_id uuid not null references games(id) on delete cascade,
  season int not null default 1,
  agent text not null,
  kind text not null,
  message text not null,
  payload jsonb not null default '{}'::jsonb,
  cost_usd numeric(10,5) not null default 0,
  created_at timestamptz not null default now()
);
create index events_game_idx on events (game_id, id);

create table comments (
  id bigint generated always as identity primary key,
  game_id uuid not null references games(id) on delete cascade,
  name text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create table proposals (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  season int not null,
  spec jsonb not null,
  est_cost numeric(10,5) not null,
  status text not null default 'open', -- open | funded | building | built
  created_at timestamptz not null default now()
);

create table pledges (
  id bigint generated always as identity primary key,
  proposal_id uuid not null references proposals(id) on delete cascade,
  name text not null,
  amount numeric(10,2) not null check (amount > 0),
  created_at timestamptz not null default now()
);

create table owners (
  id bigint generated always as identity primary key,
  game_id uuid not null references games(id) on delete cascade,
  season int not null,
  name text not null,
  unique (game_id, season, name)
);

-- Public read for the gallery and game pages; writes only via service role.
alter table games enable row level security;
alter table seasons enable row level security;
alter table events enable row level security;
alter table comments enable row level security;
alter table proposals enable row level security;
alter table pledges enable row level security;
alter table owners enable row level security;
create policy "public read" on games for select using (true);
create policy "public read" on seasons for select using (true);
create policy "public read" on events for select using (true);
create policy "public read" on comments for select using (true);
create policy "public read" on proposals for select using (true);
create policy "public read" on pledges for select using (true);
create policy "public read" on owners for select using (true);

insert into storage.buckets (id, name, public) values ('assets', 'assets', true)
on conflict (id) do nothing;
