import type { Activities } from '../../activities';
import { ActivityFailure, ApplicationFailure, CancelledFailure } from '@temporalio/common';
import type { SelectedIcpState } from '../../activities/icpSelectedPeopleActivities';
import type { EnrichLeadOptions } from '../enrichLeadWorkflow';
import type { LeadResearchOptions, LeadResearchResult } from '../leadResearchWorkflow';
import { needsLeadDeepResearch } from '../../utils/leadResearchState';
import { isIcpCreditFailure } from '../../utils/icpDispatchSelection';
import type { SelectedEnrichLeadResult, SelectedMemberAttribution } from './selectedMemberAttribution';

type Deps = Pick<Activities, 'getSelectedIcpPersonActivity' | 'acknowledgeSelectedIcpPersonActivity' | 'getLeadActivity'> & {
  reconcileSelectedIcpPersonAckActivity?: Activities['reconcileSelectedIcpPersonAckActivity'];
  enrich: (options: EnrichLeadOptions & SelectedMemberAttribution, ordinal: string) => Promise<SelectedEnrichLeadResult>;
  research: (options: LeadResearchOptions, ordinal: string) => Promise<LeadResearchResult>;
};

type Receipt = Parameters<Activities['reconcileSelectedIcpPersonAckActivity']>[0];
type Checkpoint = Pick<Receipt, 'version' | 'processed' | 'found'>;

export const SELECTED_ACK_RECOVERY_PATCH = 'icp-selected-member-ack-recovery-v1';
// Durable backoff on the *same receipt* through transport outages. Definitive
// SQL denials/invalid receipts are non-retryable; ownership is never released.
export const ICP_RECEIPT_RETRY = { startToCloseTimeout: '5 minutes', retry: {
  initialInterval: '5 seconds', maximumInterval: '1 minute',
} } as const;

function matchesReceipt(value: Checkpoint | undefined, expected: Receipt): boolean {
  return value?.version === expected.version && value.processed === expected.processed && value.found === expected.found;
}

/** Only retries the exact ACK, never the paid work which produced it. Both RPC
 * attempts apply-or-verify the same member receipt under the same DB locks. */
async function confirmReceipt(receipt: Receipt, deps: Deps): Promise<Checkpoint> {
  try {
    const applied = await deps.acknowledgeSelectedIcpPersonActivity(receipt);
    if (matchesReceipt(applied, receipt)) return applied;
  } catch (error) {
    const cause = error instanceof ActivityFailure ? error.cause : error;
    if (cause instanceof CancelledFailure || (cause instanceof ApplicationFailure && cause.nonRetryable)) throw error;
    // A timeout or transport failure may follow a committed ACK.
  }
  const confirmed = await deps.reconcileSelectedIcpPersonAckActivity!(receipt);
  if (!matchesReceipt(confirmed, receipt)) {
    throw ApplicationFailure.nonRetryable('Selected member ACK checkpoint mismatch', 'SELECTED_ICP_ACK_UNCONFIRMED');
  }
  return confirmed;
}

