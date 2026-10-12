-- ---------------------------------------------------------------------------
-- Local secrets — the hidden spots a local friend would take you to
-- (a beach path, a swimming hole, an off-menu burger). Anyone can share one;
-- vetting comes later. Run in the Supabase SQL Editor.
-- ---------------------------------------------------------------------------

create table if not exists local_secrets (
  id            uuid primary key default gen_random_uuid(),

  name          text not null check (char_length(name) between 2 and 120),
  kind          text not null default 'other'
                check (kind in ('beach', 'trail', 'viewpoint', 'swimming', 'waterfall', 'hot_spring',
                                'park', 'food', 'drink', 'activity', 'culture', 'other')),
  why_special   text not null check (char_length(why_special) between 10 and 600),
  how_to_get_there text check (char_length(how_to_get_there) <= 600),
  best_time     text check (char_length(best_time) <= 120),
  cautions      text check (char_length(cautions) <= 300),

  -- Where it is
  lat           double precision not null check (lat between -90 and 90),
  lng           double precision not null check (lng between -180 and 180),
  place_label   text,                      -- "Laie, Hawaii" — for display

  -- Where it came from
  source        text not null default 'community'
                check (source in ('community', 'curated', 'osm', 'wikivoyage', 'web')),
  source_url    text,
  submitter_name text check (char_length(submitter_name) <= 60),

  -- Lifecycle (vetting comes later; everything starts visible)
  status        text not null default 'active' check (status in ('active', 'hidden')),
  verified      boolean not null default false,

  created_at    timestamptz not null default now()
);

-- Nearby lookups use a lat/lng bounding box
create index if not exists local_secrets_lat_lng on local_secrets (lat, lng) where status = 'active';

-- Row Level Security: the public can read active secrets; all writes go
-- through the site's server (secret key), never straight from browsers.
alter table local_secrets enable row level security;

drop policy if exists "Anyone can read active secrets" on local_secrets;
create policy "Anyone can read active secrets"
  on local_secrets for select
  using (status = 'active');
