import { getTemporalClient } from '../client';
import { temporalConfig } from '../../config/config';
import { getSupabaseService } from '../services/supabaseService';
import { saveIcpMiningScheduledStatusActivity } from './icpMiningScheduledStatusActivity';
import { computeDelayedWorkflowRunTimeout } from '../utils/delayedExecutionTimeout';
import { generateDailyWorkflowId, DAILY_WORKFLOW_REUSE_POLICY } from '../utils/workflowIdHelper';
import { nextDistributedIcpRun } from '../utils/icpMiningScheduling';
import type { ScheduleWorkflowResult } from './workflowSchedulingActivities';
import { isIcpDispatcherEnabledActivity } from './icpDispatcherActivities';

/** Keep two daily slots ahead: central-scheduler jitter must not leave a day unplanned. */
export async function scheduleIcpMiningWorkflowsActivity(options: { parentScheduleId?: string } = {}): Promise<{
  scheduled: number; skipped: number; failed: number; results: ScheduleWorkflowResult[]; errors: string[];
}> {
  const summary = { scheduled: 0, skipped: 0, failed: 0, results: [] as ScheduleWorkflowResult[], errors: [] as string[] };
  try {
    // Also covers an old engine activity retried on a newly deployed worker.
    if (await isIcpDispatcherEnabledActivity()) return summary;
    const sites = await getSupabaseService().fetchSites();
    if (!sites?.length) return summary;
    const client = await getTemporalClient();
    const now = new Date();

    for (const site of sites) {
      for (let slot = 0; slot < 2; slot++) {
        let workflowId = `icp-mining-${site.id}`;
        try {
          const targetTime = new Date(nextDistributedIcpRun(site.id, now).getTime() + slot * 86400000);
          const executionDay = targetTime.toISOString().slice(0, 10);
          const delayMs = Math.max(0, targetTime.getTime() - Date.now());
          workflowId = generateDailyWorkflowId({ workflowType: 'icp-mining', siteId: site.id,
            dateStr: executionDay, isTimer: true });
          await client.workflow.start('delayedExecutionWorkflow', {
            workflowId,
            taskQueue: temporalConfig.taskQueue,
            workflowIdReusePolicy: DAILY_WORKFLOW_REUSE_POLICY,
            workflowRunTimeout: computeDelayedWorkflowRunTimeout(delayMs),
            args: [{
              delayMs,
              targetWorkflow: 'idealClientProfileMiningWorkflow',
              // Controls are deliberately read by the child after its timer, not snapshotted here.
              targetArgs: [{ site_id: site.id, userId: site.user_id, scheduleId: workflowId,
                additionalData: {
                  scheduledBy: 'activityPrioritizationEngine-icpMining',
                  scheduleType: 'icp-mining-distributed',
                  executionMode: 'timer-delayed-icp-mining',
                  executionDay, timezone: 'UTC', targetTimeUTC: targetTime.toISOString(), delayMs,
                  parentScheduleId: options.parentScheduleId,
                  dailyOperationsScheduleId: options.parentScheduleId,
                },
              }],
              siteName: site.name || 'Site', scheduledTime: targetTime.toISOString(),
              executionType: 'distributed-icp-mining',
            }],
          });
          // The second slot is coverage only. It must not replace the nearest run's status.
          if (slot === 0) {
            await saveIcpMiningScheduledStatusActivity({ siteId: site.id, workflowId, scheduleId: workflowId,
              nextRun: targetTime.toISOString() });
          }
          summary.scheduled++;
          summary.results.push({ workflowId, scheduleId: workflowId, success: true });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if ((error instanceof Error && error.name === 'WorkflowExecutionAlreadyStartedError')
            || message.includes('Workflow execution already started')) {
            // Do not overwrite RUNNING/COMPLETED cron status when the engine is retried.
            summary.skipped++;
            summary.results.push({ workflowId, scheduleId: workflowId, success: true });
          } else {
            summary.failed++;
            summary.errors.push(`Site ${site.id}: ${message}`);
            summary.results.push({ workflowId, scheduleId: workflowId, success: false, error: message });
          }
        }
      }
    }
  } catch (error) {
    summary.failed++;
    summary.errors.push(error instanceof Error ? error.message : String(error));
  }
  return summary;
}