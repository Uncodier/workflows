-- Loaded after the schema fixture and both migrations, only in an isolated DB.
-- Each case rolls back its own state. Superuser time/counter mutations below are
-- test-only fault injection; service_role has NO such permissions in deployment.
CREATE FUNCTION pg_temp.reserve(n integer, suffix text DEFAULT '') RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.reserve_icp_dispatch(pg_temp.test_uuid(n), pg_temp.test_uuid(100 + n),
    'dispatch-' || n || suffix, 'workflow-' || n || suffix)
$$;

-- case: singleton bounds, uniqueness, exact reservations and idempotency
BEGIN;
DO $$
DECLARE a jsonb; b jsonb; d public.icp_dispatch_runs;
BEGIN
  ASSERT (SELECT id AND enabled AND max_concurrency = 3 AND slice_candidates = 10 AND daily_candidate_limit = 3000
    FROM public.icp_dispatch_config);
  BEGIN UPDATE public.icp_dispatch_config SET id = false; RAISE EXCEPTION 'bad singleton';
    EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE public.icp_dispatch_config SET max_concurrency = 11; RAISE EXCEPTION 'bad concurrency';
    EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE public.icp_dispatch_config SET slice_candidates = 11; RAISE EXCEPTION 'bad slice';
    EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE public.icp_dispatch_config SET daily_candidate_limit = 3001; RAISE EXCEPTION 'bad daily limit';
    EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE public.icp_dispatch_config SET daily_candidate_limit = 0; RAISE EXCEPTION 'zero daily limit';
    EXCEPTION WHEN check_violation THEN NULL; END;
  a := pg_temp.reserve(1);
  ASSERT (a->>'acquired')::boolean;
  SELECT * INTO d FROM public.icp_dispatch_runs WHERE id = (a->'reservation'->>'id')::uuid;
  ASSERT d.target_limit = 150 AND d.candidate_limit = 1500 AND NOT d.research_enabled;
  ASSERT d.reserved_candidates = 10 AND d.reserved_matches = 10 AND d.baseline_processed IS NULL AND d.run_id IS NULL;
  ASSERT d.budget_day = (clock_timestamp() AT TIME ZONE 'UTC')::date;
  ASSERT (SELECT last_dispatched_at = d.created_at FROM public.icp_dispatch_site_state WHERE site_id = d.site_id);
  ASSERT (SELECT last_dispatched_at = d.created_at FROM public.icp_dispatch_list_state WHERE icp_mining_id = d.icp_mining_id);
  UPDATE public.icp_dispatch_config SET enabled = false;
  ASSERT pg_temp.reserve(1) = a, 'Exact retry survives config changes without charging twice';
  ASSERT pg_temp.reserve(2)->>'reason' = 'disabled';
  UPDATE public.icp_dispatch_config SET enabled = true;
  ASSERT public.reserve_icp_dispatch(pg_temp.test_uuid(2), pg_temp.test_uuid(102), 'dispatch-1', 'other')->>'reason' = 'dispatch_key_conflict';
  ASSERT public.reserve_icp_dispatch(pg_temp.test_uuid(2), pg_temp.test_uuid(102), 'other', 'workflow-1')->>'reason' = 'workflow_id_conflict';
  ASSERT pg_temp.reserve(1, '-next')->>'reason' = 'site_busy';
  UPDATE public.icp_mining SET total_targets = 6, processed_targets = 3 WHERE id = pg_temp.test_uuid(102);
  b := pg_temp.reserve(2);
  ASSERT (b->'reservation'->>'reserved_candidates')::integer = 3, 'Known list remainder bounds slice';
  BEGIN UPDATE public.icp_dispatch_runs SET dispatch_key = d.dispatch_key WHERE site_id = pg_temp.test_uuid(2);
    RAISE EXCEPTION 'duplicate key'; EXCEPTION WHEN unique_violation THEN NULL; END;
  BEGIN UPDATE public.icp_dispatch_runs SET workflow_id = d.workflow_id WHERE site_id = pg_temp.test_uuid(2);
    RAISE EXCEPTION 'duplicate workflow'; EXCEPTION WHEN unique_violation THEN NULL; END;
  BEGIN UPDATE public.icp_dispatch_runs SET site_id = d.site_id WHERE site_id = pg_temp.test_uuid(2);
    RAISE EXCEPTION 'duplicate active site'; EXCEPTION WHEN unique_violation THEN NULL; END;
  UPDATE public.icp_mining SET total_targets = 0 WHERE id = pg_temp.test_uuid(103);
  UPDATE public.settings SET activities = '{"icp_lead_generation":{"target_leads":2,"research_enabled":true}}'
    WHERE site_id = pg_temp.test_uuid(3);
  b := pg_temp.reserve(3);
  ASSERT (b->'reservation'->>'reserved_candidates')::integer = 10, 'Zero total is unknown, not exhausted';
  ASSERT (b->'reservation'->>'reserved_matches')::integer = 2;
  ASSERT (b->'reservation'->>'candidate_limit')::integer = 20 AND (b->'reservation'->>'research_enabled')::boolean;
  ASSERT pg_temp.reserve(4)->>'reason' = 'global_capacity';
  ASSERT (SELECT count(*) = 3 FROM public.icp_dispatch_runs);
