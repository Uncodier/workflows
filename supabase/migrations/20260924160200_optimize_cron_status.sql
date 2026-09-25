UPDATE public.cron_status
SET status = upper(status)
WHERE status IS NOT NULL
  AND status <> upper(status);

WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY site_id, activity_name
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
    ) AS duplicate_number
  FROM public.cron_status
  WHERE site_id IS NOT NULL
    AND activity_name IS NOT NULL
)
DELETE FROM public.cron_status
USING ranked
WHERE public.cron_status.id = ranked.id
  AND ranked.duplicate_number > 1;

CREATE UNIQUE INDEX IF NOT EXISTS cron_status_site_activity_uidx
  ON public.cron_status (site_id, activity_name);

CREATE INDEX IF NOT EXISTS cron_status_running_updated_idx
  ON public.cron_status (updated_at)
  WHERE status = 'RUNNING';