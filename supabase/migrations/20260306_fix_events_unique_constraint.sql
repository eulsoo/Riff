-- Drop the old constraint that doesn't include user_id
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_caldav_uid_calendar_url_key;

-- Remove duplicate rows before adding new constraint
-- When the same caldav_uid+calendar_url exists for different users, keep all
-- When same user has duplicates, keep only the most recent
DELETE FROM events a USING (
    SELECT id, ROW_NUMBER() OVER (
        PARTITION BY user_id, caldav_uid, calendar_url
        ORDER BY created_at DESC
    ) as rnum
    FROM events
    WHERE caldav_uid IS NOT NULL AND calendar_url IS NOT NULL AND user_id IS NOT NULL
) b
WHERE a.id = b.id AND b.rnum > 1;

-- Add new constraint with user_id included
ALTER TABLE events ADD CONSTRAINT events_user_id_caldav_uid_calendar_url_key
    UNIQUE (user_id, caldav_uid, calendar_url);
