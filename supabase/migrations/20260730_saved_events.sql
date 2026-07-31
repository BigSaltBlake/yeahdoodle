CREATE TABLE IF NOT EXISTS saved_events (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    TEXT        NOT NULL,
  event_title TEXT,
  event_data  JSONB,
  intent      TEXT        NOT NULL CHECK (intent IN ('save_for_later', 'definitely_going')),
  session_id  TEXT,
  user_id     UUID        REFERENCES auth.users(id) ON DELETE CASCADE,
  city        TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS saved_events_event_id_idx    ON saved_events (event_id);
CREATE INDEX IF NOT EXISTS saved_events_session_id_idx  ON saved_events (session_id);
CREATE INDEX IF NOT EXISTS saved_events_user_id_idx     ON saved_events (user_id);
CREATE INDEX IF NOT EXISTS saved_events_intent_idx      ON saved_events (intent);
ALTER TABLE saved_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow insert" ON saved_events FOR INSERT WITH CHECK (true);
CREATE POLICY "allow select own" ON saved_events FOR SELECT USING (session_id = current_setting('request.jwt.claims', true)::json->>'sub' OR user_id = auth.uid());
CREATE POLICY "allow delete own" ON saved_events FOR DELETE USING (session_id IS NOT NULL OR user_id = auth.uid());
