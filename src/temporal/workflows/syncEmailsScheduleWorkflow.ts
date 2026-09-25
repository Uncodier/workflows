/**
 * Email Sync Schedule Workflow
 * Workflow to schedule email synchronization workflows for multiple sites
 */

import { patched, proxyActivities } from '@temporalio/workflow';
import type { Activities } from '../activities';
import type { SchedulingOptions, SiteWithCronStatus } from '../services';

// Define the activity interface and options
const { 
  logWorkflowExecutionActivity,
  fetchSitesActivity,
  scheduleMultipleEmailSyncWorkflowsActivity,
  batchSaveCronStatusActivity,
} = proxyActivities<Activities>({
  startToCloseTimeout: '5 minutes',
  retry: {
    maximumAttempts: 3,
  },
});

export interface SyncEmailsScheduleOptions extends SchedulingOptions {
  // Workflow-specific options can be added here in the future
  // Currently inherits all options from SchedulingOptions
  _placeholder?: never; // Placeholder to satisfy TypeScript/ESLint
}

/**
 * Workflow to schedule email synchronization workflows for multiple sites
 * 
 * @param options - Configuration options for email sync scheduling
 */
export async function syncEmailsScheduleWorkflow(
  options: SyncEmailsScheduleOptions = {}
): Promise<any> {
  const workflowId = `sync-emails-schedule-${Date.now()}`;
  const useSingleStatusOwner = patched('sync-emails-single-status-owner-v1');
  
  // Log workflow execution start
  await logWorkflowExecutionActivity({
    workflowId,
    workflowType: 'syncEmailsScheduleWorkflow',
    status: 'STARTED',
    input: options,
  });

  console.log('🚀 Starting email sync schedule workflow...');
  console.log('📋 Options:', JSON.stringify(options, null, 2));

  try {
    // Step 1: Fetch sites and their email sync status
    console.log('📂 Step 1: Fetching sites and email sync status...');
    const sitesWithStatus: SiteWithCronStatus[] = await fetchSitesActivity({
      ...options,
      minHoursBetweenSyncs: 1 // Check for syncs within the last hour
    });
    
    console.log(`✅ Retrieved ${sitesWithStatus.length} sites`);
    
    const sitesToSchedule = sitesWithStatus.filter(site => site.shouldSchedule);
    console.log(`📊 Sites to process: ${sitesToSchedule.length}`);

    // If dry run, show what would be scheduled without doing it
    if (options.dryRun) {
      console.log('🧪 DRY RUN MODE - No actual scheduling will occur');
      console.log(`📋 Sites that would be scheduled:`);
      
      sitesToSchedule.forEach(site => {
        console.log(`   - ${site.name} (${site.id}): ${site.reason}`);
      });

      // Log successful completion for dry run
      await logWorkflowExecutionActivity({
        workflowId,
        workflowType: 'syncEmailsScheduleWorkflow',
        status: 'COMPLETED',
        input: options,
        output: {
          success: true,
          dryRun: true,
          sitesAnalyzed: sitesWithStatus.length,
          sitesWouldSchedule: sitesToSchedule.length,
          sitesWouldSkip: sitesWithStatus.length - sitesToSchedule.length,
          sites: sitesToSchedule
        },
      });

      console.log('🎉 Dry run completed successfully');
      return {
        success: true,
        dryRun: true,
        sitesAnalyzed: sitesWithStatus.length,
        sitesWouldSchedule: sitesToSchedule.length,
        sitesWouldSkip: sitesWithStatus.length - sitesToSchedule.length,
        sites: sitesToSchedule
      };
    }

    // Step 2: Schedule email sync workflows for eligible sites
    console.log('📅 Step 2: Scheduling email sync workflows...');
    const schedulingResult = await scheduleMultipleEmailSyncWorkflowsActivity(sitesWithStatus, options);
    
    console.log(`✅ Email sync scheduling completed`);
    console.log(`📊 Results: ${schedulingResult.scheduled} scheduled, ${schedulingResult.skipped} skipped, ${schedulingResult.failed} failed`);

    if (!useSingleStatusOwner && schedulingResult.scheduled > 0) {
      const cronUpdates = schedulingResult.results
        .filter((scheduled) => scheduled.success)
        .map((scheduled) => ({
          siteId: sitesToSchedule.find((site) =>
            scheduled.workflowId.includes(site.id)
          )?.id || '',
          workflowId: scheduled.workflowId,
          scheduleId: scheduled.scheduleId,
          activityName: 'syncEmailsWorkflow',
          status: 'RUNNING',
          nextRun: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        }));

      if (cronUpdates.length > 0) {
        await batchSaveCronStatusActivity(cronUpdates);
      }
    }

    const result = {
      success: true,
      sitesAnalyzed: sitesWithStatus.length,
      sitesScheduled: schedulingResult.scheduled,
      sitesSkipped: schedulingResult.skipped,
      sitesFailed: schedulingResult.failed,
      errors: schedulingResult.errors,
      summary: {
        totalSites: sitesWithStatus.length,
        sitesNeedingSync: sitesToSchedule.length,
        sitesProcessed: sitesToSchedule.length,
        successfullyScheduled: schedulingResult.scheduled,
        skipped: schedulingResult.skipped,
        failed: schedulingResult.failed
      }
    };

    // Log successful completion
    await logWorkflowExecutionActivity({
      workflowId,
      workflowType: 'syncEmailsScheduleWorkflow',
      status: 'COMPLETED',
      input: options,
      output: result,
    });

    console.log('🎉 Email sync schedule workflow completed successfully');
    return result;

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    // Log workflow execution failure
    await logWorkflowExecutionActivity({
      workflowId,
      workflowType: 'syncEmailsScheduleWorkflow',
      status: 'FAILED',
      input: options,
      error: errorMessage,
    });

    console.error('❌ Email sync schedule workflow failed:', errorMessage);
    throw error;
  }
} 