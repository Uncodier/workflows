CREATE OR REPLACE FUNCTION public.claim_approved_message(
  p_message_id uuid,
  p_conversation_id uuid
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH claimed AS (
    UPDATE public.messages
    SET
      custom_data = jsonb_set(
        coalesce(custom_data, '{}'::jsonb),
        '{status}',
        to_jsonb('sending'::text),
        true
      ),
      updated_at = now()
    WHERE id = p_message_id
      AND conversation_id = p_conversation_id
      AND custom_data->>'status' = 'accepted'
    RETURNING id
  )
  SELECT EXISTS (SELECT 1 FROM claimed);
$$;

CREATE OR REPLACE FUNCTION public.claim_approved_messages_batch(
  p_messages jsonb
)
RETURNS TABLE (message_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH requested AS (
    SELECT DISTINCT item.message_id, item.conversation_id
    FROM jsonb_to_recordset(coalesce(p_messages, '[]'::jsonb))
      AS item(message_id uuid, conversation_id uuid)
  ),
  claimed AS (
    UPDATE public.messages AS messages
    SET
      custom_data = jsonb_set(
        coalesce(messages.custom_data, '{}'::jsonb),
        '{status}',
        to_jsonb('sending'::text),
        true
      ),
      updated_at = now()
    FROM requested
    WHERE messages.id = requested.message_id
      AND messages.conversation_id = requested.conversation_id
      AND messages.custom_data->>'status' = 'accepted'
    RETURNING messages.id
  )
  SELECT claimed.id AS message_id FROM claimed;
$$;

CREATE OR REPLACE FUNCTION public.reset_stuck_sending_messages(
  p_cutoff timestamptz,
  p_limit integer DEFAULT 500
)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH candidates AS (
    SELECT id
    FROM public.messages
    WHERE custom_data->>'status' = 'sending'
      AND updated_at < p_cutoff
    ORDER BY updated_at
    LIMIT greatest(1, least(coalesce(p_limit, 500), 2000))
    FOR UPDATE SKIP LOCKED
  ),
  reset AS (
    UPDATE public.messages AS messages
    SET
      custom_data = jsonb_set(
        coalesce(messages.custom_data, '{}'::jsonb),
        '{status}',
        to_jsonb('accepted'::text),
        true
      ),
      updated_at = now()
    FROM candidates
    WHERE messages.id = candidates.id
      AND messages.custom_data->>'status' = 'sending'
    RETURNING messages.id
  )
  SELECT count(*)::integer FROM reset;
$$;

REVOKE ALL ON FUNCTION public.claim_approved_message(uuid, uuid)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_approved_messages_batch(jsonb)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reset_stuck_sending_messages(timestamptz, integer)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_approved_message(uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_approved_messages_batch(jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.reset_stuck_sending_messages(timestamptz, integer)
  TO service_role;