END $$;
ROLLBACK;

-- case: authoritative settings fail closed without subset fallback
BEGIN;
DO $$
DECLARE invalid jsonb; response jsonb;
BEGIN
  FOR invalid IN SELECT value FROM jsonb_array_elements('[
    {"target_leads":"150"},{"target_leads":null},{"target_leads":0},{"target_leads":3001},{"target_leads":1.1},
    {"research_enabled":"false"},{"research_enabled":null},{"all_lists":null},{"all_lists":0},
    {"list_ids":null},{"list_ids":{}},{"list_ids":[null]},{"list_ids":[5]},
    {"all_lists":true,"list_ids":["00000000-0000-4000-8000-000000000101","invalid"]},null,[]]')
  LOOP
    UPDATE public.settings SET activities = jsonb_build_object('icp_lead_generation', invalid) WHERE site_id = pg_temp.test_uuid(1);
    ASSERT pg_temp.reserve(1)->>'reason' = 'invalid_settings', invalid::text;
  END LOOP;
  UPDATE public.settings SET activities = '[]' WHERE site_id = pg_temp.test_uuid(1);
  ASSERT pg_temp.reserve(1)->>'reason' = 'invalid_settings';
  UPDATE public.settings SET activities = jsonb_build_object('icp_lead_generation', jsonb_build_object('list_ids',
    (SELECT jsonb_agg(pg_temp.test_uuid(101)) FROM generate_series(1, 1001)))) WHERE site_id = pg_temp.test_uuid(1);
  ASSERT pg_temp.reserve(1)->>'reason' = 'invalid_settings';
  UPDATE public.settings SET activities = '{"icp_lead_generation":{"all_lists":false,"list_ids":[]}}' WHERE site_id = pg_temp.test_uuid(1);
  ASSERT pg_temp.reserve(1)->>'reason' = 'list_not_selected', 'Explicit empty selection never falls back';
  UPDATE public.settings SET activities = jsonb_build_object('icp_lead_generation', jsonb_build_object(
    'all_lists', false, 'list_ids', jsonb_build_array(pg_temp.test_uuid(102)))) WHERE site_id = pg_temp.test_uuid(1);
  ASSERT pg_temp.reserve(1)->>'reason' = 'list_not_selected';
  ASSERT public.reserve_icp_dispatch(pg_temp.test_uuid(1), pg_temp.test_uuid(102), 'cross', 'cross')->>'reason' = 'list_unavailable';
  ASSERT NOT EXISTS (SELECT 1 FROM public.icp_dispatch_runs);
  UPDATE public.settings SET activities = jsonb_build_object('icp_lead_generation', jsonb_build_object(
    'all_lists', false, 'target_leads', 1.0, 'list_ids', jsonb_build_array(pg_temp.test_uuid(101)))) WHERE site_id = pg_temp.test_uuid(1);
  ASSERT (pg_temp.reserve(1)->>'acquired')::boolean, 'Integral JSON numeric is valid';
  DELETE FROM public.settings WHERE site_id = pg_temp.test_uuid(2);
  response := pg_temp.reserve(2);
  ASSERT (response->'reservation'->>'target_limit')::integer = 150, 'Missing legacy settings default';
END $$;
ROLLBACK;

-- case: site/list eligibility, archived sites, legacy executions and global cap
BEGIN;
DO $$
BEGIN
  UPDATE public.sites SET archived_at = now() WHERE id = pg_temp.test_uuid(1);
  ASSERT pg_temp.reserve(1)->>'reason' = 'site_unavailable';
  UPDATE public.sites SET archived_at = NULL WHERE id = pg_temp.test_uuid(1);
  UPDATE public.icp_mining SET status = 'completed' WHERE id = pg_temp.test_uuid(101);
  ASSERT pg_temp.reserve(1)->>'reason' = 'not_pending';
  UPDATE public.icp_mining SET status = 'pending', processed_targets = total_targets WHERE id = pg_temp.test_uuid(101);
  ASSERT pg_temp.reserve(1)->>'reason' = 'list_exhausted';
  UPDATE public.icp_mining SET processed_targets = 0 WHERE id = pg_temp.test_uuid(101);
  INSERT INTO public.icp_dispatch_site_state (site_id, next_eligible_at) VALUES (pg_temp.test_uuid(1), now() + interval '5 minutes');
  ASSERT pg_temp.reserve(1)->>'reason' = 'site_cooldown';
  UPDATE public.icp_dispatch_site_state SET next_eligible_at = now() - interval '1 second';
  INSERT INTO public.icp_dispatch_list_state (site_id, icp_mining_id, next_eligible_at)
    VALUES (pg_temp.test_uuid(1), pg_temp.test_uuid(101), now() + interval '5 minutes');
  ASSERT pg_temp.reserve(1)->>'reason' = 'list_cooldown';
  UPDATE public.icp_dispatch_list_state SET next_eligible_at = now() - interval '1 second';
  ASSERT (public.claim_icp_mining_execution(pg_temp.test_uuid(201), pg_temp.test_uuid(1), pg_temp.test_uuid(901), 'legacy')->>'acquired')::boolean;
  ASSERT pg_temp.reserve(1)->>'reason' = 'execution_busy', 'ANY active list in site blocks reservation';
  ASSERT (pg_temp.reserve(2)->>'acquired')::boolean;
  ASSERT (pg_temp.reserve(3)->>'acquired')::boolean;
  ASSERT pg_temp.reserve(4)->>'reason' = 'global_capacity', 'Legacy executions also consume global capacity';
