-- Supports the approved-message scheduler without scanning the full messages table.
-- Apply each statement outside a transaction because CONCURRENTLY cannot run in one.
-- Deployment source: supabase/migrations/20260918183000_* and 20260918183100_*.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class AS index_class
    JOIN pg_namespace AS index_namespace
      ON index_namespace.oid = index_class.relnamespace
    JOIN pg_index AS index_state
      ON index_state.indexrelid = index_class.oid
    WHERE index_namespace.nspname = 'public'
      AND index_class.relname = 'messages_accepted_created_at_idx'
      AND NOT index_state.indisvalid
  ) THEN
    DROP INDEX public.messages_accepted_created_at_idx;
  END IF;
END
$$;

CREATE INDEX CONCURRENTLY IF NOT EXISTS messages_accepted_created_at_idx
  ON public.messages (created_at)
  WHERE custom_data->>'status' = 'accepted';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class AS index_class
    JOIN pg_namespace AS index_namespace
      ON index_namespace.oid = index_class.relnamespace
    JOIN pg_index AS index_state
      ON index_state.indexrelid = index_class.oid
    WHERE index_namespace.nspname = 'public'
      AND index_class.relname = 'messages_sending_updated_at_idx'
      AND NOT index_state.indisvalid
  ) THEN
    DROP INDEX public.messages_sending_updated_at_idx;
  END IF;
END
$$;

CREATE INDEX CONCURRENTLY IF NOT EXISTS messages_sending_updated_at_idx
  ON public.messages (updated_at)
  WHERE custom_data->>'status' = 'sending';
