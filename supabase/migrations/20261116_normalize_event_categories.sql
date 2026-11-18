-- ---------------------------------------------------------------------------
-- Normalize legacy event category values
--
-- After Nov 2026 fixes, inferCategory functions across all workers now emit:
--   'Sports & Outdoors' (was 'Sports')
--   'Comedy'            (was 'Arts & Culture' for comedy keywords)
--   'Community'         (was 'Other' as catch-all default)
--
-- This migration brings existing DB rows in line with the new values so that
-- the category filter (.in('category', [...]) in /api/events) finds them.
-- ---------------------------------------------------------------------------

UPDATE events SET category = 'Sports & Outdoors' WHERE category = 'Sports';
UPDATE events SET category = 'Community'         WHERE category = 'Other';