END $$;
ROLLBACK;

-- case: begin identity, immutable baselines, compact payload and manual claim fencing
BEGIN;
DO $$
DECLARE response jsonb; retry jsonb; d public.icp_dispatch_runs; owner uuid := pg_temp.test_uuid(1001);
BEGIN
  UPDATE public.icp_mining SET processed_targets = 20, found_matches = 7, current_page = 2,
    errors = '[{"secret":"history"}]', icp_criteria = '{"secret":true}', future_audit_column = '{"secret":true}'
    WHERE id = pg_temp.test_uuid(101);
  response := pg_temp.reserve(1);
  SELECT * INTO d FROM public.icp_dispatch_runs WHERE id = (response->'reservation'->>'id')::uuid;
  ASSERT public.claim_icp_mining_execution(d.icp_mining_id, d.site_id, owner, d.workflow_id)->>'reason' = 'busy', 'Must begin/bind first';
  BEGIN PERFORM public.begin_icp_dispatch(d.id, owner, 'wrong'); RAISE EXCEPTION 'wrong workflow accepted';
    EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM = 'Dispatch workflow mismatch'; END;
  response := public.begin_icp_dispatch(d.id, owner, d.workflow_id);
  ASSERT (response->>'acquired')::boolean;
  ASSERT NOT (response->'icp' ?| ARRAY['errors','last_error','icp_criteria','future_audit_column','execution_run_id']);
  ASSERT response->'icp' ?& ARRAY['role_query_id','current_page_snapshot','checkpoint_version','current_page_offset'];
  ASSERT (response->'reservation'->>'baseline_processed')::integer = 20 AND (response->'reservation'->>'baseline_found')::integer = 7;
  ASSERT public.begin_icp_dispatch(d.id, owner, d.workflow_id) = response;
  BEGIN PERFORM public.begin_icp_dispatch(d.id, pg_temp.test_uuid(999), d.workflow_id); RAISE EXCEPTION 'wrong run accepted';
    EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM = 'Dispatch run mismatch'; END;
  ASSERT public.claim_icp_mining_execution(d.icp_mining_id, d.site_id, pg_temp.test_uuid(999), 'manual', owner)->>'reason' = 'busy', 'No terminal takeover bypass';
  ASSERT public.claim_icp_mining_execution(pg_temp.test_uuid(201), d.site_id, owner, d.workflow_id)->>'reason' = 'busy', 'Same owner cannot claim different list';
  ASSERT (public.claim_icp_mining_execution(pg_temp.test_uuid(102), pg_temp.test_uuid(2), pg_temp.test_uuid(1002), 'unrelated')->>'acquired')::boolean,
    'Other site manual claims retain their original behavior';
  PERFORM public.checkpoint_icp_mining_execution(d.icp_mining_id, d.site_id, owner, 1, 23, 8, 2, 3, 1000, 'pending', NULL);
  retry := public.begin_icp_dispatch(d.id, owner, d.workflow_id);
  ASSERT (retry->>'acquired')::boolean AND (retry->'icp'->>'processed_targets')::integer = 23;
  ASSERT retry->'reservation'->'baseline_processed' = response->'reservation'->'baseline_processed', 'Retry never resets baseline after progress/release';
  ASSERT public.claim_icp_mining_execution(d.icp_mining_id, d.site_id, pg_temp.test_uuid(999), 'manual', owner)->>'reason' = 'busy', 'Release-to-settlement gap stays fenced';
  ASSERT (public.finish_icp_dispatch(d.id, owner)->>'success')::boolean;
END $$;
ROLLBACK;

