-- Run this in your Supabase SQL editor
-- Creates the pick_feedback table for three-thumb rating data

CREATE TABLE IF NOT EXISTS pick_feedback (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    TEXT        NOT NULL,
  event_title TEXT,
  rating      TEXT        NOT NULL CHECK (rating IN ('up', 'meh', 'down')),
  session_id  TEXT,
  city        TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pick_feedback_event_id_idx ON pick_feedback (event_id);
CREATE INDEX IF NOT EXISTS pick_feedback_rating_idx   ON pick_feedback (rating);
CREATE INDEX IF NOT EXISTS pick_feedback_city_idx     ON pick_feedback (city);

-- Optional: RLS (allow anonymous inserts, no reads from client)
ALTER TABLE pick_feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow insert" ON pick_feedback FOR INSERT WITH CHECK (true);
