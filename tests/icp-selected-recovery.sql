-- Independent site fixtures run the deployed SQL, not a simulated database API.
DO $$
DECLARE s uuid:=pg_temp.test_uuid(3); l uuid:=pg_temp.test_uuid(103); actor uuid:=pg_temp.test_uuid(3001);
  run uuid:=pg_temp.test_uuid(3002); a uuid:=pg_temp.test_uuid(3003); b uuid:=pg_temp.test_uuid(3004);
  wrong uuid:=pg_temp.test_uuid(3005); member bigint; lead uuid; d uuid; receipt jsonb; attempt integer; fault boolean;
  payload jsonb:=jsonb_build_object('name','Fixture','email','contact@example.invalid','metadata','{"finder":{"v":1},"keep":true}'::jsonb);
BEGIN
  INSERT INTO auth.users VALUES(actor); UPDATE public.sites SET user_id=actor WHERE id=s;
  INSERT INTO public.persons(id,external_person_id) VALUES(b,42);
  INSERT INTO public.persons(id,finder_selected_person_id) VALUES(a,'0042');
  INSERT INTO public.leads(id,site_id,user_id,person_id) VALUES(wrong,s,actor,b);
  UPDATE public.icp_mining SET user_id=actor,icp_criteria='{"source":"selected_people"}',total_targets=1 WHERE id=l;
  INSERT INTO public.icp_mining_people(site_id,icp_mining_id,person_id,created_by) VALUES(s,l,'0042',actor) RETURNING ordinal INTO member;
  payload:=payload||jsonb_build_object('user_id',actor);
  BEGIN
    PERFORM public.insert_selected_finder_lead(s,b,'0042',payload); RAISE EXCEPTION 'conflicting insert accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  lead:=(public.insert_selected_finder_lead(s,a,'0042',payload)->>'id')::uuid;
  BEGIN
    PERFORM public.insert_selected_finder_lead(s,a,'0042',payload); RAISE EXCEPTION 'duplicate lead created';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  BEGIN
    PERFORM public.update_selected_finder_lead(s,wrong,b,'0042',NULL,'{}',NULL); RAISE EXCEPTION 'conflicting update accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  PERFORM public.update_selected_finder_lead(s,lead,a,'0042',NULL,'{"v":2}','{"v":1}');
  BEGIN
    PERFORM public.update_selected_finder_lead(s,lead,a,'0042',NULL,'{"v":3}','{"v":1}'); RAISE EXCEPTION 'stale metadata overwritten';
  EXCEPTION WHEN serialization_failure THEN NULL; END;
  IF (SELECT metadata FROM public.leads WHERE id=lead) IS DISTINCT FROM '{"keep":true,"finder":{"v":2}}'::jsonb THEN RAISE EXCEPTION 'unrelated metadata lost'; END IF;
  receipt:=public.reserve_icp_dispatch(s,l,'reconcile','reconcile-slice'); d:=(receipt->'reservation'->>'id')::uuid;
  PERFORM public.begin_icp_dispatch(d,run,'reconcile-slice');
  BEGIN
    PERFORM public.acknowledge_selected_icp_person(l,s,run,member,1,wrong,'matched'); RAISE EXCEPTION 'old worker attached wrong person';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    PERFORM public.reconcile_selected_icp_person_ack(l,s,run,member,'0042',1,wrong,'matched',1,1); RAISE EXCEPTION 'recovery attached wrong person';
  EXCEPTION WHEN check_violation THEN NULL; END;
  -- Lost request: recover the exact pending member, using the paid result only.
  receipt:=public.reconcile_selected_icp_person_ack(l,s,run,member,'0042',1,lead,'matched',1,1);
  -- Lost response: recover the committed receipt without another counter increment.
  IF receipt IS DISTINCT FROM '{"version":1,"processed":1,"found":1}'::jsonb OR
    public.reconcile_selected_icp_person_ack(l,s,run,member,'0042',1,lead,'matched',1,1) IS DISTINCT FROM receipt THEN RAISE EXCEPTION 'incorrect ACK replay'; END IF;
  FOR attempt IN 1..6 LOOP
    fault:=false;
    BEGIN
      PERFORM public.reconcile_selected_icp_person_ack(l,s,CASE WHEN attempt=1 THEN actor ELSE run END,member,
        CASE WHEN attempt=2 THEN '42' ELSE '0042' END,CASE WHEN attempt=3 THEN 2 ELSE 1 END,
        CASE WHEN attempt=4 THEN wrong WHEN attempt=6 THEN NULL ELSE lead END,
        CASE WHEN attempt=6 THEN 'needs_review' ELSE 'matched' END,CASE WHEN attempt=5 THEN 2 ELSE 1 END,1);
    EXCEPTION WHEN OTHERS THEN fault:=true; END;
    IF NOT fault THEN RAISE EXCEPTION 'conflicting receipt accepted: %',attempt; END IF;
  END LOOP;
  BEGIN
    PERFORM public.settle_icp_dispatch_preflight(d,run,'reconcile-slice','["denied"]',300); RAISE EXCEPTION 'released paid work';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE '%not pristine%' THEN RAISE; END IF; END;
  PERFORM public.checkpoint_icp_mining_execution(l,s,run,2,1,1,0,0,NULL,'pending',NULL,'[]');
  PERFORM public.finalize_selected_icp_slice(l,s,run,false); PERFORM public.finish_icp_dispatch(d,run,'[]',300);
  IF NOT EXISTS(SELECT 1 FROM public.icp_dispatch_runs q WHERE q.id=d AND q.state='settled' AND q.processed=1 AND q.found=1 AND q.preflight_retry_seconds IS NULL)
    OR NOT EXISTS(SELECT 1 FROM public.icp_mining_people WHERE ordinal=member AND lead_id=lead AND processed_run_id=run) THEN RAISE EXCEPTION 'recovered ACK not durable'; END IF;
