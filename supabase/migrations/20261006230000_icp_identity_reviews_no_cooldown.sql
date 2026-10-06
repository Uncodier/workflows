-- Identity reconciliation is not a transient provider failure. Retain the
-- diagnostic, but do not penalize the site/list or honor an old worker's six-hour
-- retry hint when every diagnostic is an organization identity review.
CREATE OR REPLACE FUNCTION public.finish_icp_dispatch(
  p_id uuid, p_run_id uuid, p_errors jsonb DEFAULT '[]'::jsonb, p_retry_after_seconds integer DEFAULT 300
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  d public.icp_dispatch_runs; r public.icp_mining;
  actual_processed bigint; actual_found bigint; failures integer; list_failures integer;
  cooldown integer; list_cooldown integer; has_errors boolean; has_retryable_errors boolean; stamp timestamptz;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(734210, 1);
  SELECT * INTO d FROM public.icp_dispatch_runs WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR p_run_id IS NULL OR d.run_id IS DISTINCT FROM p_run_id THEN RAISE EXCEPTION 'Dispatch run mismatch'; END IF;
  IF d.state = 'settled' THEN
    RETURN jsonb_build_object('success', true, 'next_eligible_at',
      (SELECT next_eligible_at FROM public.icp_dispatch_site_state WHERE site_id = d.site_id));
  END IF;
  IF d.state <> 'running' OR d.baseline_processed IS NULL OR d.baseline_found IS NULL THEN
    RAISE EXCEPTION 'Dispatch must be running to settle';
  END IF;
  IF jsonb_typeof(p_errors) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Dispatch errors must be an array'; END IF;
  SELECT * INTO r FROM public.icp_mining WHERE id = d.icp_mining_id AND site_id = d.site_id FOR UPDATE;
  IF NOT FOUND OR r.execution_run_id IS DISTINCT FROM p_run_id OR r.execution_workflow_id IS DISTINCT FROM d.workflow_id THEN
    RAISE EXCEPTION 'Dispatch execution ownership lost';
  END IF;
  IF r.execution_active THEN RAISE EXCEPTION 'Dispatch execution must checkpoint release before settlement'; END IF;
  actual_processed := r.processed_targets::bigint - d.baseline_processed;
  actual_found := r.found_matches::bigint - d.baseline_found;
  IF actual_processed IS NULL OR actual_found IS NULL OR actual_processed NOT BETWEEN 0 AND d.reserved_candidates
    OR actual_found NOT BETWEEN 0 AND d.reserved_matches OR actual_found > actual_processed THEN
    RAISE EXCEPTION 'Dispatch settlement exceeds reservation';
  END IF;
  stamp := clock_timestamp();
  has_errors := jsonb_array_length(p_errors) > 0;
  SELECT EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_errors) AS entry(value)
    WHERE jsonb_typeof(value) <> 'string'
      OR regexp_replace(lower(value #>> '{}'), '[_-]+', ' ', 'g') !~
        '(\mambiguous\s*(org|organization|organisation)\M|\m(organization|organisation|org)\M.*\mambiguous\M|\mcannot resolve organization identity\M)'
  ) INTO has_retryable_errors;
  SELECT CASE WHEN has_retryable_errors THEN least(consecutive_failures::bigint + 1, 2147483647)::integer ELSE 0 END
    INTO failures FROM public.icp_dispatch_site_state WHERE site_id = d.site_id FOR UPDATE;
  SELECT CASE WHEN has_retryable_errors THEN least(failure_count::bigint + 1, 2147483647)::integer ELSE 0 END
    INTO list_failures FROM public.icp_dispatch_list_state WHERE icp_mining_id = d.icp_mining_id FOR UPDATE;
  IF has_errors AND NOT has_retryable_errors THEN
    cooldown := 0;
    list_cooldown := 0;
  ELSE
    cooldown := least(21600, greatest(300, COALESCE(p_retry_after_seconds, 300),
      CASE WHEN has_retryable_errors THEN 300 * (2 ^ least(greatest(failures - 1, 0), 7))::integer ELSE 300 END));
    list_cooldown := least(21600, greatest(300, COALESCE(p_retry_after_seconds, 300),
      CASE WHEN has_retryable_errors THEN 300 * (2 ^ least(greatest(list_failures - 1, 0), 7))::integer ELSE 300 END));
  END IF;
  UPDATE public.icp_dispatch_runs SET state = 'settled', processed = actual_processed, found = actual_found,
    error = CASE WHEN has_errors THEN p_errors::text ELSE NULL END, updated_at = stamp WHERE id = d.id;
  UPDATE public.icp_dispatch_site_state SET consecutive_failures = failures,
    next_eligible_at = greatest(next_eligible_at, stamp + make_interval(secs => cooldown)) WHERE site_id = d.site_id;
  UPDATE public.icp_dispatch_list_state SET failure_count = list_failures,
    next_eligible_at = greatest(next_eligible_at, stamp + make_interval(secs => list_cooldown)) WHERE icp_mining_id = d.icp_mining_id;
  -- Keep ownership, idempotency, conservative candidate charging and budget day.
  RETURN jsonb_build_object('success', true, 'next_eligible_at',
    (SELECT next_eligible_at FROM public.icp_dispatch_site_state WHERE site_id = d.site_id));
END $$;