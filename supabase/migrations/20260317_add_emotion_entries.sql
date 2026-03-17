-- emotion_entries 테이블 생성
-- 날짜별 감정 이모지를 DB에 영속적으로 저장 (기존 localStorage 전용에서 변경)
CREATE TABLE IF NOT EXISTS emotion_entries (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  emotion TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, date)
);

-- RLS 활성화
ALTER TABLE emotion_entries ENABLE ROW LEVEL SECURITY;

-- 본인 데이터만 접근 가능
CREATE POLICY "Users can manage their own emotion entries"
  ON emotion_entries
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 날짜 기준 조회 최적화 인덱스
CREATE INDEX IF NOT EXISTS emotion_entries_user_date_idx ON emotion_entries(user_id, date);
