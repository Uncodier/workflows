-- Observed health is separate from settings.channels (configuration).
-- Only terminal, persisted outbound outcomes and provider-origin inbound
-- messages / recorded email sync attempts affect channel health.
CREATE TABLE public.channel_health_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('email', 'whatsapp')),
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  source_id uuid NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('success', 'failure')),
  error_class text CHECK (error_class IN ('auth', 'provider', 'recipient', 'content', 'unknown')),
  -- Wall-clock time distinguishes a reset and an observation in one transaction.
  observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT channel_health_events_source_unique UNIQUE (site_id, channel, direction, source_id)
);

CREATE INDEX channel_health_events_recent_idx
  ON public.channel_health_events (site_id, channel, direction, observed_at DESC);

CREATE TABLE public.channel_health (
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('email', 'whatsapp')),
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  status text NOT NULL DEFAULT 'unknown'
    CHECK (status IN ('unknown', 'healthy', 'degraded', 'unhealthy')),
  successes_15m integer NOT NULL DEFAULT 0,
  channel_failures_15m integer NOT NULL DEFAULT 0,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  reset_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (site_id, channel, direction)
);

ALTER TABLE public.channel_health_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_health ENABLE ROW LEVEL SECURITY;
-- Writes must go through the service-only function/trigger so that callers
-- cannot spoof a success by directly inserting an event or editing the state.
REVOKE ALL ON public.channel_health_events, public.channel_health FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.channel_health_events, public.channel_health TO service_role;

