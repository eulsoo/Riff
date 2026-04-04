-- google_watch_channels 테이블에 color 컬럼 추가
-- 웹훅에서 calendar_metadata (DB에 없는 Google 캘린더) 색상을 조회하기 위해 사용

ALTER TABLE public.google_watch_channels
  ADD COLUMN IF NOT EXISTS color TEXT NOT NULL DEFAULT '#4285F4';
