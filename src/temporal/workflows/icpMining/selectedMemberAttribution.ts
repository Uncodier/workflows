import type { SelectedIdentityReview } from '../../utils/selectedFinderIdentity';
import type { EnrichLeadResult } from '../enrichLeadWorkflow';

export type SelectedEnrichLeadResult = EnrichLeadResult & { selectedIdentityReview?: SelectedIdentityReview };

/** Optional input is a replay boundary for selected membership enrichment. */
export interface SelectedMemberAttribution { selected_member_attribution?: boolean }
/** Do not forward a rounded person.external_person_id from a JSON result. The
 * original selected string is the authority for all contacts and write guards. */
export function selectedPersonGuard(options: SelectedMemberAttribution & { person_id?: string; userId?: string }) {
  if (options.selected_member_attribution !== true) return {};
  if (!options.person_id || !options.userId) throw new Error('Selected Finder person and creator are required');
  return { selected_person_id: options.person_id };
}
