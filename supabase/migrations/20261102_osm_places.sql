-- ---------------------------------------------------------------------------
-- OpenStreetMap places — waterfalls, viewpoints, swimming holes, trailheads,
-- ruins, murals: the lesser-known spots Wikipedia and Google skip. OSM is too
-- slow to ask live, so the site asks for an area once and the Railway worker
-- loads it in the background. Run in the Supabase SQL Editor.
-- ---------------------------------------------------------------------------

-- Areas are 0.1° grid cells (about 11 km tall); key is "floor(lat*10):floor(lng*10)"
create table if not exists osm_areas (
  key           text primary key,
  status        text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  attempts      int not null default 0,
  place_count   int,
  error         text,
  requested_at  timestamptz not null default now(),
  fetched_at    timestamptz
);

create index if not exists osm_areas_pending on osm_areas (requested_at) where status = 'pending';

create table if not exists osm_places (
  id            text primary key,              -- "node/123", "way/456"
  area_key      text not null references osm_areas (key) on delete cascade,
  name          text not null,
  local_name    text,                          -- the name on the sign, when the English one differs
  kind          text not null,                 -- "Waterfall", "Viewpoint", "Ruins"…
  category      text not null,                 -- 'Outdoors' | 'Arts & Culture' | 'Activities'
  lat           double precision not null,
  lng           double precision not null,
  well_known    boolean not null default false, -- has a Wikipedia/Wikidata link
  facts         text,                          -- "Free · Hours: dawn–dusk · 12 m tall"
  fetched_at    timestamptz not null default now()
);

create index if not exists osm_places_lat_lng on osm_places (lat, lng);
create index if not exists osm_places_area on osm_places (area_key);

-- Row Level Security: the public can read places; only the site's server
-- (secret key) asks for areas, and only the worker writes places
alter table osm_areas  enable row level security;
alter table osm_places enable row level security;

drop policy if exists "Anyone can read OSM places" on osm_places;
create policy "Anyone can read OSM places"
  on osm_places for select
  using (true);
