-- Clean up duplicate events before adding constraint
-- Keep the record with the most recent updated_at or created_at
DELETE FROM events a USING (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY caldav_uid, calendar_url ORDER BY created_at DESC) as rnum
    FROM events
    WHERE caldav_uid IS NOT NULL AND calendar_url IS NOT NULL
) b
WHERE a.id = b.id AND b.rnum > 1;

-- Add Unique Constraint for Upsert
ALTER TABLE events ADD CONSTRAINT events_caldav_uid_calendar_url_key UNIQUE (caldav_uid, calendar_url);
