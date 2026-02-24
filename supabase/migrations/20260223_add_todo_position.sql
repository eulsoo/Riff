-- Add position column to todos table for persistent ordering
ALTER TABLE todos ADD COLUMN IF NOT EXISTS position integer DEFAULT 0;

-- Set initial positions based on created_at order
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC) - 1 AS pos
  FROM todos
)
UPDATE todos SET position = ranked.pos FROM ranked WHERE todos.id = ranked.id;
