"use strict";
/**
 * Email Sync Schedule Workflow
 * Workflow to schedule email synchronization workflows for multiple sites
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncEmailsScheduleWorkflow = syncEmailsScheduleWorkflow;
const workflow_1 = require("@temporalio/workflow");
// Define the activity interface and options
const { logWorkflowExecutionActivity, fetchSitesActivity, scheduleMultipleEmailSyncWorkflowsActivity, batchSaveCronStatusActivity } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: '5 minutes',
    retry: {
        maximumAttempts: 3,
    },
});
/**
 * Workflow to schedule email synchronization workflows for multiple sites
 *
 * @param options - Configuration options for email sync scheduling
 */
async function syncEmailsScheduleWorkflow(options = {}) {
    const workflowId = `sync-emails-schedule-${Date.now()}`;
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
        const sitesWithStatus = await fetchSitesActivity({
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
        // Step 3: Update cron status records for successfully scheduled workflows
        if (schedulingResult.scheduled > 0) {
            console.log('📝 Step 3: Updating cron status records...');
            const successfulResults = schedulingResult.results.filter(result => result.success);
            const cronUpdates = successfulResults.map(result => ({
                siteId: sitesToSchedule.find(site => result.workflowId.includes(site.id))?.id || '',
                workflowId: result.workflowId,
                scheduleId: result.scheduleId,
                activityName: 'syncEmailsWorkflow',
                status: 'RUNNING',
                nextRun: new Date(Date.now() + 60 * 60 * 1000).toISOString() // Next run in 1 hour
            }));
            if (cronUpdates.length > 0) {
                await batchSaveCronStatusActivity(cronUpdates);
                console.log(`✅ Cron status records updated for ${cronUpdates.length} workflows`);
            }
        }
        else {
            console.log('⏭️  No workflows were scheduled, skipping cron status updates');
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
    }
    catch (error) {
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