-- case: checkpoint bounds and monotonic settlement with idempotent same owner
BEGIN;
DO $$
DECLARE response jsonb; d public.icp_dispatch_runs; owner uuid := pg_temp.test_uuid(1001); settled jsonb; next_time timestamptz;
BEGIN
  UPDATE public.settings SET activities = '{"icp_lead_generation":{"target_leads":2}}' WHERE site_id = pg_temp.test_uuid(1);
  response := pg_temp.reserve(1);
  SELECT * INTO d FROM public.icp_dispatch_runs WHERE id = (response->'reservation'->>'id')::uuid;
  BEGIN PERFORM public.finish_icp_dispatch(d.id, owner); RAISE EXCEPTION 'unbound finish accepted';
    EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM = 'Dispatch run mismatch'; END;
  PERFORM public.begin_icp_dispatch(d.id, owner, d.workflow_id);
  BEGIN PERFORM public.finish_icp_dispatch(d.id, owner); RAISE EXCEPTION 'active finish accepted';
    EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM = 'Dispatch execution must checkpoint release before settlement'; END;
  BEGIN PERFORM public.checkpoint_icp_mining_execution(d.icp_mining_id, d.site_id, owner, 1, 11, 1, 1, 1, 1000, 'pending', NULL);
    RAISE EXCEPTION 'candidate overspend'; EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM = 'Dispatch checkpoint exceeds reservation'; END;
  BEGIN PERFORM public.checkpoint_icp_mining_execution(d.icp_mining_id, d.site_id, owner, 1, 4, 3, 0, 4, 1000, 'pending', NULL);
    RAISE EXCEPTION 'match overspend'; EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM = 'Dispatch checkpoint exceeds reservation'; END;
  ASSERT (SELECT processed_targets = 0 AND checkpoint_version = 0 AND execution_active FROM public.icp_mining WHERE id = d.icp_mining_id);
  PERFORM public.checkpoint_icp_mining_execution(d.icp_mining_id, d.site_id, owner, 1, 4, 1, 0, 4, 1000, 'running', NULL);
  BEGIN PERFORM public.checkpoint_icp_mining_execution(d.icp_mining_id, d.site_id, owner, 2, 3, 1, 0, 4, 1000, 'pending', NULL);
    RAISE EXCEPTION 'counter regression'; EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM = 'Invalid mining checkpoint'; END;
  PERFORM public.checkpoint_icp_mining_execution(d.icp_mining_id, d.site_id, owner, 2, 4, 1, 0, 4, 1000, 'pending', NULL);
  BEGIN PERFORM public.finish_icp_dispatch(d.id, pg_temp.test_uuid(999)); RAISE EXCEPTION 'foreign finish';
    EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM = 'Dispatch run mismatch'; END;
  BEGIN PERFORM public.finish_icp_dispatch(d.id, owner, '{}'); RAISE EXCEPTION 'malformed errors accepted';
    EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM = 'Dispatch errors must be an array'; END;
  -- Fault injection: an invalid persisted delta is rejected independently by finish.
  UPDATE public.icp_mining SET processed_targets = 11 WHERE id = d.icp_mining_id;
  BEGIN PERFORM public.finish_icp_dispatch(d.id, owner); RAISE EXCEPTION 'persisted overspend settled';
    EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM = 'Dispatch settlement exceeds reservation'; END;
  UPDATE public.icp_mining SET processed_targets = NULL WHERE id = d.icp_mining_id;
  BEGIN PERFORM public.finish_icp_dispatch(d.id, owner); RAISE EXCEPTION 'null counter settled';
    EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM = 'Dispatch settlement exceeds reservation'; END;
  UPDATE public.icp_mining SET processed_targets = 4 WHERE id = d.icp_mining_id;
  ASSERT (SELECT state = 'running' FROM public.icp_dispatch_runs WHERE id = d.id), 'Exceptions preserve active reservations';
  ASSERT (public.finish_icp_dispatch(d.id, owner, '[]', 0)->>'success')::boolean;
  SELECT to_jsonb(x) INTO settled FROM public.icp_dispatch_runs x WHERE id = d.id;
  ASSERT settled->>'state' = 'settled' AND (settled->>'processed')::integer = 4 AND (settled->>'found')::integer = 1;
  ASSERT (settled->>'reserved_candidates')::integer = 10, 'All candidate attempts consumed, no refund';
  SELECT next_eligible_at INTO next_time FROM public.icp_dispatch_site_state WHERE site_id = d.site_id;
  ASSERT next_time >= (settled->>'updated_at')::timestamptz + interval '5 minutes';
  response := public.finish_icp_dispatch(d.id, owner, '["late error"]', 21600);
  ASSERT (response->>'success')::boolean AND (response->>'next_eligible_at')::timestamptz = next_time;
  ASSERT (SELECT to_jsonb(x) = settled FROM public.icp_dispatch_runs x WHERE id = d.id), 'Settled retry does not change counters/timestamps/error';
  ASSERT (SELECT next_eligible_at = next_time AND consecutive_failures = 0 FROM public.icp_dispatch_site_state WHERE site_id = d.site_id);
  BEGIN PERFORM public.finish_icp_dispatch(d.id, pg_temp.test_uuid(999)); RAISE EXCEPTION 'foreign settled retry';
    EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM = 'Dispatch run mismatch'; END;
  ASSERT pg_temp.reserve(1, '-next')->>'reason' = 'site_cooldown';
  UPDATE public.icp_dispatch_site_state SET next_eligible_at = now() - interval '1 second';
  UPDATE public.icp_dispatch_list_state SET next_eligible_at = now() - interval '1 second';
  response := pg_temp.reserve(1, '-next');
  ASSERT (response->'reservation'->>'reserved_candidates')::integer = 10;
  ASSERT (response->'reservation'->>'reserved_matches')::integer = 1, 'Settled found, not reserved matches, debits next match quota';
