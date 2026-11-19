import { supabaseServiceRole as db } from '../../lib/supabase/client';
import { invalidIcpReceipt, icpReceiptFailure } from './icpReceiptFailure';

/** Only the confirmed owner, before any paid work, may release pristine state.
 * The DB preserves the exact cursor/counters and settles under the dispatch lock. */
export async function settleIcpDispatchPreflightActivity(params: {
  id: string; runId: string; workflowId: string; errors: string[]; retryAfterSeconds: number;
}): Promise<{ next_eligible_at: string }> {
  const { data, error } = await db.rpc('settle_icp_dispatch_preflight', {
    p_id: params.id, p_run_id: params.runId, p_workflow_id: params.workflowId,
    p_errors: params.errors.map(message => message.slice(0, 1000)).slice(0, 20), p_retry_after_seconds: params.retryAfterSeconds,
  });
  if (error) throw icpReceiptFailure('ICP dispatch preflight settlement unconfirmed', error);
  if (data?.success !== true || typeof data.next_eligible_at !== 'string' || !data.next_eligible_at) {
    throw invalidIcpReceipt('ICP dispatch preflight settlement unconfirmed: invalid receipt');
  }
  return { next_eligible_at: data.next_eligible_at };
}