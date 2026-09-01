-- ==============================================================================
-- Add metadata column to reservations table
-- ==============================================================================
-- This column is used to store idempotent flags for background workflows
-- (e.g., whether a 24h or 1h reminder email has been sent) so we avoid
-- modifying user-facing fields like 'notes'.
-- ==============================================================================

ALTER TABLE public.reservations 
ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

-- Example of how it will be used by the worker:
-- UPDATE public.reservations 
-- SET metadata = metadata || '{"_reminder_24h_sent": true}'::jsonb 
-- WHERE id = '...';