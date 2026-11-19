import { ApplicationFailure } from '@temporalio/common';
import { supabaseServiceRole as db } from '../../lib/supabase/client';
import { apiService } from '../services/apiService';
import { finderResponseError } from '../utils/finderData';
import { matchesSelectedPerson, selectedIdentityColumn } from '../utils/selectedFinderIdentity';

export interface SelectedIcpMember { ordinal: string; person_id: string; created_by: string }
export interface SelectedIcpState {
  selectedOnly: boolean; searchExhausted: boolean; pending: number; members: SelectedIcpMember[];
}
export interface SelectedIcpIdentity { id: string; site_id: string; run_id: string }

export async function readSelectedIcpPeopleActivity(params: SelectedIcpIdentity): Promise<SelectedIcpState> {
  const { data, error } = await db.rpc('read_selected_icp_people', {
    p_id: params.id, p_site_id: params.site_id, p_run_id: params.run_id,
  });
  if (error) throw new Error(`Selected ICP read failed: ${error.message}`);
  if (!data || typeof data.selectedOnly !== 'boolean' || typeof data.searchExhausted !== 'boolean'
    || !Number.isSafeInteger(data.pending) || data.pending < 0 || !Array.isArray(data.members)
    || data.members.length !== Math.min(data.pending, 10)) {
    throw new Error('Invalid selected ICP state');
  }
  return { selectedOnly: data.selectedOnly, searchExhausted: data.searchExhausted, pending: data.pending,
    members: data.members.map((member: SelectedIcpMember) => {
      // BIGINT ordinals are serialized as text by SQL; never round through JS Number.
      if (typeof member?.ordinal !== 'string' || !/^[1-9]\d*$/.test(member.ordinal) || typeof member.person_id !== 'string' || !member.person_id
        || typeof member.created_by !== 'string' || !member.created_by) throw new Error('Invalid selected ICP member');
      return { ordinal: member.ordinal, person_id: member.person_id, created_by: member.created_by };
    }) };
}

type SourceInput = SelectedIcpIdentity & { ordinal: string; classifyPreflight?: true };

async function readSelectedSource(params: SourceInput) {
  const { data: member, error } = await db.rpc('get_selected_icp_member', {
    p_id: params.id, p_site_id: params.site_id, p_run_id: params.run_id, p_ordinal: params.ordinal,
  });
  if (error || typeof member?.person_id !== 'string' || typeof member.created_by !== 'string' || !member.created_by) throw new Error(error?.message || 'Selected member unavailable');
  const column = selectedIdentityColumn(member.person_id);
  const { data: person, error: readError } = await db.from('persons').select('raw_result,updated_at,created_at')
    .eq(column, member.person_id).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (readError) throw new Error(readError.message);
  const raw = person?.raw_result;
  // Own the cache freshness decision and the single billed details read.
  // Preparation receives verified evidence and must not hydrate it again.
  const today = new Date().toISOString().slice(0, 10);
  const fresh = String(person?.updated_at || person?.created_at || '').slice(0, 10) === today;
  return { member, cached: fresh && matchesSelectedPerson(raw, member.person_id) ? raw : undefined };
}

/** Only a failure before the provider boundary proves no billable lookup started. */
export async function getSelectedIcpPersonActivity(params: SourceInput): Promise<Record<string, any>> {
  const { member, cached } = await readSelectedSource(params).catch(error => {
    if (params.classifyPreflight) {
      throw ApplicationFailure.nonRetryable(error instanceof Error ? error.message : String(error), 'SELECTED_SOURCE_NOT_STARTED');
    }
    throw error;
  });
  if (cached) return cached;
  const response = await apiService.post('/api/finder/person_contacts_lookup/details', {
    person_id: member.person_id, site_id: params.site_id, userId: member.created_by,
  });
  if (!response.success) throw new Error(response.error?.message || 'Selected person details unavailable');
  const providerError = finderResponseError(response.data);
  if (providerError) throw new Error(providerError);
  const details = response.data?.data ?? response.data;
  if (!matchesSelectedPerson(details, member.person_id)) throw new Error('Selected person details identity mismatch');
  return details;
}

export async function finalizeSelectedIcpSliceActivity(params: SelectedIcpIdentity & { searchExhausted: boolean }) {
  const { data, error } = await db.rpc('finalize_selected_icp_slice', {
    p_id: params.id, p_site_id: params.site_id, p_run_id: params.run_id, p_search_exhausted: params.searchExhausted,
  });
  if (error || !data?.success) throw new Error(`Selected ICP finalization failed: ${error?.message || 'not acknowledged'}`);
}

export { settleIcpDispatchPreflightActivity } from './icpDispatchPreflightActivity';
export { acknowledgeSelectedIcpPersonActivity, reconcileSelectedIcpPersonAckActivity } from './icpSelectedAckActivities';