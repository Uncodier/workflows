import { getSupabaseService } from '../services';

const HEALTH_ACTIVITY_NAMES: Record<string, string> = {
  'daily-standup': 'dailyStandUpWorkflow',
  'email-sync': 'syncEmailsWorkflow',
  'lead-generation': 'leadGenerationWorkflow',
  'daily-prospection': 'dailyProspectionWorkflow',
};

export async function cleanStuckRunningStatusActivity(
  hoursThreshold = 6
): Promise<{ cleaned: number; errors: string[] }> {
  const errors: string[] = [];
  let cleaned = 0;

  try {
    const supabaseService = getSupabaseService();
    if (!await supabaseService.getConnectionStatus()) {
      return { cleaned: 0, errors: ['Database not available'] };
    }

    const stuckRecords = await supabaseService.fetchStuckCronStatus(hoursThreshold);
    for (const record of stuckRecords || []) {
      try {
        const updatedAt = new Date(record.updated_at);
        const hoursStuck = (Date.now() - updatedAt.getTime()) / (1000 * 60 * 60);
        await supabaseService.resetCronStatusToFailed(
          record.id,
          `Auto-reset from stuck RUNNING state after ${hoursStuck.toFixed(1)}h by preventive cleanup`
        );
        cleaned++;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`Failed to clean ${record.activity_name}: ${message}`);
      }
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  return { cleaned, errors };
}

export async function checkWorkflowsHealthActivity(options: {
  businessHoursAnalysis?: any;
  checkTypes?: string[];
}): Promise<{
  healthyWorkflows: number;
  failedWorkflows: number;
  stuckWorkflows: number;
  pendingTasks: number;
  issues: any[];
  recommendations: string[];
  needsAttention: boolean;
}> {
  const checkTypes = options.checkTypes
    || ['daily-standup', 'email-sync', 'lead-generation', 'daily-prospection'];
  const activityNames = checkTypes.map(
    (type) => HEALTH_ACTIVITY_NAMES[type] || type
  );
  const issues: any[] = [];
  const recommendations: string[] = [];
  let healthyWorkflows = 0;
  let failedWorkflows = 0;
  let stuckWorkflows = 0;
  let pendingTasks = 0;

  try {
    const supabaseService = getSupabaseService();
    if (!await supabaseService.getConnectionStatus()) {
      return {
        healthyWorkflows: 0,
        failedWorkflows: 1,
        stuckWorkflows: 0,
        pendingTasks: 0,
        issues: [{
          type: 'database-unavailable',
          severity: 'critical',
          description: 'Database connection not available for health monitoring',
        }],
        recommendations: ['Check database connectivity and service status'],
        needsAttention: true,
      };
    }

    const sites = await supabaseService.fetchSites();
    const siteIds = sites.map((site) => site.id);
    if (siteIds.length === 0) {
      return {
        healthyWorkflows: 0,
        failedWorkflows: 0,
        stuckWorkflows: 0,
        pendingTasks: 0,
        issues: [],
        recommendations: ['No sites require workflow health checks'],
        needsAttention: false,
      };
    }

    const { data, error } = await supabaseService
      .getClient()
      .from('cron_status')
      .select('site_id, activity_name, status, last_run, updated_at, error_message')
      .in('activity_name', activityNames)
      .in('site_id', siteIds);

    if (error) {
      throw new Error(`Failed to fetch workflow health statuses: ${error.message}`);
    }

    const statusBySiteAndActivity = new Map<string, any>();
    for (const record of data || []) {
      statusBySiteAndActivity.set(
        `${record.site_id}\u0000${record.activity_name}`,
        record
      );
    }

    for (const activityName of activityNames) {
      for (const site of sites) {
        const status = statusBySiteAndActivity.get(`${site.id}\u0000${activityName}`);
        if (!status) {
          pendingTasks++;
          continue;
        }

        const normalizedStatus = String(status.status || '').toUpperCase();
        const lastRunMs = status.last_run
          ? new Date(status.last_run).getTime()
          : null;
        const hoursSinceRun = lastRunMs == null
          ? null
          : (Date.now() - lastRunMs) / (1000 * 60 * 60);

        if (normalizedStatus === 'RUNNING' && hoursSinceRun != null && hoursSinceRun > 2) {
          stuckWorkflows++;
          issues.push({
            type: 'stuck-workflow',
            severity: 'warning',
            description: `${activityName} for ${site.name} has been running for ${hoursSinceRun.toFixed(1)} hours`,
            siteId: site.id,
            siteName: site.name,
            workflowType: activityName,
            hoursRunning: hoursSinceRun.toFixed(1),
          });
        } else if (normalizedStatus === 'FAILED') {
          failedWorkflows++;
          issues.push({
            type: 'failed-workflow',
            severity: 'critical',
            description: `${activityName} failed for ${site.name}: ${status.error_message || 'Unknown error'}`,
            siteId: site.id,
            siteName: site.name,
            workflowType: activityName,
            errorMessage: status.error_message,
          });
        } else if (hoursSinceRun != null && hoursSinceRun > 24) {
          issues.push({
            type: 'overdue-workflow',
            severity: 'warning',
            description: `${activityName} for ${site.name} has not run in ${hoursSinceRun.toFixed(1)} hours`,
            siteId: site.id,
            siteName: site.name,
            workflowType: activityName,
            hoursSinceRun: hoursSinceRun.toFixed(1),
          });
        } else {
          healthyWorkflows++;
        }
      }
    }
  } catch (error) {
    issues.push({
      type: 'health-check-error',
      severity: 'critical',
      description: error instanceof Error ? error.message : String(error),
    });
    failedWorkflows++;
  }

  if (failedWorkflows > 0) {
    recommendations.push(`Investigate ${failedWorkflows} failed workflow(s)`);
  }
  if (stuckWorkflows > 0) {
    recommendations.push(`Review ${stuckWorkflows} stuck workflow(s)`);
  }
  if (pendingTasks > 0) {
    recommendations.push(`${pendingTasks} workflow(s) have no status record`);
  }
  if (issues.length === 0) {
    recommendations.push('All workflows are operating normally');
  }

  return {
    healthyWorkflows,
    failedWorkflows,
    stuckWorkflows,
    pendingTasks,
    issues,
    recommendations,
    needsAttention: failedWorkflows > 0 || stuckWorkflows > 3 || issues.length > 5,
  };
}

export async function validateAndCleanStuckCronStatusActivity(
  activityName: string,
  siteId: string,
  hoursThreshold = 24,
  currentWorkflowId?: string
): Promise<{
  wasStuck: boolean;
  cleaned: boolean;
  reason: string;
  previousStatus?: string;
  hoursStuck?: number;
  canProceed: boolean;
  isCurrentWorkflow?: boolean;
}> {
  if (siteId === 'global') {
    return {
      wasStuck: false,
      cleaned: false,
      reason: 'Global orchestration workflow is not persisted in cron_status',
      canProceed: true,
    };
  }

  try {
    const supabaseService = getSupabaseService();
    if (!await supabaseService.getConnectionStatus()) {
      return {
        wasStuck: false,
        cleaned: false,
        reason: 'Database not available - proceeding without validation',
        canProceed: true,
      };
    }

    const cronData = await supabaseService.fetchCronStatus(activityName, [siteId]);
    const currentRecord = cronData.find(
      (record) => record.site_id === siteId && record.activity_name === activityName
    );

    if (!currentRecord) {
      return {
        wasStuck: false,
        cleaned: false,
        reason: 'No existing cron record - first execution',
        canProceed: true,
      };
    }

    const normalizedStatus = String(currentRecord.status || '').toUpperCase();
    if (normalizedStatus !== 'RUNNING') {
      return {
        wasStuck: false,
        cleaned: false,
        reason: `Current status is '${normalizedStatus}' - not stuck`,
        previousStatus: normalizedStatus,
        canProceed: true,
      };
    }

    if (currentWorkflowId && currentRecord.workflow_id === currentWorkflowId) {
      return {
        wasStuck: false,
        cleaned: false,
        reason: 'RUNNING status belongs to the current workflow',
        previousStatus: normalizedStatus,
        canProceed: true,
        isCurrentWorkflow: true,
      };
    }

    const updatedAt = new Date(currentRecord.updated_at);
    const hoursStuck = (Date.now() - updatedAt.getTime()) / (1000 * 60 * 60);
    if (hoursStuck < hoursThreshold) {
      return {
        wasStuck: false,
        cleaned: false,
        reason: `RUNNING for ${hoursStuck.toFixed(1)}h - within ${hoursThreshold}h threshold`,
        previousStatus: normalizedStatus,
        hoursStuck,
        canProceed: false,
      };
    }

    await supabaseService.resetCronStatusToFailed(
      currentRecord.id,
      `Auto-reset from stuck RUNNING state after ${hoursStuck.toFixed(1)}h - exceeded ${hoursThreshold}h threshold`
    );
    return {
      wasStuck: true,
      cleaned: true,
      reason: `Cleaned stuck RUNNING record (${hoursStuck.toFixed(1)}h > ${hoursThreshold}h threshold)`,
      previousStatus: normalizedStatus,
      hoursStuck,
      canProceed: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      wasStuck: false,
      cleaned: false,
      reason: `Error during validation: ${message} - proceeding optimistically`,
      canProceed: true,
    };
  }
}
