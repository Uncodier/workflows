-- One bounded historical import per connected Outstand account. Apply before
-- deploying the API/worker: the next social poll can initiate billable imports
-- for existing accounts that have no initialImport flag or provider job.
-- The ledger survives a stale settings form save or account reconnection.
CREATE TABLE public.outstand_initial_imports (
  account_id text PRIMARY KEY,
  site_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'requested',
  import_limit integer NOT NULL CHECK (import_limit BETWEEN 1 AND 100),
  job_id text,
  imported integer,
  failed integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outstand_initial_imports_status_check CHECK (
    status IN ('requested', 'queued', 'running', 'completed', 'partial', 'failed', 'unknown')
  )
);
ALTER TABLE public.outstand_initial_imports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.outstand_initial_imports FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.outstand_initial_imports TO service_role;
CREATE OR REPLACE FUNCTION public.claim_outstand_initial_import(
  p_site_id uuid, p_account_id text, p_limit integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_media jsonb;
  v_index integer;
  v_owners integer;
  v_existing public.outstand_initial_imports%ROWTYPE;
BEGIN
  IF p_site_id IS NULL OR p_account_id IS NULL OR p_limit IS NULL
    OR p_account_id !~ '^[A-Za-z0-9_-]{1,80}$' OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'Invalid initial import request';
  END IF;

  -- Serialize every claim (including an account changing sites) before the
  -- billable POST; the ledger is keyed by provider account ID globally.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_account_id, 0));
  -- Lock the whole settings row so competing workers/manual requests cannot
  -- simultaneously claim an account or overwrite each other's JSONB changes.
  SELECT social_media INTO v_media FROM public.settings
  WHERE site_id = p_site_id FOR UPDATE;
  IF jsonb_typeof(v_media) IS DISTINCT FROM 'array' THEN RETURN false; END IF;

  SELECT count(*) INTO v_owners
  FROM public.settings AS s
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(s.social_media) = 'array' THEN s.social_media ELSE '[]'::jsonb END
  ) AS a(value)
  WHERE a.value->>'id' = p_account_id
    AND a.value->>'isActive' IN ('true', '1');
  IF v_owners <> 1 THEN RETURN false; END IF;

  SELECT (position - 1)::integer INTO v_index
  FROM jsonb_array_elements(v_media) WITH ORDINALITY AS a(value, position)
  WHERE a.value->>'id' = p_account_id
    AND a.value->>'isActive' IN ('true', '1')
  LIMIT 1;
  IF v_index IS NULL THEN RETURN false; END IF;

  -- An account may already have an import marker from the previous worker.
  -- Do not create another billable job if provider history was later cleared.
  IF EXISTS (SELECT 1 FROM public.cron_status WHERE site_id = p_site_id
    AND activity_name = 'outstand_historical_import_' || p_account_id)
  THEN RETURN false; END IF;

  INSERT INTO public.outstand_initial_imports (account_id, site_id, import_limit)
  VALUES (p_account_id, p_site_id, p_limit) ON CONFLICT (account_id) DO NOTHING;
  IF NOT FOUND THEN
    -- A stale settings form can replace the JSON flag. Reconstruct it from
    -- the durable ledger without issuing another billable provider request.
    SELECT * INTO v_existing FROM public.outstand_initial_imports
    WHERE account_id = p_account_id AND site_id = p_site_id;
    IF FOUND THEN
      UPDATE public.settings SET social_media = jsonb_set(v_media,
        ARRAY[v_index::text, 'initialImport'], jsonb_strip_nulls(jsonb_build_object(
          'status', v_existing.status, 'limit', v_existing.import_limit,
          'jobId', v_existing.job_id, 'imported', v_existing.imported,
          'failed', v_existing.failed, 'requestedAt', v_existing.created_at,
          'updatedAt', v_existing.updated_at)), true), updated_at = now()
      WHERE site_id = p_site_id AND NOT (v_media->v_index ? 'initialImport');
    END IF;
    RETURN false;
  END IF;

  UPDATE public.settings
  SET social_media = jsonb_set(v_media, ARRAY[v_index::text, 'initialImport'],
    jsonb_build_object('status', 'requested', 'limit', p_limit, 'requestedAt', now()), true),
      updated_at = now()
  WHERE site_id = p_site_id;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_outstand_initial_import(
  p_site_id uuid, p_account_id text, p_status text, p_job_id text DEFAULT NULL,
  p_imported integer DEFAULT NULL, p_failed integer DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_media jsonb;
  v_index integer;
  v_flag jsonb;
  v_status text;
  v_existing_job text;
  v_existing_site uuid;
BEGIN
  IF p_site_id IS NULL OR p_account_id IS NULL OR p_status IS NULL OR
    p_account_id !~ '^[A-Za-z0-9_-]{1,80}$' OR
    p_status NOT IN ('queued', 'running', 'completed', 'partial', 'failed', 'unknown') THEN
    RAISE EXCEPTION 'Invalid initial import status';
  END IF;
  IF (p_job_id IS NULL OR p_job_id = '') AND p_status <> 'unknown' THEN
    RAISE EXCEPTION 'Provider job ID required to record an import';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_account_id, 0));
  SELECT social_media INTO v_media FROM public.settings
  WHERE site_id = p_site_id FOR UPDATE;
  IF jsonb_typeof(v_media) IS DISTINCT FROM 'array' THEN RETURN false; END IF;

  SELECT (position - 1)::integer, a.value->'initialImport'
  INTO v_index, v_flag
  FROM jsonb_array_elements(v_media) WITH ORDINALITY AS a(value, position)
  WHERE a.value->>'id' = p_account_id
    AND a.value->>'isActive' IN ('true', '1')
  LIMIT 1;
  IF v_index IS NULL THEN RETURN false; END IF;
  IF jsonb_typeof(v_flag) IS DISTINCT FROM 'object' THEN v_flag := '{}'::jsonb; END IF;

  -- A provider job may appear after our POST timed out, or predate this
  -- migration. Adopt the first one; never replace its identity later.
  IF p_job_id IS NOT NULL AND p_status <> 'unknown' THEN
    INSERT INTO public.outstand_initial_imports
      (account_id, site_id, import_limit, status, job_id, imported, failed)
    VALUES (p_account_id, p_site_id, 100, p_status, p_job_id, p_imported, p_failed)
    ON CONFLICT (account_id) DO NOTHING;
  END IF;
  IF p_job_id IS NULL AND NOT EXISTS (SELECT 1 FROM public.outstand_initial_imports
    WHERE account_id = p_account_id AND site_id = p_site_id)
  THEN RETURN false; END IF;
  SELECT status, job_id, site_id INTO v_status, v_existing_job, v_existing_site
  FROM public.outstand_initial_imports WHERE account_id = p_account_id;
  IF v_existing_site IS DISTINCT FROM p_site_id OR
    (v_existing_job IS NOT NULL AND v_existing_job IS DISTINCT FROM p_job_id)
  THEN RETURN false; END IF;

  -- The ledger is authoritative; JSONB may be stale after settings saves.
  IF v_status IN ('queued', 'running', 'completed', 'partial', 'failed')
    AND p_status = 'unknown' THEN RETURN false; END IF;
  IF v_status IN ('completed', 'partial', 'failed') AND v_status <> p_status THEN RETURN false; END IF;

  UPDATE public.outstand_initial_imports
  SET status = p_status, job_id = coalesce(p_job_id, job_id),
      imported = coalesce(p_imported, imported), failed = coalesce(p_failed, failed),
      updated_at = now()
  WHERE account_id = p_account_id AND site_id = p_site_id
    AND (status NOT IN ('completed', 'partial', 'failed') OR status = p_status);

  v_flag := v_flag || jsonb_build_object('status', p_status, 'updatedAt', now());
  IF p_job_id IS NOT NULL THEN v_flag := v_flag || jsonb_build_object('jobId', p_job_id); END IF;
  IF p_imported IS NOT NULL THEN v_flag := v_flag || jsonb_build_object('imported', p_imported); END IF;
  IF p_failed IS NOT NULL THEN v_flag := v_flag || jsonb_build_object('failed', p_failed); END IF;
  UPDATE public.settings
  SET social_media = jsonb_set(v_media, ARRAY[v_index::text, 'initialImport'], v_flag),
      updated_at = now()
  WHERE site_id = p_site_id;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_outstand_initial_import(uuid, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_outstand_initial_import(uuid, text, text, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_outstand_initial_import(uuid, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_outstand_initial_import(uuid, text, text, text, integer, integer) TO service_role;