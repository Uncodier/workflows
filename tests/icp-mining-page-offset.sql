\set ON_ERROR_STOP on
BEGIN;
CREATE TABLE public.icp_mining (id integer PRIMARY KEY, current_page integer, processed_targets integer);
INSERT INTO public.icp_mining VALUES (1, 2, 25);
\ir ../supabase/migrations/20260929220000_icp_mining_page_offset.sql
DO $$
BEGIN
  IF (SELECT current_page_offset IS NOT NULL FROM public.icp_mining WHERE id = 1) THEN
    RAISE EXCEPTION 'Legacy cursor must remain identifiable';
  END IF;
  UPDATE public.icp_mining SET current_page_offset = 5 WHERE id = 1;
  IF (SELECT current_page_offset FROM public.icp_mining WHERE id = 1) <> 5 THEN
    RAISE EXCEPTION 'Partial-page offset was not saved';
  END IF;
  BEGIN
    UPDATE public.icp_mining SET current_page_offset = 10;
    RAISE EXCEPTION 'Out-of-range cursor was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.icp_mining SET current_page_offset = -1;
    RAISE EXCEPTION 'Negative cursor was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
ROLLBACK;