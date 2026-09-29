\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE TABLE public.icp_mining (
  id uuid PRIMARY KEY, site_id uuid NOT NULL, status text DEFAULT 'pending',
  processed_targets integer DEFAULT 0, found_matches integer DEFAULT 0, current_page integer DEFAULT 0,
  current_page_offset integer, total_targets integer DEFAULT 10, started_at timestamptz,
  finished_at timestamptz, last_progress_at timestamptz, last_error text, errors jsonb DEFAULT '[]'
);
\ir ../supabase/migrations/20260929230000_icp_mining_execution_checkpoints.sql
INSERT INTO public.icp_mining (id, site_id) VALUES
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002');
DO $$
DECLARE
  mining uuid := '00000000-0000-4000-8000-000000000001';
  site uuid := '00000000-0000-4000-8000-000000000002';
  run1 uuid := '00000000-0000-4000-8000-000000000003';
  run2 uuid := '00000000-0000-4000-8000-000000000004';
  response jsonb;
BEGIN
  response := public.claim_icp_mining_execution(mining, site, run1, 'workflow-1');
  ASSERT (response->>'acquired')::boolean, 'First run must claim';
  response := public.claim_icp_mining_execution(mining, site, run2, 'workflow-2');
  ASSERT NOT (response->>'acquired')::boolean, 'Concurrent run must not claim';
  PERFORM public.checkpoint_icp_mining_execution(mining, site, run1, 1, 5, 5, 0, 5, 10, 'running',
    '{"page":0,"candidates":[1,2,3,4,5,6,7,8,9,10],"hasMore":false}', '[]');
  response := public.checkpoint_icp_mining_execution(mining, site, run1, 1, 5, 5, 0, 5, 10, 'running', NULL, '[]');
  ASSERT NOT (response->>'applied')::boolean, 'Duplicate checkpoint must not count twice';
  ASSERT (SELECT processed_targets = 5 AND current_page_offset = 5 FROM public.icp_mining WHERE id = mining);
  BEGIN
    PERFORM public.checkpoint_icp_mining_execution(mining, site, run2, 2, 10, 10, 1, 0, 10, 'completed', NULL, '[]');
    RAISE EXCEPTION 'Foreign run wrote checkpoint';
  EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM = 'Mining execution no longer owns request'; END;
  BEGIN
    PERFORM public.checkpoint_icp_mining_execution(mining, site, run1, 2, 4, 4, 0, 4, 10, 'running', NULL, '[]');
    RAISE EXCEPTION 'Progress regressed';
  EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM = 'Invalid mining checkpoint'; END;
  -- A stale takeover is compare-and-swap protected.
  response := public.claim_icp_mining_execution(mining, site, run2, 'workflow-2', run2);
  ASSERT NOT (response->>'acquired')::boolean;
  response := public.claim_icp_mining_execution(mining, site, run2, 'workflow-2', run1);
  ASSERT (response->>'acquired')::boolean;
  ASSERT response->'icp'->'current_page_snapshot' IS NOT NULL;
  BEGIN
    PERFORM public.checkpoint_icp_mining_execution(mining, site, run1, 2, 6, 6, 0, 6, 10, 'running', NULL, '[]');
    RAISE EXCEPTION 'Old owner wrote after takeover';
  EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM = 'Mining execution no longer owns request'; END;
  PERFORM public.checkpoint_icp_mining_execution(mining, site, run2, 1, 10, 10, 1, 0, 10, 'completed', NULL, '[]');
  ASSERT (SELECT status = 'completed' AND NOT execution_active FROM public.icp_mining WHERE id = mining);
  -- Model a separate legacy writer (no transaction-local fencing key).
  PERFORM pg_catalog.set_config('app.icp_execution_owner', '', true);
  BEGIN
    UPDATE public.icp_mining SET processed_targets = 3 WHERE id = mining;
    RAISE EXCEPTION 'Legacy writer bypassed ownership';
  EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM = 'Mining progress must use the execution checkpoint protocol'; END;
  BEGIN
    UPDATE public.icp_mining SET execution_run_id = NULL, execution_active = false WHERE id = mining;
    RAISE EXCEPTION 'Owner could be cleared without protocol';
  EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM = 'Mining progress must use the execution checkpoint protocol'; END;
  BEGIN
    UPDATE public.icp_mining SET total_targets = 0 WHERE id = mining;
    RAISE EXCEPTION 'Legacy total update bypassed protocol';
  EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM = 'Mining progress must use the execution checkpoint protocol'; END;
  ASSERT NOT has_function_privilege('authenticated', 'public.claim_icp_mining_execution(uuid,uuid,uuid,text,uuid)', 'EXECUTE');
  ASSERT has_function_privilege('service_role', 'public.claim_icp_mining_execution(uuid,uuid,uuid,text,uuid)', 'EXECUTE');
END $$;
ROLLBACK;