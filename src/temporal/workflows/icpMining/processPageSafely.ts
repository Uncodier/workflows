import type { Activities } from '../../activities';
import type { EnrichLeadOptions, EnrichLeadResult } from '../enrichLeadWorkflow';
import type { IdealClientProfilePageSearchOptions, IdealClientProfilePageSearchResult } from '../idealClientProfilePageSearchWorkflow';
import type { LeadResearchOptions, LeadResearchResult } from '../leadResearchWorkflow';
import { needsLeadDeepResearch } from '../../utils/leadResearchState';
import { isIcpCreditFailure } from '../../utils/icpDispatchSelection';

type Deps = Pick<Activities, 'getRoleQueryByIdActivity' | 'callPersonRoleSearchActivity' | 'getSegmentIdFromRoleQueryActivity'
  | 'checkpointIcpMiningExecutionActivity' | 'getLeadActivity'> & {
  enrich: (options: EnrichLeadOptions, index: number) => Promise<EnrichLeadResult>;
  research: (options: LeadResearchOptions) => Promise<LeadResearchResult>;
};

export async function processPageSafely(options: IdealClientProfilePageSearchOptions, deps: Deps): Promise<IdealClientProfilePageSearchResult> {
  if (!options.execution || !options.icp_mining_id) throw new Error('Owned page execution identity required');
  if (!Number.isInteger(options.page) || options.page < 0
    || !Number.isInteger(options.start_index ?? 0) || (options.start_index ?? 0) < 0 || (options.start_index ?? 0) > 9
    || !Number.isInteger(options.max_matches ?? 150) || (options.max_matches ?? 150) < 1 || (options.max_matches ?? 150) > 3000) {
    throw new Error('Invalid owned ICP page cursor or target');
  }
  const { run_id } = options.execution;
  if (options.max_candidates !== undefined && (!Number.isInteger(options.max_candidates)
    || options.max_candidates < 1 || options.max_candidates > 10)) throw new Error('Invalid reserved ICP candidate budget');
  let { version, processed, found } = options.execution;
  let page = options.page;
  let offset = options.start_index || 0;
  let snapshot = options.snapshot || null;
  const initialProcessed = processed;
  const initialFound = found;
  const errors: string[] = [];
  const leadsCreated: string[] = [];
  let retryableFailure = false;
  let completed = false;
  let total = snapshot?.total;
  let hasMore = snapshot?.hasMore ?? true;
  const checkpoint = async () => {
    await deps.checkpointIcpMiningExecutionActivity({ id: options.icp_mining_id!, site_id: options.site_id,
      run_id, version: version + 1, processed, found, page, offset, snapshot, total, status: 'running' });
    version++;
  };

  if (snapshot && snapshot.page !== page) throw new Error('Saved ICP page does not match its cursor');
  if (snapshot && (!Array.isArray(snapshot.candidates) || snapshot.candidates.length > 10
    || offset > snapshot.candidates.length)) throw new Error('Invalid saved ICP candidates');
  if (!snapshot) {
    const query = await deps.getRoleQueryByIdActivity(options.role_query_id);
    if (!query.success || !query.roleQuery) throw new Error(query.error || 'ICP query unavailable');
    const response = await deps.callPersonRoleSearchActivity({ query: query.roleQuery.query, page, page_size: 10,
      site_id: options.site_id, userId: options.userId });
    if (!response.success) {
      errors.push(response.error || 'ICP provider unavailable'); retryableFailure = true;
    } else {
      const data = response.data;
      const raw = data?.search_results ?? data?.results ?? response.persons;
      if (!Array.isArray(raw) || raw.length > 10) throw new Error('Invalid ICP provider page');
      total = response.total;
      hasMore = response.hasMore === true;
      snapshot = { page, candidates: raw.map((item: any) => item.person ? item : { person: item, organization: item.organization }), hasMore,
        ...(total !== undefined ? { total } : {}) };
      // Save the exact provider page BEFORE processing; subsequent runs never
      // re-fetch/reorder the unfinished candidates.
      await checkpoint();
    }
  }
  if (snapshot) {
    const candidates = snapshot.candidates;
    const segment = await deps.getSegmentIdFromRoleQueryActivity(options.role_query_id);
    if (!segment.success) throw new Error(segment.error || 'ICP segment lookup failed');
    for (; offset < candidates.length && found - initialFound < (options.max_matches ?? 150)
      && processed - initialProcessed < (options.max_candidates ?? 10);) {
      const candidate = candidates[offset];
      const personId = candidate.person?.id ?? candidate.person?.external_person_id;
      if (!personId) { errors.push(`Candidate ${offset} has no provider identity`); retryableFailure = true; break; }
      let result: EnrichLeadResult;
      try {
        result = await deps.enrich({ person_id: String(personId), site_id: options.site_id, userId: options.userId,
          source_search_result: candidate, segment_id: segment.segmentId,
          validated_contact_policy: true,
          company_name: candidate.organization?.name, linkedin_profile: candidate.person?.linkedin_info?.public_profile_url,
        }, offset);
      } catch (error) {
        errors.push(`Enrichment failed: ${String(error)}`); retryableFailure = true; break;
      }
      const durableReview = result.outcome === 'needs_review' && !!result.personId && !result.leadId
        && result.identityReviews?.some(review => review.site_id === options.site_id && review.selected
          && review.status === 'pending' && !!review.id);
      if (!result.success || (!result.leadId && result.outcome !== 'no_match' && !durableReview)) {
        errors.push(...(result.errors.length ? result.errors : ['Enrichment did not persist a result']));
        retryableFailure = true; break;
      }
      errors.push(...result.errors);
      // Reviews were saved on the person before enrichment acknowledged them.
      // Advance the scan, not the match count; review is not a definitive no-match.
      errors.push(...(result.identityReviews || []).map(review => review.error));
      if (options.stop_on_credit_failure && errors.some(isIcpCreditFailure)) { retryableFailure = true; break; }
      if (result.leadId) {
        let researchFailed = false;
        if (options.research_enabled) {
          try {
            const lead = await deps.getLeadActivity(result.leadId);
            if (!lead.success || !lead.lead || lead.lead.site_id !== options.site_id) throw new Error('Research lead unavailable');
            if (needsLeadDeepResearch(lead.lead)) {
              const research = await deps.research({ lead_id: result.leadId, site_id: options.site_id, userId: options.userId,
                additionalData: { executedDuringIcpMining: true, icpMiningId: options.icp_mining_id } });
              if (!research.success) { errors.push(...research.errors); researchFailed = true; }
            }
          } catch (error) { errors.push(`Research failed for ${result.leadId}: ${String(error)}`); researchFailed = true; }
        }
        // The lead is already saved, but this candidate is not finished until
        // its requested research succeeds. Re-enrichment is idempotent on resume.
        if (researchFailed) { retryableFailure = true; break; }
        found++; leadsCreated.push(result.leadId);
      }
      processed++; offset++;
      if (offset === candidates.length) { page++; offset = 0; snapshot = null; completed = true; }
      await checkpoint();
      if (completed) break;
    }
    if (snapshot && snapshot.candidates.length === 0) {
      page++; offset = 0; snapshot = null; completed = true; await checkpoint();
    }
  }
  return { success: !retryableFailure && errors.length === 0, processed: processed - initialProcessed, foundMatches: found - initialFound,
    leadsCreated, hasMore, total, errors, pageCompleted: completed, retryableFailure,
    checkpoint: { version, processed, found, page, offset, snapshot } };
}