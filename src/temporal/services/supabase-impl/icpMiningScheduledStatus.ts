import type { SupabaseClient } from '@supabase/supabase-js';

export interface IcpMiningScheduledStatusUpdate {
  siteId: string;
  workflowId: string;
  scheduleId: string;
  nextRun: string;
}

interface IcpCronStatusSnapshot {
  id: string;
  status: string;
  schedule_id: string | null;
  next_run: string | null;
  updated_at: string | null;
}

const ICP_ACTIVITY_NAME = 'idealClientProfileMiningWorkflow';

/**
 * Publish a future ICP timer without regressing execution status. The read only
 * decides eligibility; insert-ignore or compare-and-swap enforces it at write time.
 * A lost race is a no-op, never an unconditional upsert or a retry of stale data.
 */
export async function saveIcpMiningScheduledStatus(
  client: SupabaseClient,
  update: IcpMiningScheduledStatusUpdate,
): Promise<void> {
  if (update.scheduleId === 'manual-execution') return;
  const nextRunTime = Date.parse(update.nextRun);
  if (!Number.isFinite(nextRunTime)) {
    throw new Error('Invalid ICP scheduled nextRun');
  }
  // An immediately executing child owns publication, including early completion.
  if (nextRunTime <= Date.now()) return;

  const { data, error } = await client
    .from('cron_status')
    .select('id,status,schedule_id,next_run,updated_at')
    .eq('site_id', update.siteId)
    .eq('activity_name', ICP_ACTIVITY_NAME)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to read ICP scheduled cron status: ${error.message}`);
  }

  // The read may have taken us past the timer's target time.
  const now = Date.now();
  if (nextRunTime <= now) return;
  const existing = data as IcpCronStatusSnapshot | null;
  if (existing) {
    const status = existing.status.toUpperCase();
    if (status === 'RUNNING'
      || (existing.schedule_id === update.scheduleId && status !== 'SCHEDULED')) return;

    const existingNextRun = existing.next_run === null ? NaN : Date.parse(existing.next_run);
    if (status === 'SCHEDULED' && existingNextRun > now && existingNextRun <= nextRunTime) return;
  }

  // Omit last_run (and all execution diagnostics): scheduling must not erase history.
  const record = {
    site_id: update.siteId,
    activity_name: ICP_ACTIVITY_NAME,
    workflow_id: update.workflowId,
    schedule_id: update.scheduleId,
    status: 'SCHEDULED',
    next_run: update.nextRun,
    updated_at: new Date(now).toISOString(),
  };

  if (!existing) {
    // Uses the existing cron_status_site_activity_uidx, not a new schema object.
    const { error: insertError } = await client.from('cron_status').upsert(record, {
      onConflict: 'site_id,activity_name',
      ignoreDuplicates: true,
    });
    if (insertError) {
      throw new Error(`Failed to insert ICP scheduled cron status: ${insertError.message}`);
    }
    return;
  }

  let query = client.from('cron_status').update(record)
    .eq('id', existing.id)
    .eq('site_id', update.siteId)
    .eq('activity_name', ICP_ACTIVITY_NAME)
    .eq('status', existing.status);
  // Preserve raw timestamp precision and status casing in the CAS predicate.
  // Nullable legacy values require IS NULL, not eq(null).
  query = existing.updated_at === null
    ? query.is('updated_at', null) : query.eq('updated_at', existing.updated_at);
  query = existing.schedule_id === null
    ? query.is('schedule_id', null) : query.eq('schedule_id', existing.schedule_id);
  query = existing.next_run === null
    ? query.is('next_run', null) : query.eq('next_run', existing.next_run);

  const { error: updateError } = await query;
  if (updateError) {
    throw new Error(`Failed to update ICP scheduled cron status: ${updateError.message}`);
  }
  // Zero affected rows means another writer won. Do not fall back to an upsert.
}