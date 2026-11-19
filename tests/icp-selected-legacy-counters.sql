-- Isolated incident fixture. All leads, memberships, reservations and cooldowns
-- are local to PGlite; never replay a production run or reset its counters.
DO $$
DECLARE
  site uuid := pg_temp.test_uuid(2); list uuid := pg_temp.test_uuid(102);
  actor uuid := pg_temp.test_uuid(1001); lead uuid := pg_temp.test_uuid(1002);
  old_lead uuid := pg_temp.test_uuid(1003); total_done integer := 0;
  version integer; batch integer; dispatch uuid; run uuid; work text;
  receipt jsonb; state jsonb; m jsonb; row_state public.icp_mining;
BEGIN
  INSERT INTO auth.users VALUES (actor);
  UPDATE public.sites SET user_id = actor WHERE id = site;
  INSERT INTO public.persons(id,finder_selected_person_id) VALUES (pg_temp.test_uuid(1010),'member-1');
  INSERT INTO public.leads(id,site_id,user_id,person_id) VALUES (lead,site,actor,pg_temp.test_uuid(1010)), (old_lead,site,actor,NULL);
  UPDATE public.icp_mining SET user_id=actor, total_targets=129, processed_targets=130,
    found_matches=113, current_page=13, status='pending', icp_criteria='{"source":"selected_people"}' WHERE id=list;
  INSERT INTO public.icp_mining_people(icp_mining_id, site_id, person_id, created_by)
    SELECT list, site, 'member-' || i, actor FROM generate_series(1,129) i;

  FOR turn IN 1..13 LOOP
    work := 'fixture-selected-turn-' || turn;
    run := pg_temp.test_uuid(1100 + turn);
    receipt := public.reserve_icp_dispatch(site,list,work,work);
    batch := least(10, 129 - total_done);
    IF receipt->>'acquired' IS DISTINCT FROM 'true' OR (receipt->'reservation'->>'reserved_candidates')::int IS DISTINCT FROM batch THEN
      RAISE EXCEPTION 'Legacy counters or incorrect budget blocked turn %: %',turn,receipt; END IF;
    dispatch := (receipt->'reservation'->>'id')::uuid;
    receipt := public.begin_icp_dispatch(dispatch,run,work);
    version := (receipt->'icp'->>'checkpoint_version')::int;
    state := public.read_selected_icp_people(list,site,run);
    IF state->>'selectedOnly' IS DISTINCT FROM 'true' OR (state->>'pending')::int IS DISTINCT FROM 129-total_done
      OR jsonb_array_length(state->'members') IS DISTINCT FROM batch THEN RAISE EXCEPTION 'Wrong membership batch'; END IF;
    FOR m IN SELECT value FROM jsonb_array_elements(state->'members') LOOP
      total_done := total_done + 1;
      version := version + 1;
      receipt := public.acknowledge_selected_icp_person(list,site,run,(m->>'ordinal')::bigint,version,
        CASE WHEN total_done=1 THEN lead ELSE NULL END, CASE WHEN total_done=1 THEN 'matched' ELSE 'no_match' END);
      IF (receipt->>'processed')::int IS DISTINCT FROM 130+total_done THEN RAISE EXCEPTION 'Aggregate history changed'; END IF;
    END LOOP;
    PERFORM public.checkpoint_icp_mining_execution(list,site,run,version+1,130+total_done,114,13,0,NULL,'pending',NULL,'[]');
    PERFORM public.finalize_selected_icp_slice(list,site,run,false);
    PERFORM public.finish_icp_dispatch(dispatch,run,'[]',300);
    SELECT * INTO STRICT row_state FROM public.icp_mining WHERE id=list;
    IF row_state.status IS DISTINCT FROM (CASE WHEN total_done=129 THEN 'completed' ELSE 'pending' END)
      OR row_state.execution_active OR row_state.selected_processed_targets<>total_done OR row_state.total_targets<>129
      OR row_state.current_page<>13 OR row_state.found_matches<>114 THEN RAISE EXCEPTION 'Incorrect finalization on turn %',turn; END IF;
    -- Model the next eligible tick without a wall-clock delay in the fixture.
    UPDATE public.icp_dispatch_site_state SET next_eligible_at=now() WHERE site_id=site;
    UPDATE public.icp_dispatch_list_state SET next_eligible_at=now() WHERE icp_mining_id=list;
  END LOOP;
  IF (SELECT count(*) FROM public.icp_mining_people WHERE icp_mining_id=list AND processing_status='completed')<>129
    OR (SELECT count(*) FROM public.icp_mining_people WHERE icp_mining_id=list AND lead_id=lead)<>1
    OR EXISTS (SELECT 1 FROM public.icp_mining_people WHERE icp_mining_id=list AND lead_id=old_lead)
    OR (SELECT sum(processed) FROM public.icp_dispatch_runs WHERE icp_mining_id=list)<>129
    OR (SELECT sum(d.found) FROM public.icp_dispatch_runs d WHERE d.icp_mining_id=list)<>1 THEN
    RAISE EXCEPTION 'Membership or reservation ledger includes unrelated historical work'; END IF;
END $$;