END $$;

DO $$
DECLARE site uuid:=pg_temp.test_uuid(4); list uuid:=pg_temp.test_uuid(104); other_list uuid:=pg_temp.test_uuid(401);
  actor uuid:=pg_temp.test_uuid(4001); run uuid:=pg_temp.test_uuid(4002); d uuid; result jsonb; msg jsonb:='["preflight denied"]';
BEGIN
  INSERT INTO auth.users VALUES(actor);
  UPDATE public.icp_mining SET user_id=actor,icp_criteria='{"source":"selected_people"}',total_targets=1,
    processed_targets=130,found_matches=113,current_page=13,current_page_offset=NULL WHERE id=list;
  INSERT INTO public.icp_mining(id,site_id,total_targets) VALUES(other_list,site,10);
  INSERT INTO public.icp_mining_people(icp_mining_id,site_id,person_id,created_by) VALUES(list,site,'provider:42',actor);
  d:=(public.reserve_icp_dispatch(site,list,'preflight','one')->'reservation'->>'id')::uuid;
  PERFORM public.begin_icp_dispatch(d,run,'one');
  BEGIN PERFORM public.read_selected_icp_people(list,site,run); RAISE EXCEPTION 'unlicensed member read';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE '%no active site license%' THEN RAISE; END IF; END;
  result:=public.settle_icp_dispatch_preflight(d,run,'one',msg,300);
  IF result->>'success' IS DISTINCT FROM 'true' OR NOT EXISTS(SELECT 1 FROM public.icp_mining WHERE id=list AND status='pending'
    AND NOT execution_active AND processed_targets=130 AND found_matches=113 AND current_page=13 AND current_page_offset IS NULL)
    OR NOT EXISTS(SELECT 1 FROM public.icp_dispatch_runs q WHERE q.id=d AND q.state='settled' AND q.processed=0 AND q.found=0 AND q.preflight_retry_seconds=300) THEN
    RAISE EXCEPTION 'preflight cleanup changed historical work or retained ownership'; END IF;
  IF public.settle_icp_dispatch_preflight(d,run,'one',msg,300) IS DISTINCT FROM result THEN RAISE EXCEPTION 'preflight replay failed'; END IF;
  BEGIN PERFORM public.settle_icp_dispatch_preflight(d,run,'one','["different failure"]',300); RAISE EXCEPTION 'accepted conflicting retry';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE '%Conflicting preflight%' THEN RAISE; END IF; END;
  BEGIN PERFORM public.settle_icp_dispatch_preflight(d,actor,'one',msg,300); RAISE EXCEPTION 'accepted foreign run';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE '%ownership lost%' THEN RAISE; END IF; END;
  UPDATE public.icp_dispatch_site_state SET next_eligible_at=now() WHERE site_id=site;
  IF public.reserve_icp_dispatch(site,other_list,'after-preflight','two')->>'acquired' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'site still busy after cooldown'; END IF;
  IF public.settle_icp_dispatch_preflight(d,run,'one',msg,300) IS DISTINCT FROM result THEN RAISE EXCEPTION 'late retry returned another job cooldown'; END IF;
END $$;

DO $$
DECLARE key text;
BEGIN
  FOREACH key IN ARRAY ARRAY['0','1','9223372036854775807'] LOOP
    BEGIN INSERT INTO public.persons(id,finder_selected_person_id) VALUES(gen_random_uuid(),key);
      RAISE EXCEPTION 'Canonical BIGINT allowed a second text identity: %',key;
    EXCEPTION WHEN check_violation THEN NULL; END;
  END LOOP;
  FOREACH key IN ARRAY ARRAY['000','001','9223372036854775808','provider:Ab','provider:ab'] LOOP
    INSERT INTO public.persons(id,finder_selected_person_id) VALUES(gen_random_uuid(),key);
  END LOOP;
  BEGIN INSERT INTO public.persons(id,finder_selected_person_id) VALUES(gen_random_uuid(),'001');
    RAISE EXCEPTION 'Duplicated opaque person with no role';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  BEGIN INSERT INTO public.persons(id,external_person_id,finder_selected_person_id) VALUES(gen_random_uuid(),77,'provider:77');
    RAISE EXCEPTION 'Conflicting text and numeric identities accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

DO $$
DECLARE f regprocedure; client text;
BEGIN
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN
    ('update_selected_finder_lead','insert_selected_finder_lead','settle_icp_dispatch_preflight','reconcile_selected_icp_person_ack') LOOP
    FOREACH client IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF has_function_privilege(client,f,'EXECUTE') THEN RAISE EXCEPTION '% may execute %',client,f; END IF;
    END LOOP;
    IF NOT has_function_privilege('service_role',f,'EXECUTE') THEN RAISE EXCEPTION 'worker cannot execute %',f; END IF;
  END LOOP;
END $$;