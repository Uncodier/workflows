-- DEPLOYMENT GATE: drain legacy ICP workflows before enabling this dispatcher.
-- enabled=true is intentional. There is no historical quota backfill, timed lease,
-- expiry, reset, delete, or automatic reconciliation of uncertain reservations.
-- Prerequisites: execution checkpoints and sites.archived_at (site archival migration).
CREATE TABLE public.icp_dispatch_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled boolean NOT NULL DEFAULT true,
  max_concurrency integer NOT NULL DEFAULT 3 CHECK (max_concurrency BETWEEN 1 AND 10),
  slice_candidates integer NOT NULL DEFAULT 10 CHECK (slice_candidates BETWEEN 1 AND 10),
  daily_candidate_limit integer NOT NULL DEFAULT 3000 CHECK (daily_candidate_limit BETWEEN 1 AND 3000)
);
INSERT INTO public.icp_dispatch_config (id) VALUES (true);

CREATE TABLE public.icp_dispatch_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites(id),
  icp_mining_id uuid NOT NULL REFERENCES public.icp_mining(id),
  dispatch_key text NOT NULL UNIQUE CHECK (length(btrim(dispatch_key)) > 0),
  workflow_id text NOT NULL UNIQUE CHECK (length(btrim(workflow_id)) > 0),
  run_id uuid,
  budget_day date NOT NULL,
  state text NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved', 'running', 'settled', 'blocked')),
  target_limit integer NOT NULL CHECK (target_limit BETWEEN 1 AND 3000),
  candidate_limit integer NOT NULL CHECK (candidate_limit BETWEEN 1 AND 3000 AND candidate_limit <= target_limit * 10),
  research_enabled boolean NOT NULL,
  baseline_processed integer CHECK (baseline_processed >= 0),
  baseline_found integer CHECK (baseline_found >= 0),
  reserved_candidates integer NOT NULL CHECK (reserved_candidates BETWEEN 1 AND 10 AND reserved_candidates <= candidate_limit),
  reserved_matches integer NOT NULL CHECK (reserved_matches BETWEEN 1 AND 10 AND reserved_matches <= reserved_candidates AND reserved_matches <= target_limit),
  processed integer NOT NULL DEFAULT 0 CHECK (processed BETWEEN 0 AND reserved_candidates),
  found integer NOT NULL DEFAULT 0 CHECK (found BETWEEN 0 AND reserved_matches AND found <= processed),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((baseline_processed IS NULL) = (baseline_found IS NULL)),
  CHECK (state NOT IN ('running', 'settled') OR (run_id IS NOT NULL AND baseline_processed IS NOT NULL)),
  CHECK (state = 'settled' OR (processed = 0 AND found = 0))
);
CREATE UNIQUE INDEX icp_dispatch_runs_one_active_site ON public.icp_dispatch_runs(site_id)
  WHERE state IN ('reserved', 'running', 'blocked');
CREATE INDEX icp_dispatch_runs_site_budget_day ON public.icp_dispatch_runs(site_id, budget_day);
CREATE INDEX icp_dispatch_runs_budget_day ON public.icp_dispatch_runs(budget_day);

CREATE TABLE public.icp_dispatch_site_state (
  site_id uuid PRIMARY KEY REFERENCES public.sites(id),
  last_dispatched_at timestamptz,
  next_eligible_at timestamptz,
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0)
);
CREATE TABLE public.icp_dispatch_list_state (
  icp_mining_id uuid PRIMARY KEY REFERENCES public.icp_mining(id),
  site_id uuid NOT NULL REFERENCES public.sites(id),
  last_dispatched_at timestamptz,
  next_eligible_at timestamptz,
  failure_count integer NOT NULL DEFAULT 0 CHECK (failure_count >= 0)
);
CREATE INDEX icp_dispatch_list_state_site ON public.icp_dispatch_list_state(site_id);

