-- 1. Events Table
create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  date text not null, -- formatted as YYYY-MM-DD
  title text not null,
  memo text, -- optional memo field
  start_time text,
  end_time text,
  color text not null,
  created_at timestamptz default now()
);

alter table events enable row level security;
create policy "Allow public access for events" on events for all using (true) with check (true);

-- 2. Routines Table
create table if not exists routines (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  icon text not null,
  color text not null,
  days integer[] not null,
  created_at timestamptz default now()
);

alter table routines enable row level security;
create policy "Allow public access for routines" on routines for all using (true) with check (true);

-- 3. Routine Completions Table
create table if not exists routine_completions (
  id uuid primary key default gen_random_uuid(),
  routine_id uuid references routines(id) on delete cascade,
  date text not null, -- formatted as YYYY-MM-DD
  completed boolean not null default false,
  created_at timestamptz default now(),
  unique(routine_id, date)
);

alter table routine_completions enable row level security;
create policy "Allow public access for completions" on routine_completions for all using (true) with check (true);

-- 4. Todos Table
create table if not exists todos (
  id uuid primary key default gen_random_uuid(),
  week_start text not null, -- formatted as YYYY-MM-DD
  text text not null,
  completed boolean not null default false,
  created_at timestamptz default now()
);

alter table todos enable row level security;
create policy "Allow public access for todos" on todos for all using (true) with check (true);

-- 5. Day Definitions Table
create table if not exists day_definitions (
  id uuid primary key default gen_random_uuid(),
  date text not null unique, -- formatted as YYYY-MM-DD
  text text default '',
  created_at timestamptz default now()
);

alter table day_definitions enable row level security;
create policy "Allow public access for day definitions" on day_definitions for all using (true) with check (true);

-- 6. Diary Entries Table
create table if not exists diary_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users default auth.uid(),
  date text not null, -- formatted as YYYY-MM-DD
  title text default '',
  content text default '',
  updated_at timestamptz default now(),
  created_at timestamptz default now()
);

create unique index if not exists diary_entries_user_date_idx on diary_entries(user_id, date);

alter table diary_entries enable row level security;
create policy "Allow public access for diary entries" on diary_entries for all using (true) with check (true);

-- 7. User Tokens Table (For 3rd party refresh tokens, highly restricted to user)
create table if not exists user_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  provider_refresh_token text not null,
  updated_at timestamptz default now()
);

alter table user_tokens enable row level security;
create policy "Users can manage their own tokens" on user_tokens for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 8. Calendar Metadata Table (Cross-device calendar list persistence)
create table if not exists calendar_metadata (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  url text not null,
  display_name text,
  color text,
  type text, -- 'local' | 'caldav' | 'google' | 'subscription'
  is_local boolean default false,
  is_visible boolean default true,
  is_subscription boolean default false,
  is_shared boolean default false,
  read_only boolean default false,
  created_from_app boolean default false,
  google_calendar_id text,
  subscription_url text,
  original_caldav_url text,
  updated_at timestamptz default now(),
  created_at timestamptz default now(),
  unique(user_id, url)
);

alter table calendar_metadata enable row level security;
create policy "Users can manage their own calendar metadata" on calendar_metadata
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
