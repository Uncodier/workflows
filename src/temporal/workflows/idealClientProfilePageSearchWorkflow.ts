import { proxyActivities, executeChild, patched, workflowInfo } from '@temporalio/workflow';
import type { Activities } from '../activities';
import { enrichLeadWorkflow } from './enrichLeadWorkflow';
import { leadResearchWorkflow } from './leadResearchWorkflow';
import { needsLeadDeepResearch } from '../utils/leadResearchState';
import { processPageSafely } from './icpMining/processPageSafely';
import type { IcpPageSnapshot } from '../activities/icpMiningExecutionActivities';

const { getLeadActivity, checkpointIcpMiningExecutionActivity } = proxyActivities<Activities>({
  startToCloseTimeout: '5 minutes', retry: { maximumAttempts: 3 },
});

// Finder + DB activities for ICP mining (page-level only; per-person handled by enrichLeadWorkflow)
const {
  getRoleQueryByIdActivity,
  callPersonRoleSearchActivity,
  getSegmentIdFromRoleQueryActivity,
  logWorkflowExecutionActivity,
  validateCommunicationChannelsActivity,
} = proxyActivities<{
  getRoleQueryByIdActivity: (id: string) => Promise<{ success: boolean; roleQuery?: any; error?: string }>;
  callPersonRoleSearchActivity: Activities['callPersonRoleSearchActivity'];
  getSegmentIdFromRoleQueryActivity: (roleQueryId: string) => Promise<{ success: boolean; segmentId?: string; error?: string }>;
  logWorkflowExecutionActivity: (params: any) => Promise<void>;
  validateCommunicationChannelsActivity: (params: { site_id: string; requireHealthyOutbound?: boolean }) => Promise<{ success: boolean; hasAnyChannel: boolean }>;
}>({
  startToCloseTimeout: '10 minutes',
  retry: { maximumAttempts: 3 },
});

export interface IdealClientProfilePageSearchOptions {
  role_query_id: string;
  page: number; // 0-based
  page_size: number;
  site_id: string;
  userId: string;
  icp_mining_id?: string; // for logging and metadata
  start_index?: number;
  max_matches?: number;
  max_candidates?: number; // Reserved candidate-attempt budget for a dispatcher slice.
  research_enabled?: boolean;
  execution?: { run_id: string; version: number; processed: number; found: number };
  snapshot?: IcpPageSnapshot | null;
}

export interface IdealClientProfilePageSearchResult {
  success: boolean;
  processed: number; // persons processed in this page
  foundMatches: number; // leads with valid email created
  leadsCreated: string[]; // lead IDs created
  hasMore: boolean; // if there are more pages
  total?: number; // total targets (only from page 0)
  errors: string[];
  pageCompleted?: boolean; // false when the per-run target interrupts a page
  retryableFailure?: boolean;
  checkpoint?: { version: number; processed: number; found: number; page: number; offset: number; snapshot: IcpPageSnapshot | null };
}

/**
 * Workflow that processes a SINGLE page of ICP mining
 * Returns results and pagination info for orchestrator to decide next steps
 */
