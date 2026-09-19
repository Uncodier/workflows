-- A failed concurrent build can leave an invalid index that IF NOT EXISTS
-- would otherwise accept. Remove only that invalid artifact before retrying.
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

-- Keep this as a standalone statement: CONCURRENTLY cannot run in a transaction.
CREATE INDEX CONCURRENTLY IF NOT EXISTS messages_sending_updated_at_idx
  ON public.messages (updated_at)
  WHERE custom_data->>'status' = 'sending';
