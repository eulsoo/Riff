-- Google Calendar Watch API 채널 정보 저장
CREATE TABLE IF NOT EXISTS google_watch_channels (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  calendar_id    TEXT NOT NULL,
  channel_id     TEXT NOT NULL UNIQUE,
  resource_id    TEXT,
  expiry         TIMESTAMPTZ NOT NULL,
  last_sync_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(user_id, calendar_id)
);

ALTER TABLE google_watch_channels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own watch channels"
  ON google_watch_channels
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS google_watch_channels_expiry_idx
  ON google_watch_channels(expiry);

CREATE INDEX IF NOT EXISTS google_watch_channels_channel_id_idx
  ON google_watch_channels(channel_id);
