-- ---------------------------------------------------------------------------
-- Curated Venues — hand-selected date-night spots
-- Run this in Supabase SQL Editor or via supabase db push
-- ---------------------------------------------------------------------------

create table if not exists curated_venues (
  id               uuid primary key default gen_random_uuid(),

  -- Location
  city             text not null,
  state            text not null default '',
  address          text,
  lat              double precision,
  lng              double precision,

  -- Identity
  name             text not null,
  google_place_id  text,
  yelp_id          text,

  -- Classification
  category         text not null,

  date_night_score integer not null default 80 check (date_night_score between 0 and 100),

  tags             text[] not null default '{}',

  -- Content
  notes            text,
  image_url        text,
  price_level      text,
  avg_rating       double precision,
  review_count     integer,
  website_url      text,
  reservation_url  text,

  -- Status
  is_active        boolean not null default true,
  is_verified      boolean not null default false,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Indexes
create index if not exists curated_venues_city_state
  on curated_venues (city, state);

create index if not exists curated_venues_score
  on curated_venues (date_night_score desc)
  where is_active = true;

create index if not exists curated_venues_tags
  on curated_venues using gin (tags);

create index if not exists curated_venues_category
  on curated_venues (category)
  where is_active = true;

-- Auto-update updated_at
create or replace function update_curated_venues_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists curated_venues_updated_at on curated_venues;
create trigger curated_venues_updated_at
  before update on curated_venues
  for each row execute function update_curated_venues_updated_at();

-- ---------------------------------------------------------------------------
-- Seed: Salt Lake City
-- ---------------------------------------------------------------------------

insert into curated_venues
  (city, state, name, category, date_night_score, tags, price_level, website_url, reservation_url, notes, is_verified)
values
  ('Salt Lake City', 'UT', 'Manoli''s', 'romantic_dining', 94,
   array['intimate','upscale','reservable','anniversary','first_date'], '$$$',
   'https://manolisslc.com', 'https://resy.com/cities/slc/manolis',
   'Best Greek fine dining in SLC — wood-fired, intimate, gorgeous wine list', true),

  ('Salt Lake City', 'UT', 'Plum Alley', 'romantic_dining', 91,
   array['intimate','upscale','reservable','first_date','trendy'], '$$$',
   'https://plumalleyslc.com', null,
   'Romantic Asian-inspired small plates in a cozy downtown space', true),

  ('Salt Lake City', 'UT', 'Handle', 'cocktail_bar', 88,
   array['trendy','cocktail','reservable','group_friendly'], '$$',
   'https://handleslc.com', null,
   'Craft cocktails + eclectic American food in a Park City/SLC staple', true),

  ('Salt Lake City', 'UT', 'Bar-X', 'speakeasy', 85,
   array['hidden_gem','cocktail','intimate','trendy'], '$$',
   'https://barxslc.com', null,
   'Vintage speakeasy vibe, sophisticated cocktails, dimly lit', true),

  ('Salt Lake City', 'UT', 'Bodega', 'cocktail_bar', 82,
   array['trendy','casual','walkable','cocktail'], '$',
   'https://bodegaslc.com', null,
   'Taco + cocktail bar — casual energy, great for a fun low-key date', true),

  ('Salt Lake City', 'UT', 'Area 51', 'live_music', 78,
   array['live_entertainment','casual','group_friendly'], '$',
   null, null,
   'SLC alternative/dance music staple', true),

  ('Salt Lake City', 'UT', 'The Bayou', 'live_music', 80,
   array['live_entertainment','group_friendly','casual','patio'], '$$',
   'https://thebayou.com', null,
   '200+ beers on tap, frequent live music, chill outdoor patio', true),

  ('Salt Lake City', 'UT', 'Whiskey Street', 'cocktail_bar', 83,
   array['trendy','cocktail','group_friendly','walkable'], '$$',
   'https://whiskeystreet.com', null,
   'Downtown anchor bar — huge whiskey list, energetic crowd, rooftop', true),

  ('Salt Lake City', 'UT', 'RoHa Brewing Project', 'unique_experience', 79,
   array['casual','patio','group_friendly'], '$',
   'https://rohabrewing.com', null,
   'Local craft brewery with a chill taproom', true),

  ('Salt Lake City', 'UT', 'Sundance Mountain Resort', 'outdoor_activity', 88,
   array['seasonal','upscale','anniversary','first_date'], '$$$',
   'https://sundanceresort.com', null,
   'Year-round mountain escape — ski/snowshoe in winter, hiking + outdoor dining in summer', true);
