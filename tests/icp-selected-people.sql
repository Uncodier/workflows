DO $$
DECLARE site uuid := pg_temp.test_uuid(1); list uuid := pg_temp.test_uuid(101);
  actor uuid := pg_temp.test_uuid(901); owner uuid := pg_temp.test_uuid(902); run uuid := pg_temp.test_uuid(903);
  lead uuid := pg_temp.test_uuid(904); member bigint; second_member bigint; reservation uuid; result jsonb;
BEGIN
  UPDATE public.icp_dispatch_config SET enabled = true;
  UPDATE public.sites SET user_id = owner WHERE id = site;
  INSERT INTO auth.users VALUES (actor), (owner);
  INSERT INTO public.site_members(id,site_id,user_id,status,licensed) VALUES (actor, site, actor, 'active', true);
  INSERT INTO public.persons(id, external_person_id) VALUES (pg_temp.test_uuid(950),12345);
  INSERT INTO public.leads(id,site_id,user_id,person_id) VALUES (lead, site, actor,pg_temp.test_uuid(950));
  UPDATE public.icp_mining SET total_targets = 20, processed_targets = 20, current_page = 2,
    current_page_offset = 4, status = 'completed', user_id = actor, icp_criteria = '{"source":"selected_people"}' WHERE id = list;
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', actor::text, true);
  PERFORM pg_catalog.set_config('role', 'authenticated', true);
  result := public.finder_append_selected_people(list,site,ARRAY['12345'],pg_temp.test_uuid(905));
  IF result->>'added_count' <> '1' OR result->'list'->>'status' <> 'pending' OR result->'list'->>'total_targets' <> '21' THEN
    RAISE EXCEPTION 'actual API append did not admit selected membership: %',result;
  END IF;
  result := public.finder_append_selected_people(list,site,ARRAY['12345'],pg_temp.test_uuid(905));
  IF result->>'added_count' <> '1' THEN RAISE EXCEPTION 'actual append receipt replay failed'; END IF;
  PERFORM pg_catalog.set_config('role', 'none', true);
  SELECT ordinal INTO member FROM public.icp_mining_people WHERE icp_mining_id=list AND person_id='12345';
  result := public.reserve_icp_dispatch(site,list,'selected-test','selected-workflow');
  IF NOT (result->>'acquired')::boolean OR (result->'reservation'->>'reserved_candidates')::integer <> 1 THEN RAISE EXCEPTION 'exhausted selected queue not reserved correctly: %',result; END IF;
  reservation := (result->'reservation'->>'id')::uuid;
  result := public.begin_icp_dispatch(reservation,run,'selected-workflow');
  IF result->'icp'->>'selected_processed_targets' IS DISTINCT FROM '0' THEN RAISE EXCEPTION 'claim projection missing selected progress'; END IF;
  result := public.read_selected_icp_people(list,site,run);
  IF result->'members'->0->>'created_by' <> actor::text OR NOT (result->>'selectedOnly')::boolean THEN RAISE EXCEPTION 'creator/source changed'; END IF;
  result := public.acknowledge_selected_icp_person(list,site,run,member,1,lead,'matched');
  IF result->>'processed' <> '21' OR result->>'found' <> '1' THEN RAISE EXCEPTION 'ACK counters incorrect'; END IF;
  PERFORM public.acknowledge_selected_icp_person(list,site,run,member,1,lead,'matched');
  IF (SELECT selected_processed_targets FROM public.icp_mining WHERE id=list) <> 1 THEN RAISE EXCEPTION 'lost ACK counted twice'; END IF;
  IF EXISTS(SELECT 1 FROM public.icp_mining WHERE id=list AND (current_page<>2 OR current_page_offset<>4)) THEN RAISE EXCEPTION 'search cursor changed'; END IF;
  BEGIN
    PERFORM public.acknowledge_selected_icp_person(list,site,pg_temp.test_uuid(999),member,1,lead,'matched');
    RAISE EXCEPTION 'stale owner accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM='stale owner accepted' THEN RAISE; END IF; END;
  -- Append racing finalization is visible under the parent lock; remains pending.
  PERFORM pg_catalog.set_config('role', 'authenticated', true);
  result := public.finder_append_selected_people(list,site,ARRAY['67890'],pg_temp.test_uuid(906));
  PERFORM pg_catalog.set_config('role', 'none', true);
  IF result->'list'->>'total_targets' <> '22' THEN RAISE EXCEPTION 'active-run API append lost selected total'; END IF;
  SELECT ordinal INTO second_member FROM public.icp_mining_people WHERE icp_mining_id=list AND person_id='67890';
  -- The same actual checkpoint guard rejects ACK beyond the reserved candidate.
  BEGIN
    PERFORM public.acknowledge_selected_icp_person(list,site,run,second_member,2,NULL,'no_match');
    RAISE EXCEPTION 'over-budget ACK accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%exceeds reservation%' THEN RAISE; END IF; END;
  PERFORM public.checkpoint_icp_mining_execution(list,site,run,2,21,1,2,4,NULL,'pending',NULL,'[]');
  PERFORM public.finalize_selected_icp_slice(list,site,run,false);
  IF (SELECT status FROM public.icp_mining WHERE id=list) <> 'pending' THEN RAISE EXCEPTION 'append lost during finalization'; END IF;
  PERFORM public.finish_icp_dispatch(reservation,run,'[]',300);
  IF (SELECT d.found FROM public.icp_dispatch_runs d WHERE d.id=reservation)<>1 THEN RAISE EXCEPTION 'selected lead not charged to shared budget'; END IF;
  IF has_function_privilege('authenticated','public.read_selected_icp_people(uuid,uuid,uuid)','EXECUTE') THEN RAISE EXCEPTION 'client can read worker RPC'; END IF;
  -- A later owned manual execution consumes the append and completes exactly once.
  result := public.claim_icp_mining_execution(list,site,pg_temp.test_uuid(907),'selected-manual');
  IF NOT (result->>'acquired')::boolean THEN RAISE EXCEPTION 'manual claim failed'; END IF;
  run := pg_temp.test_uuid(907);
  result := public.acknowledge_selected_icp_person(list,site,run,second_member,1,NULL,'no_match');
  PERFORM public.checkpoint_icp_mining_execution(list,site,run,2,22,1,2,4,NULL,'pending',NULL,'[]');
  PERFORM public.finalize_selected_icp_slice(list,site,run,false);
  IF (SELECT status FROM public.icp_mining WHERE id=list)<>'completed' THEN RAISE EXCEPTION 'drained selected list did not complete'; END IF;
  PERFORM pg_catalog.set_config('role','authenticated',true);
  result := public.finder_append_selected_people(list,site,ARRAY['third-person'],pg_temp.test_uuid(908));
  PERFORM pg_catalog.set_config('role','none',true);
  IF result->'list'->>'status'<>'pending' OR result->'list'->>'total_targets'<>'23' THEN RAISE EXCEPTION 'completed-list append did not reopen'; END IF;
  -- A new execution validates current license instead of trusting attribution alone.
  PERFORM pg_catalog.set_config('app.icp_execution_owner',run::text,true);
  UPDATE public.icp_mining SET execution_active=true WHERE id=list;
  UPDATE public.site_members SET licensed=false WHERE id=actor;
  BEGIN
    PERFORM public.read_selected_icp_people(list,site,run); RAISE EXCEPTION 'revoked license accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM='revoked license accepted' THEN RAISE; END IF; END;
END $$;