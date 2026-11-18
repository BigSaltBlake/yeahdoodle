-- ---------------------------------------------------------------------------
-- run_dedup: marks SeatGeek events as is_duplicate = true when a Ticketmaster
-- event exists with the same dedupe_key. Ticketmaster is preferred because it
-- returns images; SeatGeek list endpoints do not.
--
-- Called by the Railway worker after every Ticketmaster and SeatGeek sync.
-- Returns the count of rows newly marked as duplicates.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION run_dedup()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  marked integer;
BEGIN
  UPDATE events sg
  SET is_duplicate = true
  FROM events tm
  WHERE sg.source      = 'seatgeek'
    AND tm.source      = 'ticketmaster'
    AND sg.dedupe_key  = tm.dedupe_key
    AND sg.is_duplicate = false;

  GET DIAGNOSTICS marked = ROW_COUNT;
  RETURN marked;
END;
$$;
