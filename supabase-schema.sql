-- YeahDoodle Supabase Schema
-- Run this in the Supabase SQL editor: https://app.supabase.com/project/_/sql

-- Events table (populated by scrapers + Ticketmaster)
CREATE TABLE IF NOT EXISTS events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id   TEXT NOT NULL,
  source        TEXT NOT NULL DEFAULT 'scraped',
  title         TEXT NOT NULL,
  description   TEXT,
  ai_description TEXT,
  category      TEXT,
  subcategory   TEXT,
  date_start    TIMESTAMPTZ,
  date_end      TIMESTAMPTZ,
  venue_name    TEXT,
  venue_address TEXT,
  city          TEXT,
  state         TEXT,
  lat           DECIMAL(10, 7),
  lng           DECIMAL(10, 7),
  image_url     TEXT,
  ticket_url    TEXT,
  price_min     DECIMAL(10, 2),
  price_max     DECIMAL(10, 2),
  is_free       BOOLEAN DEFAULT false,
  group_suitability TEXT[] DEFAULT '{}',
  age_groups    TEXT[] DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

-- Composite unique key: same external_id can exist from multiple sources
ALTER TABLE events ADD CONSTRAINT events_external_id_source_unique UNIQUE (external_id, source);

-- Index for fast city + date queries
CREATE INDEX IF NOT EXISTS idx_events_city       ON events(city);
CREATE INDEX IF NOT EXISTS idx_events_date_start ON events(date_start);
CREATE INDEX IF NOT EXISTS idx_events_category   ON events(category);

-- User profiles (optional -- only for signed-up users)
CREATE TABLE IF NOT EXISTS user_profiles (
  id                  UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email               TEXT,
  preferred_city      TEXT,
  preferred_categories TEXT[] DEFAULT '{}',
  preferred_groups    TEXT[] DEFAULT '{}',
  vibe_setup          BOOLEAN DEFAULT false,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);

-- Saved events (for signed-up users)
CREATE TABLE IF NOT EXISTS saved_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  title       TEXT,
  date_start  TIMESTAMPTZ,
  city        TEXT,
  category    TEXT,
  image_url   TEXT,
  ticket_url  TEXT,
  saved_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, external_id)
);

-- RLS: Users can only see their own saved events
ALTER TABLE saved_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own saves" ON saved_events
  FOR ALL USING (auth.uid() = user_id);

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own profile" ON user_profiles
  FOR ALL USING (auth.uid() = id);

-- Events are publicly readable
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Events are public" ON events
  FOR SELECT USING (true);
