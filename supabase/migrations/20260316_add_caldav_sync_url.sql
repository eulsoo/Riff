-- Add caldav_sync_url column to calendar_metadata table
-- Used for dual-sync: a Google-primary calendar that also syncs to iCloud (CalDAV)
ALTER TABLE calendar_metadata
  ADD COLUMN IF NOT EXISTS caldav_sync_url TEXT DEFAULT NULL;