END $$;
ROLLBACK;

-- case: fixed UTC budget across midnight and no lease or age based release
BEGIN;
SET LOCAL timezone = 'Pacific/Kiritimati';
DO $$
DECLARE response jsonb; d public.icp_dispatch_runs; owner uuid := pg_temp.test_uuid(1001); prior_day date;
BEGIN
  response := pg_temp.reserve(1);
  SELECT * INTO d FROM public.icp_dispatch_runs WHERE id = (response->'reservation'->>'id')::uuid;
  ASSERT d.budget_day = (clock_timestamp() AT TIME ZONE 'UTC')::date, 'Independent of session timezone';
  prior_day := d.budget_day - 1;
  -- Model a reservation surviving midnight, irrespective of wall-clock test date.
  UPDATE public.icp_dispatch_runs SET budget_day = prior_day, created_at = now() - interval '100 days', updated_at = now() - interval '100 days' WHERE id = d.id;
  ASSERT pg_temp.reserve(1, '-next')->>'reason' = 'site_busy', 'Old active reservations keep their site slot across days';
  PERFORM public.begin_icp_dispatch(d.id, owner, d.workflow_id);
  PERFORM public.checkpoint_icp_mining_execution(d.icp_mining_id, d.site_id, owner, 1, 3, 2, 0, 3, 1000, 'pending', NULL);
  PERFORM public.finish_icp_dispatch(d.id, owner);
  ASSERT (SELECT x.budget_day = prior_day AND x.found = 2 FROM public.icp_dispatch_runs x WHERE x.id = d.id), 'After-midnight settlement debits reservation day';
  UPDATE public.icp_dispatch_site_state SET next_eligible_at = now() - interval '1 second';
  UPDATE public.icp_dispatch_list_state SET next_eligible_at = now() - interval '1 second';
  UPDATE public.settings SET activities = '{"icp_lead_generation":{"target_leads":2}}' WHERE site_id = d.site_id;
  response := pg_temp.reserve(1, '-next');
  ASSERT (response->'reservation'->>'reserved_matches')::integer = 2, 'Prior-day hits do not debit today';
  ASSERT (response->'reservation'->>'budget_day')::date = (clock_timestamp() AT TIME ZONE 'UTC')::date;
  UPDATE public.icp_dispatch_runs SET state = 'blocked', created_at = now() - interval '100 days', updated_at = now() - interval '100 days'
    WHERE id = (response->'reservation'->>'id')::uuid;
  ASSERT pg_temp.reserve(1, '-third')->>'reason' = 'site_busy', 'Blocked reservations never expire';
  ASSERT public.claim_icp_mining_execution(d.icp_mining_id, d.site_id, pg_temp.test_uuid(999), 'manual', owner)->>'reason' = 'busy';
END $$;
ROLLBACK;

-- case: daily 3000 candidate ceiling, partial final slice and lower live limits
BEGIN;
DO $$
DECLARE response jsonb; d public.icp_dispatch_runs; owner uuid := pg_temp.test_uuid(1001);
BEGIN
  UPDATE public.settings SET activities = '{"icp_lead_generation":{"target_leads":3000}}' WHERE site_id = pg_temp.test_uuid(1);
  -- Seed already-settled attempts only (no production backfill). 2997 attempted
  -- candidates, zero matches. Each row is <=10 and counts even if processed=0.
  INSERT INTO public.icp_dispatch_runs (site_id, icp_mining_id, dispatch_key, workflow_id, run_id, budget_day,
    state, target_limit, candidate_limit, research_enabled, baseline_processed, baseline_found,
    reserved_candidates, reserved_matches)
    SELECT pg_temp.test_uuid(1), pg_temp.test_uuid(201), 'seed-' || n, 'seed-' || n, gen_random_uuid(),
      (clock_timestamp() AT TIME ZONE 'UTC')::date, 'settled', 3000, 3000, false, 0, 0,
      CASE WHEN n = 300 THEN 7 ELSE 10 END, CASE WHEN n = 300 THEN 7 ELSE 10 END
    FROM generate_series(1, 300) n;
  response := pg_temp.reserve(1);
  SELECT * INTO d FROM public.icp_dispatch_runs WHERE id = (response->'reservation'->>'id')::uuid;
  ASSERT d.reserved_candidates = 3 AND d.candidate_limit = 3000 AND d.reserved_matches = 3;
  -- Saved settings may be reduced after reserve; the running slice keeps snapshot.
  UPDATE public.settings SET activities = '{"icp_lead_generation":{"target_leads":1}}' WHERE site_id = pg_temp.test_uuid(1);
  response := public.begin_icp_dispatch(d.id, owner, d.workflow_id);
  ASSERT (response->'reservation'->>'target_limit')::integer = 3000;
  PERFORM public.checkpoint_icp_mining_execution(d.icp_mining_id, d.site_id, owner, 1, 0, 0, 0, 0, 1000, 'pending', NULL);
  PERFORM public.finish_icp_dispatch(d.id, owner);
  UPDATE public.icp_dispatch_site_state SET next_eligible_at = now() - interval '1 second';
  UPDATE public.icp_dispatch_list_state SET next_eligible_at = now() - interval '1 second';
  ASSERT pg_temp.reserve(1, '-next')->>'reason' = 'candidate_quota', 'Lower limits stop new work only';
  UPDATE public.settings SET activities = '{"icp_lead_generation":{"target_leads":3000}}' WHERE site_id = pg_temp.test_uuid(1);
  ASSERT pg_temp.reserve(1, '-next')->>'reason' = 'candidate_quota', '3000 attempted candidates are not 3000 pages';
  ASSERT (SELECT sum(reserved_candidates) = 3000 AND sum(processed) = 0 FROM public.icp_dispatch_runs WHERE site_id = pg_temp.test_uuid(1));
  -- Lower config limit takes precedence over target*10, and never returns zero.
  UPDATE public.icp_dispatch_config SET daily_candidate_limit = 1;
  response := pg_temp.reserve(2);
  ASSERT (response->'reservation'->>'candidate_limit')::integer = 1 AND (response->'reservation'->>'reserved_candidates')::integer = 1;
