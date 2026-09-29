-- Fenced execution ownership and durable partial-page snapshots. No timed lease:
-- takeover requires the worker to verify that the previous Temporal run ended.
ALTER TABLE public.icp_mining
  ADD COLUMN IF NOT EXISTS execution_run_id uuid,
  ADD COLUMN IF NOT EXISTS execution_workflow_id text,
  ADD COLUMN IF NOT EXISTS execution_active boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS checkpoint_version integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_page_snapshot jsonb;

CREATE OR REPLACE FUNCTION public.claim_icp_mining_execution(
  p_id uuid, p_site_id uuid, p_run_id uuid, p_workflow_id text,
  p_previous_run_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.icp_mining;
BEGIN
  IF p_run_id IS NULL OR NULLIF(p_workflow_id, '') IS NULL THEN RAISE EXCEPTION 'Execution identity required'; END IF;
  SELECT * INTO r FROM public.icp_mining WHERE id = p_id AND site_id = p_site_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Mining request not found in site'; END IF;
  IF r.execution_run_id = p_run_id THEN
    RETURN jsonb_build_object('acquired', r.execution_active, 'reason', 'same_run', 'icp', to_jsonb(r));
  END IF;
  IF r.execution_active AND r.execution_run_id IS DISTINCT FROM p_previous_run_id THEN
    RETURN jsonb_build_object('acquired', false, 'reason', 'busy',
      'owner_run_id', r.execution_run_id, 'owner_workflow_id', r.execution_workflow_id);
  END IF;
  IF r.status NOT IN ('pending', 'running') THEN
    RETURN jsonb_build_object('acquired', false, 'reason', 'not_pending');
  END IF;
  PERFORM pg_catalog.set_config('app.icp_execution_owner', p_run_id::text, true);
  UPDATE public.icp_mining SET execution_run_id = p_run_id, execution_workflow_id = p_workflow_id,
    execution_active = true, checkpoint_version = 0, status = 'running',
    started_at = COALESCE(started_at, now()), finished_at = NULL, last_progress_at = now()
    WHERE id = p_id RETURNING * INTO r;
  RETURN jsonb_build_object('acquired', true, 'icp', to_jsonb(r));
END $$;

CREATE OR REPLACE FUNCTION public.checkpoint_icp_mining_execution(
  p_id uuid, p_site_id uuid, p_run_id uuid, p_version integer,
  p_processed integer, p_found integer, p_page integer, p_offset integer,
  p_total integer, p_status text, p_snapshot jsonb, p_errors jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.icp_mining;
BEGIN
  SELECT * INTO r FROM public.icp_mining WHERE id = p_id AND site_id = p_site_id FOR UPDATE;
  IF NOT FOUND OR r.execution_run_id IS DISTINCT FROM p_run_id OR p_run_id IS NULL THEN
    RAISE EXCEPTION 'Mining execution no longer owns request';
  END IF;
  -- A completed activity response may be lost. Retrying its exact sequence is a no-op.
  IF p_version = r.checkpoint_version THEN RETURN jsonb_build_object('success', true, 'applied', false); END IF;
  IF NOT r.execution_active OR p_version IS NULL OR p_version <> r.checkpoint_version + 1 THEN RAISE EXCEPTION 'Stale mining checkpoint'; END IF;
  IF p_processed IS NULL OR p_found IS NULL OR p_page IS NULL OR p_offset IS NULL
    OR p_processed < COALESCE(r.processed_targets, 0) OR p_found < COALESCE(r.found_matches, 0)
    OR p_found > p_processed OR p_page < COALESCE(r.current_page, 0) OR p_offset NOT BETWEEN 0 AND 9
    OR (p_page = COALESCE(r.current_page, 0) AND p_offset < COALESCE(r.current_page_offset, 0))
    OR p_status NOT IN ('running', 'pending', 'completed') OR p_status IS NULL
    OR (p_total IS NOT NULL AND p_total < 0) OR jsonb_typeof(p_errors) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid mining checkpoint';
  END IF;
  IF p_snapshot IS NOT NULL AND (jsonb_typeof(p_snapshot) IS DISTINCT FROM 'object'
    OR (p_snapshot->>'page')::integer IS DISTINCT FROM p_page
    OR jsonb_typeof(p_snapshot->'candidates') IS DISTINCT FROM 'array') THEN RAISE EXCEPTION 'Invalid page snapshot'; END IF;
  PERFORM pg_catalog.set_config('app.icp_execution_owner', p_run_id::text, true);
  UPDATE public.icp_mining SET processed_targets = p_processed, found_matches = p_found,
    current_page = p_page, current_page_offset = p_offset, current_page_snapshot = p_snapshot,
    checkpoint_version = p_version, total_targets = COALESCE(p_total, total_targets),
    status = p_status, execution_active = p_status = 'running', last_progress_at = now(),
    finished_at = CASE WHEN p_status = 'completed' THEN now() ELSE NULL END,
    last_error = CASE WHEN jsonb_array_length(p_errors) > 0 THEN p_errors::text ELSE NULL END,
    errors = COALESCE(errors, '[]'::jsonb) || p_errors
    WHERE id = p_id;
  RETURN jsonb_build_object('success', true, 'applied', true);
END $$;

-- Old workers must not overwrite counters/cursors once a request has entered the
-- fenced protocol. Drain old runs before rollout; new activities use the RPCs.
CREATE OR REPLACE FUNCTION public.guard_icp_mining_execution_update()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF (OLD.execution_run_id IS NOT NULL OR NEW.execution_run_id IS NOT NULL)
    AND (NEW.processed_targets, NEW.found_matches, NEW.current_page, NEW.current_page_offset,
      NEW.status, NEW.execution_run_id, NEW.execution_active, NEW.execution_workflow_id, NEW.checkpoint_version,
      NEW.current_page_snapshot, NEW.total_targets, NEW.started_at, NEW.finished_at, NEW.last_progress_at, NEW.last_error, NEW.errors)
      IS DISTINCT FROM
      (OLD.processed_targets, OLD.found_matches, OLD.current_page, OLD.current_page_offset,
      OLD.status, OLD.execution_run_id, OLD.execution_active, OLD.execution_workflow_id, OLD.checkpoint_version,
      OLD.current_page_snapshot, OLD.total_targets, OLD.started_at, OLD.finished_at, OLD.last_progress_at, OLD.last_error, OLD.errors)
    AND (NEW.execution_run_id IS NULL OR COALESCE(pg_catalog.current_setting('app.icp_execution_owner', true), '') IS DISTINCT FROM NEW.execution_run_id::text) THEN
    RAISE EXCEPTION 'Mining progress must use the execution checkpoint protocol';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_icp_mining_execution_update BEFORE UPDATE ON public.icp_mining
  FOR EACH ROW EXECUTE FUNCTION public.guard_icp_mining_execution_update();

REVOKE ALL ON FUNCTION public.claim_icp_mining_execution(uuid, uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.checkpoint_icp_mining_execution(uuid, uuid, uuid, integer, integer, integer, integer, integer, integer, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_icp_mining_execution(uuid, uuid, uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.checkpoint_icp_mining_execution(uuid, uuid, uuid, integer, integer, integer, integer, integer, integer, text, jsonb, jsonb) TO service_role;