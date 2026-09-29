-- Execute in an isolated PostgreSQL fixture only. The entire test rolls back.
BEGIN;
CREATE ROLE service_role;
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE TABLE public.settings (site_id uuid PRIMARY KEY, social_media jsonb, updated_at timestamptz DEFAULT now());
CREATE TABLE public.cron_status (id uuid, site_id uuid, activity_name text, status text);
\i supabase/migrations/20260929000000_outstand_initial_import_per_account.sql

INSERT INTO public.settings (site_id, social_media) VALUES
  ('00000000-0000-4000-8000-000000000001',
   '[{"id":"pigs","network":"instagram","isActive":true},{"id":"other","network":"instagram","isActive":true}]'::jsonb);
DO $$
DECLARE
  v_site uuid := '00000000-0000-4000-8000-000000000001';
  v_status text;
BEGIN
  IF NOT public.claim_outstand_initial_import(v_site, 'pigs', 100) THEN RAISE EXCEPTION 'first claim rejected'; END IF;
  IF public.claim_outstand_initial_import(v_site, 'pigs', 100) THEN RAISE EXCEPTION 'second claim accepted'; END IF;
  IF NOT public.claim_outstand_initial_import(v_site, 'other', 100) THEN RAISE EXCEPTION 'independent account rejected'; END IF;
  IF (SELECT count(*) FROM public.outstand_initial_imports) <> 2 THEN RAISE EXCEPTION 'ledger missing'; END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.outstand_initial_imports'::regclass) THEN
    RAISE EXCEPTION 'ledger RLS disabled';
  END IF;
  IF has_function_privilege('authenticated', 'public.claim_outstand_initial_import(uuid,text,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'client may claim paid import';
  END IF;
  IF public.claim_outstand_initial_import('00000000-0000-4000-8000-000000000002', 'pigs', 100) THEN
    RAISE EXCEPTION 'another tenant claimed the same account';
  END IF;
  IF NOT public.record_outstand_initial_import(v_site, 'pigs', 'queued', 'job-1') THEN
    RAISE EXCEPTION 'queued job not recorded';
  END IF;
  IF NOT public.record_outstand_initial_import(v_site, 'pigs', 'completed', 'job-1', 6, 0) THEN
    RAISE EXCEPTION 'completed job not recorded';
  END IF;
  IF public.record_outstand_initial_import(v_site, 'pigs', 'running', 'job-1') THEN
    RAISE EXCEPTION 'completed job regressed';
  END IF;
  IF public.record_outstand_initial_import(v_site, 'pigs', 'completed', 'different-job', 6, 0) THEN
    RAISE EXCEPTION 'job identity was overwritten';
  END IF;
  IF (SELECT social_media->0->'initialImport'->>'status' FROM public.settings WHERE site_id=v_site) <> 'completed' THEN
    RAISE EXCEPTION 'per-account flag missing';
  END IF;

  -- A stale settings form may erase the flag: the global ledger is authoritative.
  UPDATE public.settings SET social_media = '[{"id":"pigs","network":"instagram","isActive":true}]'::jsonb
  WHERE site_id=v_site;
  IF public.claim_outstand_initial_import(v_site, 'pigs', 100) THEN
    RAISE EXCEPTION 'stale settings caused a repeat billable claim';
  END IF;
  IF (SELECT social_media->0->'initialImport'->>'status' FROM public.settings WHERE site_id=v_site) <> 'completed' THEN
    RAISE EXCEPTION 'claim did not repair missing account flag';
  END IF;
  IF NOT public.record_outstand_initial_import(v_site, 'pigs', 'completed', 'job-1', 6, 0) THEN
    RAISE EXCEPTION 'could not repair a stale account flag';
  END IF;
  IF (SELECT social_media->0->'initialImport'->>'jobId' FROM public.settings WHERE site_id=v_site) <> 'job-1' THEN
    RAISE EXCEPTION 'account flag not repaired from ledger';
  END IF;
  BEGIN
    PERFORM public.claim_outstand_initial_import(v_site, 'pigs', 101);
    RAISE EXCEPTION 'limit > 100 accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Invalid initial import request' THEN RAISE; END IF;
  END;
  SELECT status INTO v_status FROM public.outstand_initial_imports WHERE account_id='pigs';
  IF v_status <> 'completed' THEN RAISE EXCEPTION 'ledger regressed'; END IF;

  -- If the provider POST response was lost, a later form save must not remove
  -- the visible unknown state or authorize a second paid import.
  UPDATE public.settings SET social_media = '[{"id":"pigs","network":"instagram","isActive":true},{"id":"other","network":"instagram","isActive":true}]'::jsonb
  WHERE site_id = v_site;
  IF NOT public.record_outstand_initial_import(v_site, 'other', 'unknown') THEN
    RAISE EXCEPTION 'ambiguous response was not recorded';
  END IF;
  UPDATE public.settings SET social_media = '[{"id":"other","network":"instagram","isActive":true}]'::jsonb
  WHERE site_id = v_site;
  IF public.claim_outstand_initial_import(v_site, 'other', 100) THEN
    RAISE EXCEPTION 'unknown claim retried';
  END IF;
  IF (SELECT social_media->0->'initialImport'->>'status' FROM public.settings WHERE site_id=v_site) <> 'unknown' THEN
    RAISE EXCEPTION 'unknown display state not repaired';
  END IF;
  UPDATE public.settings SET social_media = '[{"id":"pigs","network":"instagram","isActive":false}]'::jsonb
  WHERE site_id=v_site;
  IF public.claim_outstand_initial_import(v_site, 'pigs', 100) THEN
    RAISE EXCEPTION 'inactive account accepted';
  END IF;
END;
$$;
ROLLBACK;