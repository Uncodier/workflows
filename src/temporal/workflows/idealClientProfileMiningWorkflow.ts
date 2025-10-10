import { proxyActivities, executeChild } from '@temporalio/workflow';
import type { Activities } from '../activities';
import { idealClientProfilePageSearchWorkflow } from './idealClientProfilePageSearchWorkflow';
import { selectNextIcp } from './icpMining/selectIcp';
import { processSingleIcp } from './icpMining/processSingle';
import type {
  IdealClientProfilePageSearchOptions,
  IdealClientProfilePageSearchResult,
} from './idealClientProfilePageSearchWorkflow';

// Generic supabase and logging activities
const {
  logWorkflowExecutionActivity,
  saveCronStatusActivity,
} = proxyActivities<Activities>({
  startToCloseTimeout: '5 minutes',
  retry: { maximumAttempts: 3 },
});

// DB activities for ICP mining orchestration
const {
  getIcpMiningByIdActivity,
  getPendingIcpMiningActivity,
  markIcpMiningStartedActivity,
  updateIcpMiningProgressActivity,
  markIcpMiningCompletedActivity,
  getSiteActivity,
} = proxyActivities<{
  getIcpMiningByIdActivity: (id: string) => Promise<{ success: boolean; icp?: any; error?: string }>;
  getPendingIcpMiningActivity: (o?: { limit?: number; site_id?: string }) => Promise<{ success: boolean; items?: any[]; error?: string }>;
  markIcpMiningStartedActivity: (o: { id: string }) => Promise<{ success: boolean; error?: string }>;
  updateIcpMiningProgressActivity: (o: {
    id: string;
    deltaProcessed?: number;
    deltaFound?: number;
    status?: any;
    totalTargets?: number;
    last_error?: string | null;
    appendError?: string;
    currentPage?: number;
  }) => Promise<{ success: boolean; error?: string }>;
  markIcpMiningCompletedActivity: (o: { id: string; failed?: boolean; last_error?: string | null }) => Promise<{ success: boolean; error?: string }>;
  getSiteActivity: (siteId: string) => Promise<{ success: boolean; site?: any; error?: string }>;
}>({
  startToCloseTimeout: '10 minutes',
  retry: { maximumAttempts: 3 },
});

export interface IdealClientProfileMiningOptions {
  icp_mining_id?: string; // id in icp_mining table; if missing or 'ALL', processes pending
  site_id: string;
  userId?: string;
  maxPages?: number; // default 20
  pageSize?: number; // default 20
  targetLeadsWithEmail?: number; // default 40
}

export interface IdealClientProfileMiningResult {
  success: boolean;
  icp_mining_id: string;
  processed: number;
  foundMatches: number;
  totalTargets?: number;
  errors?: string[];
}

/**
 * Orchestrator workflow for ICP mining
 * Iterates through pages using idealClientProfilePageSearchWorkflow until target is reached
 */