-- Event metadata must never include raw errors, phone numbers, addresses or tokens.
-- A later successful retry replaces a failed outcome for the *same message*.
CREATE FUNCTION public.record_channel_health_event(
  p_site_id uuid, p_channel text, p_direction text, p_source_id uuid,
  p_outcome text, p_error_class text DEFAULT NULL
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_successes integer;
  v_failures integer;
  v_auth_failures integer;
  v_successes_after_failure integer;
  v_last_success timestamptz;
  v_last_failure timestamptz;
  v_existing_status text;
  v_reset_at timestamptz;
  v_previous_error_class text;
  v_status text;
BEGIN
  IF p_site_id IS NULL OR p_channel IS NULL OR p_channel NOT IN ('email', 'whatsapp')
     OR p_direction NOT IN ('inbound', 'outbound')
     OR p_direction IS NULL
     OR p_outcome NOT IN ('success', 'failure')
     OR p_outcome IS NULL OR p_source_id IS NULL
     OR (p_error_class IS NOT NULL AND p_error_class NOT IN ('auth', 'provider', 'recipient', 'content', 'unknown')) THEN
    RAISE EXCEPTION 'Invalid channel health event';
  END IF;

  -- Lock the aggregate first; concurrent deliveries for a channel are reduced
  -- in order. Duplicate events do not reset the observation clock.
  INSERT INTO public.channel_health (site_id, channel, direction)
  VALUES (p_site_id, p_channel, p_direction)
  ON CONFLICT DO NOTHING;
  PERFORM 1 FROM public.channel_health
  WHERE site_id = p_site_id AND channel = p_channel AND direction = p_direction FOR UPDATE;

  SELECT status, reset_at INTO v_existing_status, v_reset_at FROM public.channel_health
  WHERE site_id = p_site_id AND channel = p_channel AND direction = p_direction;

  SELECT error_class INTO v_previous_error_class
  FROM public.channel_health_events
  WHERE site_id = p_site_id AND channel = p_channel AND direction = p_direction
    AND source_id = p_source_id AND outcome = 'failure';

  -- A retry of a pre-reset source cannot attest to the new credentials. Keep
  -- its original observation for audit; require a fresh message to recover.
  IF EXISTS (
    SELECT 1 FROM public.channel_health_events
    WHERE site_id = p_site_id AND channel = p_channel AND direction = p_direction
      AND source_id = p_source_id AND observed_at <= v_reset_at
  ) THEN RETURN false; END IF;

  INSERT INTO public.channel_health_events (site_id, channel, direction, source_id, outcome, error_class)
  VALUES (p_site_id, p_channel, p_direction, p_source_id, p_outcome,
          CASE WHEN p_outcome = 'success' THEN NULL ELSE p_error_class END)
  ON CONFLICT (site_id, channel, direction, source_id) DO UPDATE
    SET outcome = excluded.outcome, error_class = excluded.error_class,
        observed_at = CASE
          WHEN public.channel_health_events.outcome = 'failure' AND excluded.outcome = 'failure'
            THEN public.channel_health_events.observed_at
          ELSE clock_timestamp()
        END
    WHERE public.channel_health_events.outcome <> 'success'
      AND (public.channel_health_events.outcome IS DISTINCT FROM excluded.outcome
           OR public.channel_health_events.error_class IS DISTINCT FROM excluded.error_class);

  IF NOT FOUND THEN RETURN false; END IF;

  -- Non-channel failures are audit observations, not fresh verdicts. The one
  -- exception is reclassifying an earlier auth/provider failure as recipient
  -- or content, which must remove its previous effect on the aggregate.
  IF p_outcome = 'failure' AND coalesce(p_error_class, 'unknown') NOT IN ('auth', 'provider')
     AND v_previous_error_class IS DISTINCT FROM 'auth'
     AND v_previous_error_class IS DISTINCT FROM 'provider'
  THEN
    -- If there was no prior verdict, the default aggregate row suffices;
    -- otherwise do not extend the lifetime of an unrelated verdict.
    RETURN true;
  END IF;

  -- The caller validates freshness of this state before spending AI tokens.

  SELECT max(observed_at) FILTER (WHERE outcome = 'success'),
         max(observed_at) FILTER (WHERE outcome = 'failure' AND error_class IN ('auth', 'provider'))
  INTO v_last_success, v_last_failure
  FROM public.channel_health_events
  WHERE site_id = p_site_id AND channel = p_channel AND direction = p_direction
    AND observed_at > coalesce(v_reset_at, '-infinity'::timestamptz);

  SELECT count(*) FILTER (WHERE outcome = 'success')::integer,
         count(*) FILTER (WHERE outcome = 'failure' AND error_class IN ('auth', 'provider'))::integer,
         count(*) FILTER (WHERE outcome = 'failure' AND error_class = 'auth')::integer,
         count(*) FILTER (WHERE outcome = 'success' AND observed_at > coalesce(v_last_failure, '-infinity'::timestamptz))::integer
  INTO v_successes, v_failures, v_auth_failures, v_successes_after_failure
  FROM public.channel_health_events
  WHERE site_id = p_site_id AND channel = p_channel AND direction = p_direction
    AND observed_at >= now() - interval '15 minutes'
    AND observed_at > coalesce(v_reset_at, '-infinity'::timestamptz);

  v_status := CASE
    WHEN v_existing_status = 'unhealthy' AND v_successes_after_failure < 2 THEN 'unhealthy'
    WHEN v_failures >= 1 AND v_successes_after_failure >= 2 THEN 'healthy'
    WHEN v_auth_failures >= 2 OR (v_failures >= 5 AND v_failures * 2 >= v_successes + v_failures) THEN 'unhealthy'
    WHEN v_failures >= 1 THEN 'degraded'
    WHEN v_successes >= 1 THEN 'healthy'
    ELSE 'unknown'
  END;

  UPDATE public.channel_health
  SET status = v_status, successes_15m = v_successes,
      channel_failures_15m = v_failures, last_success_at = v_last_success,
       last_failure_at = v_last_failure, updated_at = clock_timestamp()
  WHERE site_id = p_site_id AND channel = p_channel AND direction = p_direction;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.record_channel_health_event(uuid, text, text, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_channel_health_event(uuid, text, text, uuid, text, text)
  TO service_role;

-- Only provider/auth failures count against a channel. Invalid recipients,
-- rejected templates, missing contact information and other local errors do not.
CREATE FUNCTION public.observe_message_channel_health() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_site uuid;
  v_channel text;
  v_config jsonb;
  v_channel_config jsonb;
  v_direction text;
  v_outcome text;
  v_error text;
  v_class text;
  v_source_id uuid;
BEGIN
  -- messages/settings permit client writes. A client must not manufacture
  -- provider observations in custom_data. SET ROLE is privilege-checked;
  -- the JWT claim GUC is not. SECURITY DEFINER also changes current_user.
  IF session_user NOT IN ('postgres', 'service_role')
     AND current_setting('role', true) IS DISTINCT FROM 'service_role'
  THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.custom_data IS NOT DISTINCT FROM OLD.custom_data THEN RETURN NEW; END IF;
  END IF;
  SELECT site_id, channel INTO v_site, v_channel FROM public.conversations WHERE id = NEW.conversation_id;
  IF v_site IS NULL THEN RETURN NEW; END IF;

  IF NEW.role = 'user' THEN
    v_direction := 'inbound';
    v_outcome := 'success'; -- Ingestion into messages succeeded, not AI processing.
    v_channel := coalesce(NEW.custom_data->>'channel', v_channel);
    IF TG_OP = 'UPDATE' OR v_channel IS NULL OR v_channel NOT IN ('email', 'whatsapp') THEN RETURN NEW; END IF;
    -- A successful API ingestion is not evidence the provider's webhook
    -- works unless it carries a stable provider-origin message identifier.
    IF coalesce(NEW.custom_data->>'origin_message_id', '') = ''
       OR NEW.custom_data->>'status' = 'failed' THEN RETURN NEW; END IF;
  ELSIF NEW.role IN ('assistant', 'agent') THEN
    v_direction := 'outbound';
    v_channel := coalesce(NEW.custom_data#>>'{delivery,channel}', NEW.custom_data->>'channel', v_channel);
    IF NEW.custom_data#>>'{delivery,success}' = 'true'
       AND NEW.custom_data->>'status' IN ('sent', 'delivered') THEN
      v_outcome := 'success';
    ELSIF NEW.custom_data#>>'{delivery,success}' = 'false'
          AND NEW.custom_data->>'status' = 'failed' THEN
      v_outcome := 'failure';
      v_error := lower(left(coalesce(NEW.custom_data#>>'{delivery,details,error}',
                                    NEW.custom_data->>'error_message', ''), 300));
      v_class := CASE
        WHEN v_error ~ '(invalid (phone|email|address|recipient)|no (phone|email)|unsubscrib|bounce|unknown recipient)' THEN 'recipient'
        WHEN v_error ~ '(template|content|placeholder|approval|no valid channels)' THEN 'content'
        WHEN v_error ~ '(unauthoriz|forbidden|authentication|credential|invalid api key|expired token|smtp auth|(^|[^0-9])(401|403)([^0-9]|$))' THEN 'auth'
        WHEN v_error ~ '(rate.limit|timeout|timed out|econnreset|econnrefused|etimedout|service unavailable|(^|[^0-9])(429|5[0-9][0-9])([^0-9]|$))' THEN 'provider'
        ELSE 'unknown'
      END;
    ELSE RETURN NEW; END IF;
  ELSE RETURN NEW; END IF;

  -- A provider-origin id is not the same thing as an AI/customer-support run.
  -- Only the initial persisted inbound message can establish inbound traffic.
  -- This is a health observation for a configured channel, not an arbitrary
  -- conversation label. Reconfiguration requires fresh evidence.
  IF v_channel IN ('email', 'whatsapp') THEN
    -- Serialize with settings reconfiguration (same lock order: settings,
    -- then channel_health), so an in-flight send cannot bless old credentials.
    SELECT channels INTO v_config
    FROM public.settings WHERE site_id = v_site FOR SHARE;
    IF v_config IS NULL OR jsonb_typeof(v_config) <> 'object' THEN RETURN NEW; END IF;
    IF v_channel = 'email' THEN
      v_channel_config := v_config->'email';
      IF NOT coalesce((
        (v_channel_config->>'enabled' = 'true' AND v_channel_config->>'status' IN ('active', 'synced')
         AND (nullif(v_channel_config->>'email', '') IS NOT NULL
              OR nullif(v_channel_config->'aliases', 'null'::jsonb) IS NOT NULL))
        OR (v_config->'agent'->>'enabled' = 'true' AND v_config->'agent'->>'status' = 'active')
        OR (coalesce(v_config->'agent_mail'->>'enabled', v_config->'agent_email'->>'enabled', 'true') <> 'false'
            AND coalesce(v_config->'agent_mail'->>'status', v_config->'agent_email'->>'status') IN ('active', 'synced'))
      ), false) THEN RETURN NEW; END IF;
    ELSE
      v_channel_config := coalesce(v_config->'whatsapp', v_config->'agent_whatsapp');
      IF NOT coalesce(
        v_channel_config->>'enabled' IS DISTINCT FROM 'false'
        AND v_channel_config->>'status' = 'active'
        AND coalesce(v_channel_config->>'phone_number', v_channel_config->>'existingNumber',
                     v_channel_config->>'number', v_channel_config->>'phone') IS NOT NULL,
        false
      ) THEN RETURN NEW; END IF;
    END IF;

    -- Stable provider messages can be ingested more than once under different
    -- local message IDs. UUIDv5 deduplicates those deliveries without storing
    -- the raw provider identifier in a public health table.
    v_source_id := NEW.id;
    IF v_direction = 'inbound' AND NEW.custom_data->>'origin_message_id' IS NOT NULL THEN
      v_source_id := extensions.uuid_generate_v5(
        '8fb3f7a7-d174-4643-9ad7-cc0d73dba845'::uuid,
        v_site::text || ':' || v_channel || ':' || NEW.custom_data->>'origin_message_id'
      );
    END IF;
    PERFORM public.record_channel_health_event(v_site, v_channel, v_direction,
      v_source_id, v_outcome, v_class);
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.observe_message_channel_health() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER observe_message_channel_health
AFTER INSERT OR UPDATE OF custom_data ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.observe_message_channel_health();

-- IMAP polling lives in the API project, not in this worker. Settings store
-- the outcome and time of each attempt; observe only distinct attempts.
CREATE FUNCTION public.observe_email_sync_channel_health() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_email jsonb := NEW.channels->'email';
  v_attempt text := v_email->>'last_sync_attempt';
  v_outcome text;
  v_error text;
  v_class text;
  v_source_id uuid;
BEGIN
  IF session_user NOT IN ('postgres', 'service_role')
     AND current_setting('role', true) IS DISTINCT FROM 'service_role'
  THEN RETURN NEW; END IF;
  IF NEW.site_id IS NULL OR v_email->>'enabled' IS DISTINCT FROM 'true'
     OR coalesce(v_email->>'status' IN ('active', 'synced'), false) = false
     OR v_attempt IS NULL OR v_attempt = '' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF v_attempt IS NOT DISTINCT FROM OLD.channels->'email'->>'last_sync_attempt'
    THEN RETURN NEW; END IF;
  END IF;

  IF v_email->>'sync_status' = 'error' THEN
    v_outcome := 'failure';
    v_error := lower(left(coalesce(v_email->>'last_sync_error', ''), 300));
    v_class := CASE
      WHEN v_error ~ '(unauthoriz|forbidden|authentication|credential|invalid api key|expired token|imap auth|(^|[^0-9])(401|403)([^0-9]|$))' THEN 'auth'
      WHEN v_error ~ '(rate.limit|timeout|timed out|econnreset|econnrefused|etimedout|service unavailable|(^|[^0-9])(429|5[0-9][0-9])([^0-9]|$))' THEN 'provider'
      ELSE 'unknown'
    END;
  ELSIF v_email->>'sync_status' = 'active'
        AND nullif(v_email->>'last_sync_error', '') IS NULL THEN
    v_outcome := 'success';
  ELSE RETURN NEW; END IF;

  v_source_id := extensions.uuid_generate_v5(
    '8fb3f7a7-d174-4643-9ad7-cc0d73dba845'::uuid,
    NEW.site_id::text || ':email:sync:' || v_attempt
  );
  PERFORM public.record_channel_health_event(NEW.site_id, 'email', 'inbound',
    v_source_id, v_outcome, v_class);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.observe_email_sync_channel_health() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER observe_email_sync_channel_health
AFTER INSERT OR UPDATE OF channels ON public.settings
FOR EACH ROW EXECUTE FUNCTION public.observe_email_sync_channel_health();

-- If the sending identity/credentials change, previous successes no longer
-- establish health. Routine IMAP sync timestamps do not invalidate outbound.
CREATE FUNCTION public.reset_channel_health_on_reconfiguration() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD.channels->'agent_email' IS DISTINCT FROM NEW.channels->'agent_email'
     OR OLD.channels->'agent_mail' IS DISTINCT FROM NEW.channels->'agent_mail'
     OR OLD.channels->'agent' IS DISTINCT FROM NEW.channels->'agent'
     OR ((OLD.channels->'email') - 'last_sync_attempt' - 'last_sync_error' - 'sync_error_count' - 'sync_status' - 'synced')
       IS DISTINCT FROM
        ((NEW.channels->'email') - 'last_sync_attempt' - 'last_sync_error' - 'sync_error_count' - 'sync_status' - 'synced')
  THEN
    UPDATE public.channel_health
    SET status = 'unknown', successes_15m = 0, channel_failures_15m = 0,
        last_success_at = NULL, last_failure_at = NULL,
        reset_at = clock_timestamp(), updated_at = clock_timestamp()
    WHERE site_id = NEW.site_id AND channel = 'email' AND direction = 'outbound';
  END IF;

  IF coalesce(OLD.channels->'whatsapp', OLD.channels->'agent_whatsapp')
     IS DISTINCT FROM coalesce(NEW.channels->'whatsapp', NEW.channels->'agent_whatsapp') THEN
    UPDATE public.channel_health
    SET status = 'unknown', successes_15m = 0, channel_failures_15m = 0,
        last_success_at = NULL, last_failure_at = NULL,
        reset_at = clock_timestamp(), updated_at = clock_timestamp()
    WHERE site_id = NEW.site_id AND channel = 'whatsapp' AND direction = 'outbound';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.reset_channel_health_on_reconfiguration() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER reset_channel_health_on_reconfiguration
AFTER UPDATE OF channels ON public.settings
FOR EACH ROW EXECUTE FUNCTION public.reset_channel_health_on_reconfiguration();

-- An updated health record older than the decision window is unknown, not healthy.
-- Status is advisory: it never mutates settings.channels or stops delivery.