END $$;
ROLLBACK;

-- case: match quota aggregates all lists and refreshes DB target
BEGIN;
DO $$
DECLARE response jsonb; d public.icp_dispatch_runs; owner uuid := pg_temp.test_uuid(1001);
BEGIN
  UPDATE public.settings SET activities = '{"icp_lead_generation":{"target_leads":10}}' WHERE site_id = pg_temp.test_uuid(1);
  response := pg_temp.reserve(1);
  SELECT * INTO d FROM public.icp_dispatch_runs WHERE id = (response->'reservation'->>'id')::uuid;
  PERFORM public.begin_icp_dispatch(d.id, owner, d.workflow_id);
  PERFORM public.checkpoint_icp_mining_execution(d.icp_mining_id, d.site_id, owner, 1, 10, 10, 1, 0, 1000, 'pending', NULL);
  PERFORM public.finish_icp_dispatch(d.id, owner);
  UPDATE public.icp_dispatch_site_state SET next_eligible_at = now() - interval '1 second';
  UPDATE public.icp_dispatch_list_state SET next_eligible_at = now() - interval '1 second';
  ASSERT public.reserve_icp_dispatch(d.site_id, pg_temp.test_uuid(201), 'other', 'other')->>'reason' = 'match_quota', 'Quota is site-wide, not per list';
  UPDATE public.settings SET activities = '{"icp_lead_generation":{"target_leads":11}}' WHERE site_id = d.site_id;
  response := public.reserve_icp_dispatch(d.site_id, pg_temp.test_uuid(201), 'other', 'other');
  ASSERT (response->'reservation'->>'reserved_matches')::integer = 1;
  ASSERT (response->'reservation'->>'target_limit')::integer = 11;
  ASSERT (response->'reservation'->>'reserved_candidates')::integer = 10;
END $$;
ROLLBACK;

-- case: failed begin is blocked with no baseline, release or TTL
BEGIN;
DO $$
DECLARE response jsonb; d public.icp_dispatch_runs; owner uuid := pg_temp.test_uuid(1001);
BEGIN
  response := pg_temp.reserve(1);
  SELECT * INTO d FROM public.icp_dispatch_runs WHERE id = (response->'reservation'->>'id')::uuid;
  UPDATE public.icp_mining SET status = 'completed' WHERE id = d.icp_mining_id;
  ASSERT public.begin_icp_dispatch(d.id, owner, d.workflow_id)->>'reason' = 'busy';
  ASSERT (SELECT state = 'blocked' AND run_id = owner AND baseline_processed IS NULL AND error IS NOT NULL FROM public.icp_dispatch_runs WHERE id = d.id);
  ASSERT public.begin_icp_dispatch(d.id, owner, d.workflow_id)->>'reason' = 'blocked';
  BEGIN PERFORM public.finish_icp_dispatch(d.id, owner); RAISE EXCEPTION 'blocked reservation released';
    EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM = 'Dispatch must be running to settle'; END;
  UPDATE public.icp_dispatch_runs SET updated_at = now() - interval '100 years', budget_day = current_date - 36500 WHERE id = d.id;
  ASSERT public.reserve_icp_dispatch(d.site_id, pg_temp.test_uuid(201), 'next', 'next')->>'reason' = 'site_busy';
  ASSERT public.claim_icp_mining_execution(pg_temp.test_uuid(201), d.site_id, owner, d.workflow_id)->>'reason' = 'busy';
  UPDATE public.icp_dispatch_config SET max_concurrency = 1;
  ASSERT pg_temp.reserve(2)->>'reason' = 'global_capacity', 'Blocked reservations consume global capacity forever until reviewed';
END $$;
ROLLBACK;