export async function idealClientProfileMiningWorkflow(
  options: IdealClientProfileMiningOptions
): Promise<IdealClientProfileMiningResult> {
  const workflowId = `icp-mining-${options.icp_mining_id || 'batch'}`;
  const maxPages = options.maxPages ?? 20;
  const pageSize = options.pageSize ?? 20;
  const targetLeadsWithEmail = options.targetLeadsWithEmail ?? 40;
  const errors: string[] = [];

  await logWorkflowExecutionActivity({
    workflowId,
    workflowType: 'idealClientProfileMiningWorkflow',
    status: 'STARTED',
    input: options,
  });

  await saveCronStatusActivity({
    siteId: options.site_id,
    workflowId,
    scheduleId: workflowId,
    activityName: 'idealClientProfileMiningWorkflow',
    status: 'RUNNING',
    lastRun: new Date().toISOString(),
  });

  // Get site information to extract user_id if not provided
  let actualUserId = options.userId;
  if (!actualUserId) {
    const siteResult = await getSiteActivity(options.site_id);
    if (!siteResult.success || !siteResult.site) {
      const errorMsg = `Failed to get site information: ${siteResult.error}`;
      errors.push(errorMsg);
      await logWorkflowExecutionActivity({
        workflowId,
        workflowType: 'idealClientProfileMiningWorkflow',
        status: 'FAILED',
        input: options,
        output: { error: errorMsg },
      });
      return {
        success: false,
        icp_mining_id: options.icp_mining_id || 'batch',
        processed: 0,
        foundMatches: 0,
        errors: [errorMsg],
      };
    }
    actualUserId = siteResult.site.user_id;
  }

  // Helper to process a single ICP mining record (moved to separate module)

  // Decide processing mode: single id or batch pending
  const isBatch = !options.icp_mining_id || options.icp_mining_id === 'ALL';

  if (!isBatch) {
    // Single processing path
    const icpRes = await getIcpMiningByIdActivity(options.icp_mining_id as string);
    if (!icpRes.success || !icpRes.icp) {
      const msg = icpRes.error || 'icp_mining not found';
      errors.push(msg);
      await markIcpMiningCompletedActivity({
        id: options.icp_mining_id as string,
        failed: true,
        last_error: msg,
      });
      return {
        success: false,
        icp_mining_id: options.icp_mining_id as string,
        processed: 0,
        foundMatches: 0,
        errors,
      };
    }
    const res = await processSingleIcp({
      icp: icpRes.icp,
      options,
      workflowId,
      maxPages,
      pageSize,
      targetLeadsWithEmail,
      actualUserId: actualUserId!,
      deps: {
        logWorkflowExecutionActivity,
        markIcpMiningStartedActivity,
        updateIcpMiningProgressActivity,
        markIcpMiningCompletedActivity,
        executePageSearch: async (pageSearchOptions: IdealClientProfilePageSearchOptions) => {
          return await executeChild(idealClientProfilePageSearchWorkflow, {
            workflowId: `icp-page-search-${pageSearchOptions.icp_mining_id || pageSearchOptions.role_query_id}-page${pageSearchOptions.page}`,
            args: [pageSearchOptions],
          });
        },
      },
    });
    return {
      success: errors.length === 0,
      icp_mining_id: options.icp_mining_id as string,
      processed: res.processed,
      foundMatches: res.foundMatches,
      totalTargets: res.totalTargets,
      errors: errors.length ? errors : undefined,
    };
  }

  // Batch processing: fetch multiple pending records for this site_id
  const pending = await getPendingIcpMiningActivity({ limit: 50, site_id: options.site_id });
  if (!pending.success) {
    const errorMsg = pending.error || 'failed to list pending';
    errors.push(errorMsg);
    await logWorkflowExecutionActivity({
      workflowId,
      workflowType: 'idealClientProfileMiningWorkflow',
      status: 'FAILED',
      input: options,
      output: { error: errorMsg },
    });
    return {
      success: false,
      icp_mining_id: 'batch',
      processed: 0,
      foundMatches: 0,
      errors: [errorMsg],
    };
  }

  const items = pending.items || [];

  await logWorkflowExecutionActivity({
    workflowId,
    workflowType: 'idealClientProfileMiningWorkflow',
    status: 'INFO',
    input: options,
    output: {
      pendingItemsCount: items.length,
      pendingItems: items.map((i) => ({
        id: i.id,
        role_query_id: i.role_query_id,
        status: i.status,
        name: i.name,
        total_targets: i.total_targets,
        processed_targets: i.processed_targets,
      })),
    },
  });

  if (items.length === 0) {
    await logWorkflowExecutionActivity({
      workflowId,
      workflowType: 'idealClientProfileMiningWorkflow',
      status: 'COMPLETED',
      input: options,
      output: { message: 'No pending ICP mining records found for this site' },
    });
    return { success: true, icp_mining_id: 'batch', processed: 0, foundMatches: 0 };
  }

  // Select the next ICP prioritizing 'running' items, then highest remaining targets
  const icp = selectNextIcp(items);

  await logWorkflowExecutionActivity({
    workflowId,
    workflowType: 'idealClientProfileMiningWorkflow',
    status: 'INFO',
    input: options,
    output: {
      selectedIcp: {
        id: icp.id,
        name: icp.name,
        role_query_id: icp.role_query_id,
        total_targets: icp.total_targets,
        processed_targets: icp.processed_targets,
        pending_targets: (typeof icp.total_targets === 'number' ? icp.total_targets : 0) - (typeof icp.processed_targets === 'number' ? icp.processed_targets : 0),
      },
    },
  });

  const res = await processSingleIcp({
    icp,
    options,
    workflowId,
    maxPages,
    pageSize,
    targetLeadsWithEmail,
    actualUserId: actualUserId!,
    deps: {
      logWorkflowExecutionActivity,
      markIcpMiningStartedActivity,
      updateIcpMiningProgressActivity,
      markIcpMiningCompletedActivity,
      executePageSearch: async (pageSearchOptions: IdealClientProfilePageSearchOptions) => {
        return await executeChild(idealClientProfilePageSearchWorkflow, {
          workflowId: `icp-page-search-${pageSearchOptions.icp_mining_id || pageSearchOptions.role_query_id}-page${pageSearchOptions.page}`,
          args: [pageSearchOptions],
        });
      },
    },
  });

  return {
    success: errors.length === 0,
    icp_mining_id: icp.id,
    processed: res.processed,
    foundMatches: res.foundMatches,
    totalTargets: res.totalTargets,
    errors: errors.length ? errors : undefined,
  };
}
