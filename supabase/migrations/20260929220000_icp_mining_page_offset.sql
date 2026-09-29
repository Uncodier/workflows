-- A per-page cursor allows exact lead targets without losing the rest of a page.
-- Null identifies legacy full-page runs; their next cursor is derived once.
ALTER TABLE public.icp_mining
  ADD COLUMN IF NOT EXISTS current_page_offset integer;

ALTER TABLE public.icp_mining
  ADD CONSTRAINT icp_mining_page_offset_range
  CHECK (current_page_offset IS NULL OR current_page_offset BETWEEN 0 AND 9);

COMMENT ON COLUMN public.icp_mining.current_page_offset IS
  'Next candidate index (0-9) in current_page; NULL for legacy whole-page cursors.';