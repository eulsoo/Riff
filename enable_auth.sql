-- Enable RLS and add user_id column to tables

-- 1. Events
alter table events add column if not exists user_id uuid references auth.users default auth.uid();
alter table events enable row level security;

create policy "Users can view their own events" on events
  for select using (auth.uid() = user_id);

create policy "Users can insert their own events" on events
  for insert with check (auth.uid() = user_id);

create policy "Users can update their own events" on events
  for update using (auth.uid() = user_id);

create policy "Users can delete their own events" on events
  for delete using (auth.uid() = user_id);

-- 2. Routines
alter table routines add column if not exists user_id uuid references auth.users default auth.uid();
alter table routines enable row level security;

create policy "Users can view their own routines" on routines
  for select using (auth.uid() = user_id);

create policy "Users can insert their own routines" on routines
  for insert with check (auth.uid() = user_id);

create policy "Users can update their own routines" on routines
  for update using (auth.uid() = user_id);

create policy "Users can delete their own routines" on routines
  for delete using (auth.uid() = user_id);

-- 3. Routine Completions
alter table routine_completions add column if not exists user_id uuid references auth.users default auth.uid();
alter table routine_completions enable row level security;

create policy "Users can view their own analytics" on routine_completions
  for select using (auth.uid() = user_id);

create policy "Users can insert their own analytics" on routine_completions
  for insert with check (auth.uid() = user_id);

create policy "Users can update their own analytics" on routine_completions
  for update using (auth.uid() = user_id);

create policy "Users can delete their own analytics" on routine_completions
  for delete using (auth.uid() = user_id);

-- 4. Todos
alter table todos add column if not exists user_id uuid references auth.users default auth.uid();
alter table todos enable row level security;

create policy "Users can view their own todos" on todos
  for select using (auth.uid() = user_id);

create policy "Users can insert their own todos" on todos
  for insert with check (auth.uid() = user_id);

create policy "Users can update their own todos" on todos
  for update using (auth.uid() = user_id);

create policy "Users can delete their own todos" on todos
  for delete using (auth.uid() = user_id);

-- 5. Diary Entries
alter table diary_entries add column if not exists user_id uuid references auth.users default auth.uid();
alter table diary_entries enable row level security;

create unique index if not exists diary_entries_user_date_idx on diary_entries(user_id, date);

create policy "Users can view their own diary entries" on diary_entries
  for select using (auth.uid() = user_id);

create policy "Users can insert their own diary entries" on diary_entries
  for insert with check (auth.uid() = user_id);

create policy "Users can update their own diary entries" on diary_entries
  for update using (auth.uid() = user_id);

create policy "Users can delete their own diary entries" on diary_entries
  for delete using (auth.uid() = user_id);
