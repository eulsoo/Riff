-- CalDAV 동기화 설정 테이블
create table if not exists caldav_sync_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  server_url text not null,
  username text not null,
  password text not null, -- 암호화해서 저장하는 것이 좋지만, 일단 평문으로 저장
  selected_calendar_urls text[] not null, -- 동기화할 캘린더 URL 배열
  sync_interval_minutes integer default 60, -- 동기화 주기 (분 단위)
  enabled boolean default true, -- 자동 동기화 활성화 여부
  last_sync_at timestamptz, -- 마지막 동기화 시간
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id)
);

alter table caldav_sync_settings enable row level security;
create policy "Users can manage their own sync settings" on caldav_sync_settings 
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- updated_at 자동 업데이트 트리거
create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger update_caldav_sync_settings_updated_at
  before update on caldav_sync_settings
  for each row
  execute function update_updated_at_column();