-- case: minimum cooldown, exponential failures and six-hour clamp
BEGIN;
DO $$
DECLARE response jsonb; d public.icp_dispatch_runs; owner uuid; n integer; expected integer;
BEGIN
  FOR n IN 1..9 LOOP
    response := pg_temp.reserve(1, '-' || n);
    SELECT * INTO d FROM public.icp_dispatch_runs WHERE id = (response->'reservation'->>'id')::uuid;
    owner := pg_temp.test_uuid(1000 + n);
    PERFORM public.begin_icp_dispatch(d.id, owner, d.workflow_id);
    PERFORM public.checkpoint_icp_mining_execution(d.icp_mining_id, d.site_id, owner, 1, 0, 0, 0, 0, 1000, 'pending', NULL);
    response := public.finish_icp_dispatch(d.id, owner, '["temporary provider failure"]', -1);
    expected := least(21600, 300 * (2 ^ (n - 1))::integer);
    ASSERT (SELECT consecutive_failures = n AND next_eligible_at = x.updated_at + make_interval(secs => expected)
      FROM public.icp_dispatch_site_state s CROSS JOIN public.icp_dispatch_runs x WHERE s.site_id = d.site_id AND x.id = d.id);
    ASSERT (SELECT failure_count = n AND next_eligible_at = x.updated_at + make_interval(secs => expected)
      FROM public.icp_dispatch_list_state s CROSS JOIN public.icp_dispatch_runs x WHERE s.icp_mining_id = d.icp_mining_id AND x.id = d.id);
    ASSERT (SELECT (response->>'next_eligible_at')::timestamptz = next_eligible_at FROM public.icp_dispatch_site_state WHERE site_id = d.site_id);
    UPDATE public.icp_dispatch_site_state SET next_eligible_at = now() - interval '1 second';
    UPDATE public.icp_dispatch_list_state SET next_eligible_at = now() - interval '1 second';
  END LOOP;
  response := pg_temp.reserve(1, '-reused-run');
  SELECT * INTO d FROM public.icp_dispatch_runs WHERE id = (response->'reservation'->>'id')::uuid;
  PERFORM public.begin_icp_dispatch(d.id, owner, d.workflow_id);
  -- Same run ID with a different workflow cannot reuse released ICP execution;
  -- denied begin stays blocked, rather than resetting the prior run's baseline.
  ASSERT (SELECT state = 'blocked' FROM public.icp_dispatch_runs WHERE id = d.id);
END $$;
ROLLBACK;

-- case: non-dispatch legacy claims retain compare-and-swap and checkpoint protocol
BEGIN;
DO $$
DECLARE mining uuid := pg_temp.test_uuid(101); site uuid := pg_temp.test_uuid(1);
  run1 uuid := pg_temp.test_uuid(1001); run2 uuid := pg_temp.test_uuid(1002); response jsonb;
BEGIN
  ASSERT (public.claim_icp_mining_execution(mining, site, run1, 'legacy-1')->>'acquired')::boolean;
  ASSERT public.claim_icp_mining_execution(mining, site, run2, 'legacy-2')->>'reason' = 'busy';
  ASSERT public.claim_icp_mining_execution(mining, site, run2, 'legacy-2', run2)->>'reason' = 'busy';
  ASSERT (public.claim_icp_mining_execution(mining, site, run2, 'legacy-2', run1)->>'acquired')::boolean;
  BEGIN PERFORM public.checkpoint_icp_mining_execution(mining, site, run1, 1, 1, 0, 0, 1, 1000, 'running', NULL);
    RAISE EXCEPTION 'stale legacy checkpoint'; EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM = 'Mining execution no longer owns request'; END;
  response := public.checkpoint_icp_mining_execution(mining, site, run2, 1, 20, 12, 2, 0, 1000, 'running', NULL);
  ASSERT (response->>'applied')::boolean, 'Legacy checkpoint is NOT capped to a dispatcher slice';
  response := public.checkpoint_icp_mining_execution(mining, site, run2, 1, 20, 12, 2, 0, 1000, 'running', NULL);
  ASSERT NOT (response->>'applied')::boolean;
  PERFORM public.checkpoint_icp_mining_execution(mining, site, run2, 2, 20, 12, 2, 0, 1000, 'completed', NULL);
  ASSERT (SELECT status = 'completed' AND NOT execution_active FROM public.icp_mining WHERE id = mining);
  PERFORM pg_catalog.set_config('app.icp_execution_owner', '', true);
  BEGIN UPDATE public.icp_mining SET processed_targets = 99 WHERE id = mining; RAISE EXCEPTION 'legacy direct mutation';
    EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM = 'Mining progress must use the execution checkpoint protocol'; END;
END $$;
ROLLBACK;

