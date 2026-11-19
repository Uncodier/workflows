import { supabaseServiceRole as db } from '../../lib/supabase/client';
import { invalidIcpReceipt, icpReceiptFailure } from './icpReceiptFailure';
import type { SelectedIcpIdentity } from './icpSelectedPeopleActivities';

type SelectedAck = SelectedIcpIdentity & {
  ordinal: string; version: number; lead_id?: string; outcome: 'matched' | 'no_match' | 'needs_review';
};
type ExactSelectedAck = SelectedAck & { person_id: string; processed: number; found: number };
type AckCheckpoint = Pick<ExactSelectedAck, 'version' | 'processed' | 'found'>;

/** Apply/replay only this exact terminal outcome. The RPC checks the receipt or
 * applies its pending predecessor under the same lock; no read-then-release. */
export async function reconcileSelectedIcpPersonAckActivity(params: ExactSelectedAck): Promise<AckCheckpoint> {
  if (!params.person_id || !Number.isSafeInteger(params.version) || params.version < 1
    || !Number.isSafeInteger(params.processed) || params.processed < 1 || !Number.isSafeInteger(params.found)
    || params.found < 0 || params.found > params.processed) throw invalidIcpReceipt('Invalid expected selected ICP checkpoint');
  const { data, error } = await db.rpc('reconcile_selected_icp_person_ack', {
    p_id: params.id, p_site_id: params.site_id, p_run_id: params.run_id, p_ordinal: params.ordinal,
    p_person_id: params.person_id, p_version: params.version, p_lead_id: params.lead_id ?? null,
    p_outcome: params.outcome, p_processed: params.processed, p_found: params.found,
  });
  if (error) throw icpReceiptFailure('Selected ICP receipt unconfirmed', error);
  if (!data || data.version !== params.version || data.processed !== params.processed || data.found !== params.found) {
    throw invalidIcpReceipt('Selected ICP receipt unconfirmed: checkpoint mismatch');
  }
  return { version: data.version, processed: data.processed, found: data.found };
}

export async function acknowledgeSelectedIcpPersonActivity(params: SelectedAck | ExactSelectedAck): Promise<AckCheckpoint> {
  if ('person_id' in params) return reconcileSelectedIcpPersonAckActivity(params);
  // Previously scheduled activities lack an expected identity/counter tuple.
  const { data, error } = await db.rpc('acknowledge_selected_icp_person', {
    p_id: params.id, p_site_id: params.site_id, p_run_id: params.run_id, p_ordinal: params.ordinal,
    p_version: params.version, p_lead_id: params.lead_id ?? null, p_outcome: params.outcome,
  });
  if (error || !data || !Number.isInteger(data.version) || !Number.isInteger(data.processed) || !Number.isInteger(data.found)) {
    throw new Error(`Selected ICP acknowledgement failed: ${error?.message || 'invalid checkpoint'}`);
  }
  return data;
}