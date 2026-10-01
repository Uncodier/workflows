import { proxyActivities, executeChild, patched, workflowInfo, CancellationScope } from '@temporalio/workflow';
import type { Activities } from '../activities';
import { idealClientProfilePageSearchWorkflow } from './idealClientProfilePageSearchWorkflow';
import { selectNextIcp } from './icpMining/selectIcp';
import { processSingleIcp } from './icpMining/processSingle';
import { processConfiguredIcp } from './icpMining/processConfigured';
import { processOwnedIcp } from './icpMining/processOwned';
import type { IcpMiningWorkflowDto } from '../utils/icpMiningPayload';
import type {
  IdealClientProfilePageSearchOptions,
} from './idealClientProfilePageSearchWorkflow';

// Generic supabase and logging activities
const {
  logWorkflowExecutionActivity,
  saveCronStatusActivity,
  validateWorkflowConfigActivity,
  validateCommunicationChannelsActivity,
  getIcpMiningConfigurationActivity,
  claimIcpMiningExecutionActivity,
  checkpointIcpMiningExecutionActivity,
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
  getIcpMiningByIdActivity: (id: string) => Promise<{ success: boolean; icp?: IcpMiningWorkflowDto | null; error?: string }>;
  getPendingIcpMiningActivity: (o?: { limit?: number; site_id?: string; icp_mining_ids?: string[] }) => Promise<{ success: boolean; items?: IcpMiningWorkflowDto[]; error?: string }>;
  markIcpMiningStartedActivity: (o: { id: string }) => Promise<{ success: boolean; error?: string }>;
  updateIcpMiningProgressActivity: (o: {
    id: string;
    deltaProcessed?: number;
    deltaFound?: number;
    processedTargets?: number;
    foundMatches?: number;
    status?: any;
    totalTargets?: number;
    last_error?: string | null;
    appendError?: string;
    currentPage?: number;
    currentPageOffset?: number;
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
  maxPages?: number; // default 300
  pageSize?: number; // Finder uses fixed pages of 10
  targetLeadsWithEmail?: number; // manual executions only; scheduled runs read site settings
  researchEnabled?: boolean; // manual executions only; scheduled runs read site settings
  scheduleId?: string;
  additionalData?: {
    parentScheduleId?: string;
    originalScheduleId?: string;
    dailyOperationsScheduleId?: string;
    scheduledBy?: string;
    executionMode?: string;
    [key: string]: unknown;
  };
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
  // Preserve the command sequence of already-recorded executions.
  if (!patched('icp-mining-runtime-settings-status-v1')) return runIcpMining(options);

  const info = workflowInfo();
  const scheduleCandidates = [
    options.scheduleId,
    info.parent?.workflowId,
    info.searchAttributes?.TemporalScheduledById,
    info.searchAttributes?.ScheduleId,
    info.memo?.TemporalScheduledById,
    info.memo?.scheduleId,
    options.additionalData?.parentScheduleId,
    options.additionalData?.originalScheduleId,
    options.additionalData?.dailyOperationsScheduleId,
  ];
  const scheduleId = scheduleCandidates
    .map(value => Array.isArray(value) ? value[0] : value)
    .find((value): value is string => typeof value === 'string' && value.length > 0)
    || (options.additionalData?.scheduledBy || options.additionalData?.executionMode === 'timer-delayed-icp-mining'
      ? info.workflowId : 'manual-execution');
  // Timers may have been created before settings changed (or with old overrides).
  // Only a direct manual invocation can intentionally override the fresh DB read.
  const runtimeOptions = scheduleId === 'manual-execution' ? options : {
    ...options, targetLeadsWithEmail: undefined, researchEnabled: undefined,
  };
  const cronContext = {
    siteId: options.site_id, workflowId: info.workflowId, scheduleId,
    activityName: 'idealClientProfileMiningWorkflow',
  };
  try {
    await saveCronStatusActivity({ ...cronContext, status: 'RUNNING', lastRun: new Date().toISOString() });
    const result = await runIcpMining(runtimeOptions, info.workflowId);
    await saveCronStatusActivity({
      ...cronContext, status: result.success ? 'COMPLETED' : 'FAILED',
      lastRun: new Date().toISOString(),
      errorMessage: result.success ? null : summarizeMiningFailure(result.errors?.join('; ') || 'ICP mining failed'),
    });
    return result;
  } catch (error) {
    // Persist the terminal state even when settings/list loading fails or the run
    // is cancelled. A logging failure must not hide the original Temporal failure.
    try {
      await CancellationScope.nonCancellable(() => saveCronStatusActivity({
        ...cronContext, status: 'FAILED',
        lastRun: new Date().toISOString(), errorMessage: summarizeMiningFailure(error),
      }));
    } catch (statusError) {
      console.error('Failed to persist ICP mining terminal status:', summarizeMiningFailure(statusError));
    }
    throw error;
  }
}

/** Keep status payloads bounded, including nested Temporal activity failures. */
function summarizeMiningFailure(error: unknown): string {
  const messages: string[] = [];
  let current = error;
  for (let depth = 0; current != null && depth < 5; depth++) {
    messages.push((current instanceof Error ? current.message : String(current)).slice(0, 1000));
    current = current instanceof Error ? (current as Error & { cause?: unknown }).cause : undefined;
  }
  return messages.join(': ').slice(0, 2000);
}

async function runIcpMining(
  options: IdealClientProfileMiningOptions,
  executionWorkflowId?: string,
): Promise<IdealClientProfileMiningResult> {
  const workflowId = executionWorkflowId ?? `icp-mining-${options.icp_mining_id || 'batch'}`;
  const maxPages = options.maxPages ?? 300;
  const pageSize = options.pageSize ?? 20;
  let targetLeadsWithEmail = options.targetLeadsWithEmail ?? 150;
  const errors: string[] = [];
  const configurableMining = patched('icp-mining-configurable-independent-v1');
  const filterSelectedLists = configurableMining && patched('icp-mining-list-selection-v1');
  let allLists = true;
  let listIds: string[] = [];
  let miningOptions = options;
  const ownedExecution = configurableMining && patched('icp-mining-owned-checkpoints-v1');
  const processIcp = (args: Parameters<typeof processSingleIcp>[0]) => ownedExecution
    ? processOwnedIcp({ ...args, execution: { runId: workflowInfo().runId, workflowId: workflowInfo().workflowId },
      claim: claimIcpMiningExecutionActivity, checkpoint: checkpointIcpMiningExecutionActivity })
    : configurableMining ? processConfiguredIcp(args) : processSingleIcp(args);

  // Preserve the recorded validation commands for histories started before decoupling.
  if (!configurableMining) {
    console.log('🔐 Step 0: Validating workflow configuration...');
    const configValidation = await validateWorkflowConfigActivity(options.site_id, 'icp_lead_generation');
    if (!configValidation.shouldExecute) {
      console.log(`⛔ Workflow execution blocked: ${configValidation.reason}`);
      await logWorkflowExecutionActivity({
        workflowId, workflowType: 'idealClientProfileMiningWorkflow', status: 'BLOCKED', input: options,
        error: `Workflow is ${configValidation.activityStatus} in site settings`,
      });
      return {
        success: false, icp_mining_id: options.icp_mining_id || 'unknown',
        processed: 0, foundMatches: 0,
        errors: [`Workflow is ${configValidation.activityStatus} in site settings`],
      };
    }
    if (patched('icp-mining-outbound-health-gate-v1')) {
      const outbound = await validateCommunicationChannelsActivity({
        site_id: options.site_id, requireHealthyOutbound: true,
      });
      if (!outbound.success || !outbound.hasAnyChannel) {
        return {
          success: false, icp_mining_id: options.icp_mining_id || 'batch',
          processed: 0, foundMatches: 0,
          errors: ['No recently healthy outbound channel for ICP mining'],
        };
      }
    }
    console.log(`✅ Configuration validated: ${configValidation.reason}`);
  } else {
    const config = await getIcpMiningConfigurationActivity({
      site_id: options.site_id,
      targetLeadsWithEmail: options.targetLeadsWithEmail,
      researchEnabled: options.researchEnabled,
    });
    targetLeadsWithEmail = config.targetLeads;
    miningOptions = { ...options, researchEnabled: config.researchEnabled };
    if (filterSelectedLists) {
      allLists = config.allLists ?? true;
      listIds = config.listIds ?? [];
    }
  }

  await logWorkflowExecutionActivity({
    workflowId,
    workflowType: 'idealClientProfileMiningWorkflow',
    status: 'STARTED',
    input: options,
  });

  if (!executionWorkflowId) await saveCronStatusActivity({
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
    if (filterSelectedLists && !allLists && !listIds.includes(options.icp_mining_id!.toLowerCase())) {
      return { success: false, icp_mining_id: options.icp_mining_id!, processed: 0, foundMatches: 0,
        errors: ['ICP mining list is not selected in AI Activities'] };
    }
    // Single processing path
    const icpRes = await getIcpMiningByIdActivity(options.icp_mining_id as string);
    if (!icpRes.success || !icpRes.icp || (configurableMining && icpRes.icp.site_id !== options.site_id)) {
      const msg = icpRes.error || 'icp_mining not found';
      errors.push(msg);
      if (!configurableMining) await markIcpMiningCompletedActivity({
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
    if (filterSelectedLists && !['pending', 'running'].includes(icpRes.icp.status)) {
      return { success: false, icp_mining_id: options.icp_mining_id!, processed: 0, foundMatches: 0,
        errors: ['ICP mining list is no longer pending or running'] };
    }
    const res = await processIcp({
      icp: icpRes.icp,
      options: miningOptions,
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
    if ('errors' in res && Array.isArray(res.errors)) errors.push(...res.errors);
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
  const pending = await getPendingIcpMiningActivity({ limit: 50, site_id: options.site_id,
    ...(filterSelectedLists && !allLists ? { icp_mining_ids: listIds } : {}),
  });
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

  const items = filterSelectedLists ? (pending.items || []).filter(item =>
    item.site_id === options.site_id && ['pending', 'running'].includes(item.status)
    && (allLists || listIds.includes(String(item.id).toLowerCase()))) : pending.items || [];

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

  const res = await processIcp({
    icp,
    options: miningOptions,
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
  if ('errors' in res && Array.isArray(res.errors)) errors.push(...res.errors);

  return {
    success: errors.length === 0,
    icp_mining_id: icp.id,
    processed: res.processed,
    foundMatches: res.foundMatches,
    totalTargets: res.totalTargets,
    errors: errors.length ? errors : undefined,
  };
}