CREATE OR REPLACE FUNCTION public.reserve_icp_dispatch(
  p_site_id uuid, p_icp_id uuid, p_dispatch_key text, p_workflow_id text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  c public.icp_dispatch_config;
  d public.icp_dispatch_runs;
  r public.icp_mining;
  activity_settings jsonb;
  settings_json jsonb;
  list_ids jsonb;
  target integer := 150;
  research boolean := false;
  all_lists boolean := true;
  candidate_cap integer;
  candidates_used bigint;
  matches_used bigint;
  candidates integer;
  matches integer;
  stamp timestamptz;
  day_utc date;
BEGIN
  IF p_site_id IS NULL OR p_icp_id IS NULL OR NULLIF(btrim(p_dispatch_key), '') IS NULL
    OR NULLIF(btrim(p_workflow_id), '') IS NULL THEN
    RETURN jsonb_build_object('acquired', false, 'reason', 'invalid_identity');
  END IF;
  -- One transaction lock for ALL reservations, begin, finish and manual claims.
  -- Always acquire it BEFORE config/reservation/ICP row locks. Never use a TTL.
  PERFORM pg_catalog.pg_advisory_xact_lock(734210, 1);
  SELECT * INTO c FROM public.icp_dispatch_config WHERE id FOR SHARE;
  SELECT * INTO d FROM public.icp_dispatch_runs WHERE dispatch_key = p_dispatch_key;
  IF FOUND THEN
    IF (d.site_id, d.icp_mining_id, d.workflow_id) IS DISTINCT FROM (p_site_id, p_icp_id, p_workflow_id) THEN
      RETURN jsonb_build_object('acquired', false, 'reason', 'dispatch_key_conflict');
    END IF;
    RETURN jsonb_build_object('acquired', true, 'reservation', to_jsonb(d));
  END IF;
  IF EXISTS (SELECT 1 FROM public.icp_dispatch_runs WHERE workflow_id = p_workflow_id) THEN
    RETURN jsonb_build_object('acquired', false, 'reason', 'workflow_id_conflict');
  END IF;
  IF c.enabled IS DISTINCT FROM true THEN RETURN jsonb_build_object('acquired', false, 'reason', 'disabled'); END IF;
  stamp := clock_timestamp();
  day_utc := (stamp AT TIME ZONE 'UTC')::date;
  PERFORM 1 FROM public.sites WHERE id = p_site_id AND archived_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('acquired', false, 'reason', 'site_unavailable'); END IF;

  -- Read authoritative settings for EVERY new reservation. Missing legacy fields
  -- use defaults; malformed controls (including any malformed selected ID) deny.
  SELECT activities INTO activity_settings FROM public.settings WHERE site_id = p_site_id FOR SHARE;
  activity_settings := COALESCE(activity_settings, '{}'::jsonb);
  IF jsonb_typeof(activity_settings) IS DISTINCT FROM 'object' THEN
    RETURN jsonb_build_object('acquired', false, 'reason', 'invalid_settings');
  END IF;
  settings_json := COALESCE(activity_settings->'icp_lead_generation', '{}'::jsonb);
  IF jsonb_typeof(settings_json) IS DISTINCT FROM 'object' THEN
    RETURN jsonb_build_object('acquired', false, 'reason', 'invalid_settings');
  END IF;
  IF settings_json ? 'target_leads' THEN
    IF jsonb_typeof(settings_json->'target_leads') IS DISTINCT FROM 'number' THEN
      RETURN jsonb_build_object('acquired', false, 'reason', 'invalid_settings');
    END IF;
    IF (settings_json->>'target_leads')::numeric NOT BETWEEN 1 AND 3000
      OR trunc((settings_json->>'target_leads')::numeric) <> (settings_json->>'target_leads')::numeric THEN
      RETURN jsonb_build_object('acquired', false, 'reason', 'invalid_settings');
    END IF;
    target := (settings_json->>'target_leads')::numeric::integer;
  END IF;
  IF settings_json ? 'research_enabled' THEN
    IF jsonb_typeof(settings_json->'research_enabled') IS DISTINCT FROM 'boolean' THEN
      RETURN jsonb_build_object('acquired', false, 'reason', 'invalid_settings');
    END IF;
    research := (settings_json->>'research_enabled')::boolean;
  END IF;
  IF settings_json ? 'all_lists' THEN
    IF jsonb_typeof(settings_json->'all_lists') IS DISTINCT FROM 'boolean' THEN
      RETURN jsonb_build_object('acquired', false, 'reason', 'invalid_settings');
    END IF;
    all_lists := (settings_json->>'all_lists')::boolean;
  END IF;
  list_ids := COALESCE(settings_json->'list_ids', '[]'::jsonb);
  IF jsonb_typeof(list_ids) IS DISTINCT FROM 'array' THEN
    RETURN jsonb_build_object('acquired', false, 'reason', 'invalid_settings');
  END IF;
  IF jsonb_array_length(list_ids) > 1000 OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(list_ids) AS item(value)
    WHERE jsonb_typeof(value) IS DISTINCT FROM 'string'
      OR (value #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) THEN RETURN jsonb_build_object('acquired', false, 'reason', 'invalid_settings'); END IF;
  IF NOT all_lists AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(list_ids) AS item(value) WHERE value::uuid = p_icp_id
  ) THEN RETURN jsonb_build_object('acquired', false, 'reason', 'list_not_selected'); END IF;

  SELECT * INTO r FROM public.icp_mining WHERE id = p_icp_id AND site_id = p_site_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('acquired', false, 'reason', 'list_unavailable'); END IF;
  IF r.status NOT IN ('pending', 'running') THEN RETURN jsonb_build_object('acquired', false, 'reason', 'not_pending'); END IF;
  IF EXISTS (SELECT 1 FROM public.icp_dispatch_runs WHERE site_id = p_site_id AND state IN ('reserved', 'running', 'blocked')) THEN
    RETURN jsonb_build_object('acquired', false, 'reason', 'site_busy');
  END IF;
  IF EXISTS (SELECT 1 FROM public.icp_mining WHERE site_id = p_site_id AND execution_active) THEN
    RETURN jsonb_build_object('acquired', false, 'reason', 'execution_busy');
  END IF;
  IF (SELECT count(*) FROM public.icp_dispatch_runs WHERE state IN ('reserved', 'running', 'blocked'))
    + (SELECT count(*) FROM public.icp_mining legacy WHERE legacy.execution_active AND NOT EXISTS (
        SELECT 1 FROM public.icp_dispatch_runs owned WHERE owned.icp_mining_id = legacy.id
          AND owned.run_id = legacy.execution_run_id AND owned.state IN ('reserved', 'running', 'blocked')
      )) >= c.max_concurrency THEN
    RETURN jsonb_build_object('acquired', false, 'reason', 'global_capacity');
  END IF;
  IF EXISTS (SELECT 1 FROM public.icp_dispatch_site_state WHERE site_id = p_site_id AND next_eligible_at > stamp) THEN
    RETURN jsonb_build_object('acquired', false, 'reason', 'site_cooldown');
  END IF;
  IF EXISTS (SELECT 1 FROM public.icp_dispatch_list_state WHERE icp_mining_id = p_icp_id AND next_eligible_at > stamp) THEN
    RETURN jsonb_build_object('acquired', false, 'reason', 'list_cooldown');
  END IF;
  candidate_cap := least(c.daily_candidate_limit, target * 10);
  SELECT COALESCE(sum(budget.reserved_candidates), 0),
    COALESCE(sum(CASE WHEN budget.state = 'settled' THEN budget.found ELSE budget.reserved_matches END), 0)
    INTO candidates_used, matches_used FROM public.icp_dispatch_runs budget
    WHERE budget.site_id = p_site_id AND budget.budget_day = day_utc;
  IF matches_used >= target THEN RETURN jsonb_build_object('acquired', false, 'reason', 'match_quota'); END IF;
  IF candidates_used >= candidate_cap THEN RETURN jsonb_build_object('acquired', false, 'reason', 'candidate_quota'); END IF;
  -- total_targets=0 is the pre-fetch/unknown sentinel in the existing schema.
  candidates := least(c.slice_candidates, candidate_cap - candidates_used,
    CASE WHEN r.total_targets > 0 THEN greatest(0, r.total_targets - COALESCE(r.processed_targets, 0)) ELSE 10 END);
  IF candidates < 1 THEN RETURN jsonb_build_object('acquired', false, 'reason', 'list_exhausted'); END IF;
  matches := least(candidates, target - matches_used);
  INSERT INTO public.icp_dispatch_runs (site_id, icp_mining_id, dispatch_key, workflow_id,
    budget_day, target_limit, candidate_limit, research_enabled, reserved_candidates, reserved_matches, created_at, updated_at)
    VALUES (p_site_id, p_icp_id, p_dispatch_key, p_workflow_id, day_utc, target, candidate_cap,
      research, candidates, matches, stamp, stamp) RETURNING * INTO d;
  -- Touch fairness at reservation, not completion; lost start responses keep their turn.
  INSERT INTO public.icp_dispatch_site_state (site_id, last_dispatched_at) VALUES (p_site_id, stamp)
    ON CONFLICT (site_id) DO UPDATE SET last_dispatched_at = EXCLUDED.last_dispatched_at;
  INSERT INTO public.icp_dispatch_list_state (icp_mining_id, site_id, last_dispatched_at) VALUES (p_icp_id, p_site_id, stamp)
    ON CONFLICT (icp_mining_id) DO UPDATE SET last_dispatched_at = EXCLUDED.last_dispatched_at;
  RETURN jsonb_build_object('acquired', true, 'reservation', to_jsonb(d));
END $$;

-- Preserve the existing compare-and-swap claim body. The dispatcher guard runs
-- before its row lock/claim and cannot be bypassed by supplying previous_run_id.
CREATE OR REPLACE FUNCTION public.claim_icp_mining_execution(
  p_id uuid, p_site_id uuid, p_run_id uuid, p_workflow_id text,
  p_previous_run_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.icp_mining; d public.icp_dispatch_runs;
BEGIN
  IF p_run_id IS NULL OR NULLIF(p_workflow_id, '') IS NULL THEN RAISE EXCEPTION 'Execution identity required'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(734210, 1);
  SELECT * INTO d FROM public.icp_dispatch_runs WHERE site_id = p_site_id AND state IN ('reserved', 'running', 'blocked');
  IF FOUND AND (d.workflow_id IS DISTINCT FROM p_workflow_id OR d.icp_mining_id IS DISTINCT FROM p_id
    OR d.run_id IS DISTINCT FROM p_run_id OR d.state = 'blocked') THEN
    RETURN jsonb_build_object('acquired', false, 'reason', 'busy',
      'owner_run_id', d.run_id, 'owner_workflow_id', d.workflow_id);
  END IF;
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

CREATE OR REPLACE FUNCTION public.begin_icp_dispatch(p_id uuid, p_run_id uuid, p_workflow_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE d public.icp_dispatch_runs; r public.icp_mining; claim jsonb;
BEGIN
  IF p_run_id IS NULL OR NULLIF(btrim(p_workflow_id), '') IS NULL THEN RAISE EXCEPTION 'Execution identity required'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(734210, 1);
  SELECT * INTO d FROM public.icp_dispatch_runs WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR d.workflow_id IS DISTINCT FROM p_workflow_id THEN RAISE EXCEPTION 'Dispatch workflow mismatch'; END IF;
  IF d.run_id IS NOT NULL AND d.run_id IS DISTINCT FROM p_run_id THEN RAISE EXCEPTION 'Dispatch run mismatch'; END IF;
  IF d.state NOT IN ('reserved', 'running') THEN RETURN jsonb_build_object('acquired', false, 'reason', d.state); END IF;
  IF d.state = 'reserved' THEN
    UPDATE public.icp_dispatch_runs SET run_id = p_run_id, updated_at = clock_timestamp() WHERE id = d.id RETURNING * INTO d;
    claim := public.claim_icp_mining_execution(d.icp_mining_id, d.site_id, p_run_id, p_workflow_id);
    IF (claim->>'acquired')::boolean IS DISTINCT FROM true THEN
      -- Uncertain start never returns its quota/slot. Manual reconciliation only.
      UPDATE public.icp_dispatch_runs SET state = 'blocked', error = 'begin_claim_not_acquired',
        updated_at = clock_timestamp() WHERE id = d.id;
      RETURN jsonb_build_object('acquired', false, 'reason', 'busy');
    END IF;
    SELECT * INTO r FROM public.icp_mining WHERE id = d.icp_mining_id FOR UPDATE;
    UPDATE public.icp_dispatch_runs SET state = 'running', baseline_processed = COALESCE(r.processed_targets, 0),
      baseline_found = COALESCE(r.found_matches, 0), updated_at = clock_timestamp()
      WHERE id = d.id RETURNING * INTO d;
  ELSE
    SELECT * INTO r FROM public.icp_mining WHERE id = d.icp_mining_id FOR UPDATE;
    IF r.execution_run_id IS DISTINCT FROM p_run_id OR r.execution_workflow_id IS DISTINCT FROM p_workflow_id THEN
      RAISE EXCEPTION 'Dispatch execution ownership lost';
    END IF;
  END IF;
  -- Explicit allowlist: never return errors, last_error, criteria or future audit
  -- columns. Same-run retries retain the ORIGINAL baselines and current cursor.
  RETURN jsonb_build_object('acquired', true, 'reservation', to_jsonb(d), 'icp', jsonb_build_object(
    'id', r.id, 'site_id', r.site_id, 'role_query_id', r.role_query_id, 'name', r.name, 'status', r.status,
    'total_targets', r.total_targets, 'processed_targets', r.processed_targets, 'found_matches', r.found_matches,
    'current_page', r.current_page, 'current_page_offset', r.current_page_offset, 'created_at', r.created_at,
    'checkpoint_version', r.checkpoint_version, 'current_page_snapshot', r.current_page_snapshot));
END $$;

-- Keep the existing checkpoint protocol, with a pre-write budget/owner guard.
-- Serializing here also prevents a finish/manual-claim/checkpoint lock inversion.
CREATE OR REPLACE FUNCTION public.checkpoint_icp_mining_execution(
  p_id uuid, p_site_id uuid, p_run_id uuid, p_version integer,
  p_processed integer, p_found integer, p_page integer, p_offset integer,
  p_total integer, p_status text, p_snapshot jsonb, p_errors jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.icp_mining; d public.icp_dispatch_runs;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(734210, 1);
  SELECT * INTO d FROM public.icp_dispatch_runs WHERE site_id = p_site_id AND state IN ('reserved', 'running', 'blocked');
  IF FOUND THEN
    IF d.icp_mining_id IS DISTINCT FROM p_id OR d.run_id IS DISTINCT FROM p_run_id OR d.state <> 'running' THEN
      RAISE EXCEPTION 'Dispatch execution ownership lost';
    END IF;
    IF p_processed < d.baseline_processed OR p_found < d.baseline_found
      OR p_processed::bigint - d.baseline_processed > d.reserved_candidates
      OR p_found::bigint - d.baseline_found > d.reserved_matches
      OR p_found::bigint - d.baseline_found > p_processed::bigint - d.baseline_processed THEN
      RAISE EXCEPTION 'Dispatch checkpoint exceeds reservation';
    END IF;
  END IF;
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

CREATE OR REPLACE FUNCTION public.finish_icp_dispatch(
  p_id uuid, p_run_id uuid, p_errors jsonb DEFAULT '[]'::jsonb, p_retry_after_seconds integer DEFAULT 300
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  d public.icp_dispatch_runs; r public.icp_mining;
  actual_processed bigint; actual_found bigint; failures integer; list_failures integer;
  cooldown integer; list_cooldown integer; has_errors boolean; stamp timestamptz;
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
  -- Saturation avoids integer overflow; failure history is not a time lease.
  SELECT CASE WHEN has_errors THEN least(consecutive_failures::bigint + 1, 2147483647)::integer ELSE 0 END
    INTO failures FROM public.icp_dispatch_site_state WHERE site_id = d.site_id FOR UPDATE;
  SELECT CASE WHEN has_errors THEN least(failure_count::bigint + 1, 2147483647)::integer ELSE 0 END
    INTO list_failures FROM public.icp_dispatch_list_state WHERE icp_mining_id = d.icp_mining_id FOR UPDATE;
  cooldown := least(21600, greatest(300, COALESCE(p_retry_after_seconds, 300),
    CASE WHEN has_errors THEN 300 * (2 ^ least(greatest(failures - 1, 0), 7))::integer ELSE 300 END));
  list_cooldown := least(21600, greatest(300, COALESCE(p_retry_after_seconds, 300),
    CASE WHEN has_errors THEN 300 * (2 ^ least(greatest(list_failures - 1, 0), 7))::integer ELSE 300 END));
  UPDATE public.icp_dispatch_runs SET state = 'settled', processed = actual_processed, found = actual_found,
    error = CASE WHEN has_errors THEN p_errors::text ELSE NULL END, updated_at = stamp WHERE id = d.id;
  UPDATE public.icp_dispatch_site_state SET consecutive_failures = failures,
    next_eligible_at = greatest(next_eligible_at, stamp + make_interval(secs => cooldown)) WHERE site_id = d.site_id;
  UPDATE public.icp_dispatch_list_state SET failure_count = list_failures,
    next_eligible_at = greatest(next_eligible_at, stamp + make_interval(secs => list_cooldown)) WHERE icp_mining_id = d.icp_mining_id;
  -- Never change budget_day or reserved_candidates: all attempts consume their
  -- full reserved candidate budget, even if no checkpointed candidate completed.
  RETURN jsonb_build_object('success', true, 'next_eligible_at',
    (SELECT next_eligible_at FROM public.icp_dispatch_site_state WHERE site_id = d.site_id));
END $$;

ALTER TABLE public.icp_dispatch_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.icp_dispatch_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.icp_dispatch_site_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.icp_dispatch_list_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.icp_dispatch_config, public.icp_dispatch_runs,
  public.icp_dispatch_site_state, public.icp_dispatch_list_state FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.icp_dispatch_config, public.icp_dispatch_runs,
  public.icp_dispatch_site_state, public.icp_dispatch_list_state TO service_role;
GRANT UPDATE (enabled, max_concurrency, slice_candidates, daily_candidate_limit) ON public.icp_dispatch_config TO service_role;
CREATE POLICY icp_dispatch_config_read ON public.icp_dispatch_config FOR SELECT TO service_role USING (true);
CREATE POLICY icp_dispatch_config_update ON public.icp_dispatch_config FOR UPDATE TO service_role USING (id) WITH CHECK (id);
CREATE POLICY icp_dispatch_runs_read ON public.icp_dispatch_runs FOR SELECT TO service_role USING (true);
CREATE POLICY icp_dispatch_site_state_read ON public.icp_dispatch_site_state FOR SELECT TO service_role USING (true);
CREATE POLICY icp_dispatch_list_state_read ON public.icp_dispatch_list_state FOR SELECT TO service_role USING (true);

REVOKE ALL ON FUNCTION public.reserve_icp_dispatch(uuid, uuid, text, text),
  public.begin_icp_dispatch(uuid, uuid, text), public.finish_icp_dispatch(uuid, uuid, jsonb, integer),
  public.claim_icp_mining_execution(uuid, uuid, uuid, text, uuid),
  public.checkpoint_icp_mining_execution(uuid, uuid, uuid, integer, integer, integer, integer, integer, integer, text, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reserve_icp_dispatch(uuid, uuid, text, text),
  public.begin_icp_dispatch(uuid, uuid, text), public.finish_icp_dispatch(uuid, uuid, jsonb, integer),
  public.claim_icp_mining_execution(uuid, uuid, uuid, text, uuid),
  public.checkpoint_icp_mining_execution(uuid, uuid, uuid, integer, integer, integer, integer, integer, integer, text, jsonb, jsonb)
  TO service_role;