-- case: explicit deterministic cooldown and success clears failure counters
BEGIN;
DO $$
DECLARE response jsonb; d public.icp_dispatch_runs; owner uuid := pg_temp.test_uuid(1001);
BEGIN
  response := pg_temp.reserve(1);
  SELECT * INTO d FROM public.icp_dispatch_runs WHERE id = (response->'reservation'->>'id')::uuid;
  PERFORM public.begin_icp_dispatch(d.id, owner, d.workflow_id);
  PERFORM public.checkpoint_icp_mining_execution(d.icp_mining_id, d.site_id, owner, 1, 0, 0, 0, 0, 1000, 'pending', NULL);
  PERFORM public.finish_icp_dispatch(d.id, owner, '[{"code":"insufficient_credits"}]', 999999);
  ASSERT (SELECT next_eligible_at = x.updated_at + interval '6 hours' AND consecutive_failures = 1
    FROM public.icp_dispatch_site_state s CROSS JOIN public.icp_dispatch_runs x WHERE s.site_id = d.site_id AND x.id = d.id);
  UPDATE public.icp_dispatch_site_state SET next_eligible_at = now() - interval '1 second';
  UPDATE public.icp_dispatch_list_state SET next_eligible_at = now() - interval '1 second';
  response := pg_temp.reserve(1, '-success');
  SELECT * INTO d FROM public.icp_dispatch_runs WHERE id = (response->'reservation'->>'id')::uuid;
  owner := pg_temp.test_uuid(1002);
  PERFORM public.begin_icp_dispatch(d.id, owner, d.workflow_id);
  PERFORM public.checkpoint_icp_mining_execution(d.icp_mining_id, d.site_id, owner, 1, 0, 0, 0, 0, 1000, 'pending', NULL);
  PERFORM public.finish_icp_dispatch(d.id, owner);
  ASSERT (SELECT next_eligible_at = x.updated_at + interval '5 minutes' AND consecutive_failures = 0
    FROM public.icp_dispatch_site_state s CROSS JOIN public.icp_dispatch_runs x WHERE s.site_id = d.site_id AND x.id = d.id);
  ASSERT (SELECT failure_count = 0 FROM public.icp_dispatch_list_state WHERE icp_mining_id = d.icp_mining_id);
END $$;
ROLLBACK;

-- case: service-only ACL/RLS, operator config updates and common lock ordering
BEGIN;
DO $$
DECLARE tab text; proc regprocedure; body text; role_name text;
BEGIN
  FOREACH tab IN ARRAY ARRAY['icp_dispatch_config','icp_dispatch_runs','icp_dispatch_site_state','icp_dispatch_list_state'] LOOP
    ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || tab)::regclass);
    ASSERT has_table_privilege('service_role', 'public.' || tab, 'SELECT');
    ASSERT NOT has_table_privilege('service_role', 'public.' || tab, 'INSERT,DELETE,TRUNCATE');
    IF tab <> 'icp_dispatch_config' THEN ASSERT NOT has_table_privilege('service_role', 'public.' || tab, 'UPDATE'); END IF;
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
      ASSERT NOT has_table_privilege(role_name, 'public.' || tab, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');
    END LOOP;
  END LOOP;
  ASSERT has_column_privilege('service_role', 'public.icp_dispatch_config', 'enabled', 'UPDATE');
  ASSERT NOT has_column_privilege('service_role', 'public.icp_dispatch_config', 'id', 'UPDATE');
  FOR proc IN SELECT oid::regprocedure FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN (
    'reserve_icp_dispatch', 'begin_icp_dispatch', 'finish_icp_dispatch', 'claim_icp_mining_execution', 'checkpoint_icp_mining_execution') LOOP
    ASSERT has_function_privilege('service_role', proc, 'EXECUTE');
    ASSERT NOT has_function_privilege('anon', proc, 'EXECUTE');
    ASSERT NOT has_function_privilege('authenticated', proc, 'EXECUTE');
    ASSERT (SELECT prosecdef AND proconfig = ARRAY['search_path=""'] FROM pg_proc WHERE oid = proc);
    body := pg_get_functiondef(proc);
    ASSERT strpos(body, 'pg_advisory_xact_lock(734210, 1)') > 0;
    ASSERT strpos(body, 'pg_advisory_xact_lock(734210, 1)') < strpos(body, 'FOR UPDATE'), 'Global lock must precede row locks';
  END LOOP;
END $$;
SET LOCAL ROLE service_role;
UPDATE public.icp_dispatch_config SET enabled = false, slice_candidates = 2;
DO $$ BEGIN
  ASSERT (SELECT NOT enabled AND slice_candidates = 2 FROM public.icp_dispatch_config);
  BEGIN DELETE FROM public.icp_dispatch_config; RAISE EXCEPTION 'service deleted singleton';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN UPDATE public.icp_dispatch_runs SET state = 'settled'; RAISE EXCEPTION 'service direct write';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN UPDATE public.icp_dispatch_site_state SET consecutive_failures = 0; RAISE EXCEPTION 'service reset fairness';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
UPDATE public.icp_dispatch_config SET enabled = true;
DO $$ BEGIN
  ASSERT (public.reserve_icp_dispatch('00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000101', 'service', 'service')->>'acquired')::boolean;
  ASSERT (SELECT reserved_candidates = 2 FROM public.icp_dispatch_runs WHERE dispatch_key = 'service');
END $$;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN PERFORM 1 FROM public.icp_dispatch_runs; RAISE EXCEPTION 'tenant read reservations';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.reserve_icp_dispatch(NULL, NULL, NULL, NULL); RAISE EXCEPTION 'tenant called dispatcher';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;