/** Separate membership checkpoint: never touch the provider page snapshot/cursor. */
export async function processSelectedPeople(options: {
  id: string; site_id: string; run_id: string; version: number; processed: number; found: number;
  max_candidates: number; max_matches: number; research_enabled: boolean; state: SelectedIcpState;
}, deps: Deps) {
  let { version, processed, found } = options;
  const errors: string[] = [];
  let retryableFailure = false;
  let noPaidWork = false;
  for (const member of options.state.members.slice(0, options.max_candidates)) {
    if (found - options.found >= options.max_matches) break;
    // A rejected source/paid child call is not proof that its provider stopped.
    // In contrast an explicit terminal failure can leave this member pending.
    let paidStage: 'source' | 'enrich' | 'research' | undefined;
    let receipt: Receipt | undefined;
    try {
      const identity = { id: options.id, site_id: options.site_id, run_id: options.run_id, ordinal: member.ordinal };
      paidStage = 'source';
      const source = await deps.getSelectedIcpPersonActivity(deps.reconcileSelectedIcpPersonAckActivity
        ? { ...identity, classifyPreflight: true } : identity);
      paidStage = 'enrich';
      const result = await deps.enrich({ person_id: member.person_id, site_id: options.site_id,
        userId: member.created_by, source_search_result: source, validated_contact_policy: true,
        selected_member_attribution: true }, member.ordinal);
      paidStage = undefined;
      const conflict = deps.reconcileSelectedIcpPersonAckActivity ? result.selectedIdentityReview : undefined;
      const conflictReview = conflict != null && conflict.siteId === options.site_id && conflict.providerId === member.person_id
        && conflict.reason === 'conflicting_lead_identity' && result.success === true && result.outcome === 'needs_review'
        && typeof result.personId === 'string' && !!result.personId.trim() && result.leadId == null;
      if (conflict !== undefined && !conflictReview) throw new Error('Unconfirmed selected identity review');
      const durableReview = conflictReview || (result.outcome === 'needs_review' && !!result.personId && !result.leadId
        && result.identityReviews?.some(review => review.site_id === options.site_id && review.selected
          && review.status === 'pending' && !!review.id));
      if (!result.success || (!result.leadId && result.outcome !== 'no_match' && !durableReview)) {
        throw new Error(result.errors.join('; ') || 'Selected enrichment did not persist a result');
      }
      errors.push(...result.errors, ...(result.identityReviews || []).map(review => review.error));
      if (errors.some(isIcpCreditFailure)) { retryableFailure = true; break; }
      if (result.leadId && options.research_enabled) {
        const lead = await deps.getLeadActivity(result.leadId);
        if (!lead.success || !lead.lead || lead.lead.site_id !== options.site_id) throw new Error('Selected research lead unavailable');
        if (needsLeadDeepResearch(lead.lead)) {
          paidStage = 'research';
          const research = await deps.research({ lead_id: result.leadId, site_id: options.site_id,
            userId: member.created_by, additionalData: { executedDuringIcpMining: true, icpMiningId: options.id } }, member.ordinal);
          paidStage = undefined;
          if (!research.success) throw new Error(research.errors.join('; ') || 'Selected research failed');
        }
      }
      const outcome = result.leadId ? 'matched' : durableReview ? 'needs_review' : 'no_match';
      if (deps.reconcileSelectedIcpPersonAckActivity) {
        receipt = { ...identity, person_id: member.person_id, version: version + 1, processed: processed + 1,
          found: found + (result.leadId ? 1 : 0), lead_id: result.leadId, outcome };
      } else {
        // Historical ACK failures were returned as ordinary member failures.
        ({ version, processed, found } = await deps.acknowledgeSelectedIcpPersonActivity({ ...identity,
          version: version + 1, lead_id: result.leadId, outcome }));
      }
    } catch (error) {
      if (deps.reconcileSelectedIcpPersonAckActivity && paidStage) {
        const cause = error instanceof ActivityFailure ? error.cause : error;
        if (paidStage !== 'source' || !(cause instanceof ApplicationFailure) || !cause.nonRetryable
          || cause.type !== 'SELECTED_SOURCE_NOT_STARTED') throw error;
        // This member's lookup stopped on local validation/DB reads. Neither
        // Finder nor its enrichment child started. Prior receipts remain exact.
        noPaidWork = processed === options.processed;
        error = cause;
      }
      errors.push(`Selected member ${member.ordinal}: ${String(error)}`); retryableFailure = true; break;
    }
    // Do not catch this as a candidate failure: the caller must NEVER checkpoint
    // or settle from old counters if the exact outcome could not be confirmed.
    if (receipt) ({ version, processed, found } = await confirmReceipt(receipt, deps));
  }
  return { version, processed, found, errors, retryableFailure, noPaidWork, success: !retryableFailure && errors.length === 0 };
}