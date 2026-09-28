-- Run ONLY on an isolated copy after applying 20260928203000_channel_health.sql.
-- Example: psql -X -v ON_ERROR_STOP=1 -f tests/channel-health-integration.sql
-- Requires one settings row and permission to create conversations/messages.
-- All fixture writes (including settings) are rolled back, even on success.
BEGIN;
-- The existing webhook is an external HTTP side effect, NOT undone by
-- ROLLBACK. Never disable it on a shared/production database.
ALTER TABLE public.messages DISABLE TRIGGER messages_webhooks;
-- Emulate the privileged API writer in this isolated fixture. The migration
-- deliberately ignores message writes performed as an ordinary SQL role.
SET ROLE service_role;

DO $test$
DECLARE
  v_site uuid;
  v_conversation uuid;
  v_message uuid;
  v_status text;
  v_reset timestamptz;
  v_observed timestamptz;
  v_last_failure timestamptz;
  v_count integer;
  v_source uuid;
BEGIN
  SELECT site_id INTO v_site FROM public.settings LIMIT 1;
  IF v_site IS NULL THEN RAISE EXCEPTION 'Fixture needs an existing settings row'; END IF;

  UPDATE public.settings
  SET channels = coalesce(channels, '{}'::jsonb) ||
    '{"email":{"enabled":true,"status":"active","email":"health-test@example.invalid"}}'::jsonb
  WHERE site_id = v_site;
  INSERT INTO public.conversations(site_id, channel)
  VALUES (v_site, 'email') RETURNING id INTO v_conversation;

  -- No terminal delivery = no evidence. The same source cannot be counted twice.
  INSERT INTO public.messages(conversation_id, role, content, custom_data)
  VALUES (v_conversation, 'assistant', 'health fixture', '{"status":"pending"}')
  RETURNING id INTO v_message;
  IF EXISTS (SELECT 1 FROM public.channel_health WHERE site_id = v_site AND direction = 'outbound')
  THEN RAISE EXCEPTION 'Pending message created health'; END IF;

  UPDATE public.messages SET custom_data =
    '{"status":"failed","delivery":{"channel":"email","success":false,"details":{"error":"SMTP authentication failed"}}}'
  WHERE id = v_message;
  SELECT status INTO v_status FROM public.channel_health
  WHERE site_id = v_site AND channel = 'email' AND direction = 'outbound';
  IF v_status IS DISTINCT FROM 'degraded' THEN RAISE EXCEPTION 'Expected degraded, got %', v_status; END IF;

  UPDATE public.messages SET custom_data =
    '{"status":"sent","delivery":{"channel":"email","success":true}}'
  WHERE id = v_message;
  SELECT status INTO v_status FROM public.channel_health
  WHERE site_id = v_site AND channel = 'email' AND direction = 'outbound';
  IF v_status IS DISTINCT FROM 'healthy' THEN RAISE EXCEPTION 'Retry did not recover: %', v_status; END IF;
  UPDATE public.messages SET custom_data = custom_data || '{"diagnostic":true}'::jsonb
  WHERE id = v_message;
  SELECT count(*) INTO v_count FROM public.channel_health_events
  WHERE site_id = v_site AND channel = 'email' AND direction = 'outbound';
  IF v_count IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'Duplicate/retry count: %', v_count; END IF;

  -- Content/recipient failures must not revoke a healthy provider signal.
  INSERT INTO public.messages(conversation_id, role, content, custom_data)
  VALUES (v_conversation, 'assistant', 'health fixture',
    '{"status":"failed","delivery":{"channel":"email","success":false,"details":{"error":"invalid recipient email"}}}');
  SELECT status, last_failure_at INTO v_status, v_last_failure FROM public.channel_health
  WHERE site_id = v_site AND channel = 'email' AND direction = 'outbound';
  IF v_status IS DISTINCT FROM 'healthy' OR v_last_failure IS NOT NULL THEN
    RAISE EXCEPTION 'Recipient degraded channel: %, %', v_status, v_last_failure; END IF;

  -- Changing credentials keeps the audit trail, but discards earlier proof.
  UPDATE public.settings SET channels = jsonb_set(
    channels, '{email,email}', '"health-new@example.invalid"'::jsonb
  ) WHERE site_id = v_site;
  SELECT status, reset_at INTO v_status, v_reset FROM public.channel_health
  WHERE site_id = v_site AND channel = 'email' AND direction = 'outbound';
  IF v_status IS DISTINCT FROM 'unknown' OR v_reset IS NULL THEN
    RAISE EXCEPTION 'Reconfiguration did not reset outbound snapshot'; END IF;
  IF (SELECT count(*) FROM public.channel_health_events
      WHERE site_id = v_site AND channel = 'email' AND direction = 'outbound') <> 2 THEN
    RAISE EXCEPTION 'Reconfiguration deleted audit history'; END IF;

  -- Replaying an old message after changing credentials cannot certify them.
  UPDATE public.messages SET custom_data =
    '{"status":"failed","delivery":{"channel":"email","success":false,"details":{"error":"SMTP authentication failed"}}}'
  WHERE id = v_message;
  UPDATE public.messages SET custom_data =
    '{"status":"sent","delivery":{"channel":"email","success":true}}'
  WHERE id = v_message;
  SELECT status INTO v_status FROM public.channel_health
  WHERE site_id = v_site AND channel = 'email' AND direction = 'outbound';
  IF v_status IS DISTINCT FROM 'unknown' THEN RAISE EXCEPTION 'Old message enabled new identity'; END IF;

  INSERT INTO public.messages(conversation_id, role, content, custom_data)
  VALUES (v_conversation, 'assistant', 'health fixture',
    '{"status":"sent","delivery":{"channel":"email","success":true}}');
  SELECT status, last_success_at INTO v_status, v_observed FROM public.channel_health
  WHERE site_id = v_site AND channel = 'email' AND direction = 'outbound';
  IF v_status IS DISTINCT FROM 'healthy' OR coalesce(v_observed <= v_reset, true) THEN
    RAISE EXCEPTION 'New observation did not recover after reset: %, %, %', v_status, v_observed, v_reset;
  END IF;

  -- Sync attempts are inbound only; they do not reset an outbound identity.
  UPDATE public.settings SET channels = jsonb_set(
    jsonb_set(channels, '{email,last_sync_attempt}', to_jsonb(clock_timestamp()::text)),
    '{email,sync_status}', '"active"'::jsonb
  ) WHERE site_id = v_site;
  SELECT status, reset_at INTO v_status, v_observed FROM public.channel_health
  WHERE site_id = v_site AND channel = 'email' AND direction = 'outbound';
  IF v_status IS DISTINCT FROM 'healthy' OR v_observed IS DISTINCT FROM v_reset THEN
    RAISE EXCEPTION 'Routine sync reset outbound health'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.channel_health
    WHERE site_id = v_site AND channel = 'email' AND direction = 'inbound' AND status = 'healthy') THEN
    RAISE EXCEPTION 'Inbound sync not observed'; END IF;

  -- Service-only event API: duplicate delivery, auth threshold, two distinct
  -- successes after the latest channel failure, and reclassification.
  v_source := gen_random_uuid();
  IF NOT public.record_channel_health_event(v_site, 'email', 'outbound', v_source, 'failure', 'auth')
  THEN RAISE EXCEPTION 'First service event not recorded'; END IF;
  IF public.record_channel_health_event(v_site, 'email', 'outbound', v_source, 'failure', 'auth')
  THEN RAISE EXCEPTION 'Duplicate service event was counted'; END IF;
  PERFORM public.record_channel_health_event(v_site, 'email', 'outbound', gen_random_uuid(), 'failure', 'auth');
  SELECT status INTO v_status FROM public.channel_health
  WHERE site_id = v_site AND channel = 'email' AND direction = 'outbound';
  IF v_status IS DISTINCT FROM 'unhealthy' THEN RAISE EXCEPTION 'Two auth failures: %', v_status; END IF;

  PERFORM public.record_channel_health_event(v_site, 'email', 'outbound', gen_random_uuid(), 'success');
  SELECT status INTO v_status FROM public.channel_health
  WHERE site_id = v_site AND channel = 'email' AND direction = 'outbound';
  IF v_status IS DISTINCT FROM 'unhealthy' THEN RAISE EXCEPTION 'Recovered after only one success: %', v_status; END IF;
  PERFORM public.record_channel_health_event(v_site, 'email', 'outbound', gen_random_uuid(), 'success');
  SELECT status INTO v_status FROM public.channel_health
  WHERE site_id = v_site AND channel = 'email' AND direction = 'outbound';
  IF v_status IS DISTINCT FROM 'healthy' THEN RAISE EXCEPTION 'Two successes did not recover: %', v_status; END IF;

  -- A previously counted failure corrected to a recipient problem must be
  -- removed from the provider/auth failure total, without losing audit data.
  PERFORM public.record_channel_health_event(v_site, 'whatsapp', 'outbound', v_source, 'failure', 'auth');
  PERFORM public.record_channel_health_event(v_site, 'whatsapp', 'outbound', v_source, 'failure', 'recipient');
  SELECT status, channel_failures_15m INTO v_status, v_count FROM public.channel_health
  WHERE site_id = v_site AND channel = 'whatsapp' AND direction = 'outbound';
  IF v_status IS DISTINCT FROM 'unknown' OR v_count IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'Failure reclassification left channel degraded: %, %', v_status, v_count;
  END IF;

  IF has_function_privilege('anon', 'public.record_channel_health_event(uuid,text,text,uuid,text,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.record_channel_health_event(uuid,text,text,uuid,text,text)', 'EXECUTE')
     OR has_table_privilege('authenticated', 'public.channel_health', 'INSERT')
  THEN RAISE EXCEPTION 'Unprivileged health write permission'; END IF;
END
$test$;

RESET ROLE;
-- The fixture grants INSERT temporarily to simulate an authenticated client
-- allowed to write a message, without allowing it to claim service-only health.
GRANT SELECT ON public.conversations TO authenticated;
GRANT INSERT ON public.messages TO authenticated;
SET ROLE authenticated;
INSERT INTO public.messages(conversation_id, role, content, custom_data)
SELECT id, 'assistant', 'client forgery',
  '{"status":"sent","delivery":{"channel":"email","success":true}}'::jsonb
FROM public.conversations LIMIT 1;
RESET ROLE;
DO $test$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.channel_health_events e
    JOIN public.messages m ON m.id = e.source_id
    WHERE m.content = 'client forgery'
  ) THEN RAISE EXCEPTION 'Authenticated client forged channel health'; END IF;
END
$test$;
ROLLBACK;