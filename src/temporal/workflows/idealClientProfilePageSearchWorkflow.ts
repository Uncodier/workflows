import { proxyActivities, executeChild } from '@temporalio/workflow';
import type { Activities } from '../activities';
import { enrichLeadWorkflow } from './enrichLeadWorkflow';

// Finder + DB activities for ICP mining (page-level only; per-person handled by enrichLeadWorkflow)
const {
  getRoleQueryByIdActivity,
  callPersonRoleSearchActivity,
  getSegmentIdFromRoleQueryActivity,
  logWorkflowExecutionActivity,
} = proxyActivities<{
  getRoleQueryByIdActivity: (id: string) => Promise<{ success: boolean; roleQuery?: any; error?: string }>;
  callPersonRoleSearchActivity: (o: { role_query_id?: string; query?: any; page: number; page_size?: number; site_id?: string; userId?: string }) => Promise<{ success: boolean; persons?: any[]; total?: number; page?: number; pageSize?: number; hasMore?: boolean; error?: string }>;
  getSegmentIdFromRoleQueryActivity: (roleQueryId: string) => Promise<{ success: boolean; segmentId?: string; error?: string }>;
  logWorkflowExecutionActivity: (params: any) => Promise<void>;
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
}

export interface IdealClientProfilePageSearchResult {
  success: boolean;
  processed: number; // persons processed in this page
  foundMatches: number; // leads with valid email created
  leadsCreated: string[]; // lead IDs created
  hasMore: boolean; // if there are more pages
  total?: number; // total targets (only from page 0)
  errors: string[];
}

/**
 * Workflow that processes a SINGLE page of ICP mining
 * Returns results and pagination info for orchestrator to decide next steps
 */
export async function idealClientProfilePageSearchWorkflow(
  options: IdealClientProfilePageSearchOptions
): Promise<IdealClientProfilePageSearchResult> {
  const { role_query_id, page, page_size, site_id, userId, icp_mining_id } = options;
  const workflowId = `icp-page-search-${icp_mining_id || role_query_id}-page${page}`;
  const errors: string[] = [];
  let processed = 0;
  let foundMatches = 0;
  const leadsCreated: string[] = [];

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
  const pageRes = await callPersonRoleSearchActivity({
    query: roleQuery.query,
    page,
    page_size,
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
  const searchResults = (pageRes as any).data?.search_results || (pageRes as any).data?.results || [];
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
  for (const p of persons) {
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
        }],
      });

      processed += 1;

      if (result.success && result.leadId) {
        leadsCreated.push(result.leadId);
        foundMatches += 1;
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
  };
}