export async function idealClientProfilePageSearchWorkflow(
  options: IdealClientProfilePageSearchOptions
): Promise<IdealClientProfilePageSearchResult> {
  if (options.execution) {
    return processPageSafely(options, {
      getRoleQueryByIdActivity, callPersonRoleSearchActivity, getSegmentIdFromRoleQueryActivity,
      getLeadActivity, checkpointIcpMiningExecutionActivity,
      enrich: (params, index) => executeChild(enrichLeadWorkflow, {
        workflowId: `icp-enrich-${options.icp_mining_id}-${options.execution!.run_id}-${options.page}-${index}`, args: [params],
      }),
      research: params => executeChild(leadResearchWorkflow, {
        workflowId: `icp-research-${params.lead_id}-${workflowInfo().runId}`, args: [params],
      }),
    });
  }
  const { role_query_id, page, page_size, site_id, userId, icp_mining_id } = options;
  const workflowId = `icp-page-search-${icp_mining_id || role_query_id}-page${page}`;
  const errors: string[] = [];
  let processed = 0;
  let foundMatches = 0;
  const leadsCreated: string[] = [];
  const configuredMining = patched('icp-page-configurable-independent-v1');
  const startIndex = configuredMining ? options.start_index ?? 0 : 0;
  const maxMatches = configuredMining ? options.max_matches ?? 3000 : Infinity;
  if (configuredMining && (!Number.isInteger(startIndex) || startIndex < 0 || startIndex >= 10
    || !Number.isInteger(maxMatches) || maxMatches < 1 || maxMatches > 3000)) {
    throw new Error('Invalid ICP page offset or lead target');
  }

  await logWorkflowExecutionActivity({
    workflowId,
    workflowType: 'idealClientProfilePageSearchWorkflow',
    status: 'STARTED',
    input: options,
  });

  // Get role query data
  const roleQueryRes = await getRoleQueryByIdActivity(role_query_id);
  if (!roleQueryRes.success || !roleQueryRes.roleQuery) {
    const err = `Failed to get role query data: ${roleQueryRes.error}`;
    errors.push(err);
    return {
      success: false,
      processed: 0,
      foundMatches: 0,
      leadsCreated: [],
      hasMore: false,
      errors,
    };
  }

  const roleQuery = roleQueryRes.roleQuery;

  await logWorkflowExecutionActivity({
    workflowId,
    workflowType: 'idealClientProfilePageSearchWorkflow',
    status: 'INFO',
    input: options,
    output: {
      message: `Fetching page ${page} with page_size ${page_size}`,
      roleQueryId: role_query_id,
    },
  });

  // Call Finder API for this specific page
  if (!configuredMining && patched('icp-page-outbound-health-gate-v1')) {
    const outbound = await validateCommunicationChannelsActivity({
      site_id, requireHealthyOutbound: true,
    });
    if (!outbound.success || !outbound.hasAnyChannel) {
      return {
        success: false, processed: 0, foundMatches: 0,
        leadsCreated: [], hasMore: false,
        errors: ['No recently healthy outbound channel for ICP page search'],
      };
    }
  }
  const pageRes = await callPersonRoleSearchActivity({
    query: roleQuery.query,
    page,
    page_size: configuredMining ? 10 : page_size,
    site_id,
    userId,
  });

  if (!pageRes.success) {
    const err = `Page ${page} fetch failed: ${pageRes.error}`;
    errors.push(err);
    return {
      success: false,
      processed: 0,
      foundMatches: 0,
      leadsCreated: [],
      hasMore: false,
      errors,
    };
  }

  const total = page === 0 ? pageRes.total : undefined;
  const hasMore = !!pageRes.hasMore;

  await logWorkflowExecutionActivity({
    workflowId,
    workflowType: 'idealClientProfilePageSearchWorkflow',
    status: 'INFO',
    input: options,
    output: {
      page,
      total,
      hasMore,
      personsInPage: pageRes.persons?.length || 0,
    },
  });

  // Extract persons from API response
  const searchResults = (pageRes as any).data?.search_results || (pageRes as any).data?.results
    || (configuredMining ? (pageRes.persons || []).map((person: any) => person.person ? person : { person, organization: person.organization }) : []);
  const persons = searchResults.map((result: any) => ({
    ...result.person,
    organization: result.organization,
    role_title: result.role_title,
    start_date: result.start_date,
    end_date: result.end_date,
    is_current: result.is_current,
    external_person_id: result.person?.id,
    external_organization_id: result.organization?.id,
    company_name: result.organization?.name,
    full_name: result.person?.full_name,
    location: result.person?.location?.name,
    raw_result: result,
  }));

  if (persons.length === 0) {
    await logWorkflowExecutionActivity({
      workflowId,
      workflowType: 'idealClientProfilePageSearchWorkflow',
      status: 'INFO',
      input: options,
      output: { message: `No persons found on page ${page}` },
    });
  }

  // Fetch segment_id once before the loop
  let segmentId: string | undefined = undefined;
  try {
    const segmentResult = await getSegmentIdFromRoleQueryActivity(role_query_id);
    if (segmentResult.success && segmentResult.segmentId) {
      segmentId = segmentResult.segmentId;
    }
  } catch {}

  // Process each person via enrichLeadWorkflow child
  for (const p of persons.slice(startIndex)) {
    if (foundMatches >= maxMatches) break;
    const external_person_id = p.external_person_id ?? p.person_id ?? p.id ?? null;
    const full_name = p.full_name || p.name || null;
    const company_name = p.company_name || p.organization_name || p.company || null;
    const linkedin_profile =
      p.person?.linkedin_url ??
      p.raw_result?.linkedin_info?.public_profile_url ??
      p.raw_result?.person?.linkedin_info?.public_profile_url ??
      p.raw_result?.linkedin_url ??
      undefined;

    if (!external_person_id) {
      errors.push(`Person missing external_person_id for ${full_name || 'unknown'}`);
      processed += 1;
      continue;
    }

    const childWorkflowId = `enrich-lead-icp-${icp_mining_id || role_query_id}-${external_person_id}-${page}`;

    try {
      const result = await executeChild(enrichLeadWorkflow, {
        workflowId: childWorkflowId,
        args: [{
          person_id: String(external_person_id),
          linkedin_profile,
          site_id,
          userId,
          company_name: company_name || undefined,
          segment_id: segmentId,
          ...(configuredMining ? { source_search_result: p.raw_result } : {}),
        }],
      });

      processed += 1;
      if (configuredMining && result.success && result.errors?.length) {
        errors.push(...result.errors.map(error => `Enrichment warning for ${external_person_id}: ${error}`));
      }

      if (result.success && result.leadId) {
        if (configuredMining && leadsCreated.includes(result.leadId)) continue;
        leadsCreated.push(result.leadId);
        foundMatches += 1;
        if (configuredMining && options.research_enabled) {
          try {
            const leadResult = await getLeadActivity(result.leadId);
            if (!leadResult.success || !leadResult.lead || leadResult.lead.site_id !== site_id) {
              throw new Error(leadResult.error || 'Lead unavailable for research in this site');
            }
            if (needsLeadDeepResearch(leadResult.lead)) {
              const research = await executeChild(leadResearchWorkflow, {
                workflowId: `lead-research-icp-${result.leadId}-${workflowInfo().runId}`,
                args: [{ lead_id: result.leadId, site_id, userId,
                  additionalData: { executedDuringIcpMining: true, icpMiningId: icp_mining_id } }],
              });
              if (!research.success) errors.push(`Research failed for ${result.leadId}: ${research.errors.join(', ')}`);
            }
          } catch (error) {
            errors.push(`Research failed for ${result.leadId}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      } else if (configuredMining && !result.success) {
        errors.push(`Enrichment failed for ${external_person_id}: ${result.errors.join(', ')}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Enrich failed for ${full_name || external_person_id}: ${msg}`);
      processed += 1;
    }
  }

  await logWorkflowExecutionActivity({
    workflowId,
    workflowType: 'idealClientProfilePageSearchWorkflow',
    status: 'COMPLETED',
    input: options,
    output: {
      processed,
      foundMatches,
      leadsCreated: leadsCreated.length,
      hasMore,
      total,
    },
  });

  return {
    success: errors.length === 0,
    processed,
    foundMatches,
    leadsCreated,
    hasMore,
    total,
    errors,
    ...(configuredMining ? { pageCompleted: startIndex + processed >= persons.length } : {}),
  };
}


