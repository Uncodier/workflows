CREATE OR REPLACE FUNCTION public.mark_task_reminder_sent(
  p_task_id uuid,
  p_time_window_hours integer
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.tasks
  SET metadata = coalesce(metadata, '{}'::jsonb)
    || jsonb_build_object(
      '_reminder_' || p_time_window_hours::text || 'h_sent',
      true
    )
  WHERE id = p_task_id;
$$;

CREATE OR REPLACE FUNCTION public.mark_reservation_reminder_sent(
  p_reservation_id uuid,
  p_time_window_hours integer
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.reservations
  SET metadata = coalesce(metadata, '{}'::jsonb)
    || jsonb_build_object(
      '_reminder_' || p_time_window_hours::text || 'h_sent',
      true
    )
  WHERE id = p_reservation_id;
$$;

REVOKE ALL ON FUNCTION public.mark_task_reminder_sent(uuid, integer)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_reservation_reminder_sent(uuid, integer)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_task_reminder_sent(uuid, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_reservation_reminder_sent(uuid, integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.fetch_sites_needing_billing_initialization()
RETURNS TABLE (site_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT sites.id
  FROM public.sites
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.billing
    WHERE billing.site_id = sites.id
  )
  OR NOT EXISTS (
    SELECT 1
    FROM public.payments
    WHERE payments.site_id = sites.id
      AND payments.payment_method = 'initial_credit'
  );
$$;

REVOKE ALL ON FUNCTION public.fetch_sites_needing_billing_initialization()
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fetch_sites_needing_billing_initialization()
  TO service_role;

CREATE INDEX IF NOT EXISTS tasks_active_scheduled_date_idx
  ON public.tasks (scheduled_date)
  WHERE status IN ('pending', 'in_progress');

CREATE INDEX IF NOT EXISTS reservations_active_start_time_idx
  ON public.reservations (start_time)
  WHERE status IN ('confirmed', 'active', 'scheduled', 'pending');

CREATE INDEX IF NOT EXISTS subscriptions_active_next_billing_idx
  ON public.subscriptions (next_billing_date)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS payments_credit_renewal_lookup_idx
  ON public.payments (site_id, created_at DESC)
  WHERE payment_method = 'credit_renewal';

CREATE INDEX IF NOT EXISTS payments_initial_credit_lookup_idx
  ON public.payments (site_id)
  WHERE payment_method = 'initial_credit';