/**
 * Workflow Scheduling Activities
 * Activities for programmatically scheduling Temporal workflows
 */

import { getTemporalClient } from '../client';
import { temporalConfig } from '../../config/config';
import { EmailSyncSchedulingService, SiteWithCronStatus, SchedulingOptions } from '../services';
import { saveCronStatusActivity, CronStatusUpdate } from './cronActivities';

export interface ScheduleWorkflowResult {
  workflowId: string;
  scheduleId: string;
  success: boolean;
  error?: string;
}

/**
 * Schedule a single email sync workflow for a specific site
 * Uses Temporal client to create actual workflow schedules
 */
export async function scheduleEmailSyncWorkflowActivity(
  site: SiteWithCronStatus,
  options: SchedulingOptions = {}
): Promise<ScheduleWorkflowResult> {
  const { workflowId, scheduleId } = EmailSyncSchedulingService.generateWorkflowIds(site.id);
  
  console.log(`🚀 Scheduling email sync workflow for ${site.name}`);
  console.log(`   - Workflow ID: ${workflowId}`);
  console.log(`   - Schedule ID: ${scheduleId}`);
  
  try {
    // If dry run, just simulate the scheduling
    if (options.dryRun) {
      console.log('🧪 DRY RUN MODE - Simulating workflow scheduling');
      return {
        workflowId,
        scheduleId,
        success: true
      };
    }

    const client = await getTemporalClient();
    
    // Prepare workflow arguments
    const workflowArgs = [{
      userId: site.user_id,
      siteId: site.id,
      provider: site.email?.incomingServer?.includes('gmail') ? 'gmail' as const :
                site.email?.incomingServer?.includes('outlook') ? 'outlook' as const : 'imap' as const,
      since: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
      batchSize: 50,
      enableAnalysis: true, // Enable AI email analysis
      analysisLimit: 15     // Analyze up to 15 emails
    }];

    // Create immediate workflow execution (ASAP scheduling)
    console.log(`⚡ Starting immediate workflow execution for ${site.name}`);
    const handle = await client.workflow.start('syncEmailsWorkflow', {
      args: workflowArgs,
      workflowId,
      taskQueue: temporalConfig.taskQueue,
      workflowRunTimeout: '1 hour', // Email sync timeout
    });

    console.log(`✅ Successfully started workflow for ${site.name}`);
    console.log(`   - Workflow Handle: ${handle.workflowId}`);

    // Update cron status to reflect the scheduled workflow
    const nextRun = new Date(Date.now() + 60 * 60 * 1000); // Next run in 1 hour
    const cronUpdate: CronStatusUpdate = {
      siteId: site.id,
      workflowId,
      scheduleId,
      activityName: 'syncEmailsWorkflow',
      status: 'RUNNING',
      nextRun: nextRun.toISOString()
    };

    await saveCronStatusActivity(cronUpdate);

    return {
      workflowId,
      scheduleId,
      success: true
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Failed to schedule workflow for ${site.name}:`, errorMessage);

    // Save error status to cron table
    try {
      const cronUpdate: CronStatusUpdate = {
        siteId: site.id,
        workflowId,
        scheduleId,
        activityName: 'syncEmailsWorkflow',
        status: 'FAILED',
        errorMessage: errorMessage,
        retryCount: 1
      };

      await saveCronStatusActivity(cronUpdate);
    } catch (statusError) {
      console.error('❌ Failed to save error status:', statusError);
    }

    return {
      workflowId,
      scheduleId,
      success: false,
      error: errorMessage
    };
  }
}

/**
 * Schedule email sync workflows for multiple sites
 * Processes sites in parallel with optimal distribution
 */
export async function scheduleMultipleEmailSyncWorkflowsActivity(
  sites: SiteWithCronStatus[],
  options: SchedulingOptions = {}
): Promise<{
  scheduled: number;
  skipped: number;
  failed: number;
  results: ScheduleWorkflowResult[];
  errors: string[];
}> {
  console.log(`📅 Scheduling email sync workflows for ${sites.length} sites...`);
  
  const sitesToSchedule = sites.filter(site => site.shouldSchedule);
  const sitesToSkip = sites.filter(site => !site.shouldSchedule);
  
  console.log(`   - Sites to schedule: ${sitesToSchedule.length}`);
  console.log(`   - Sites to skip: ${sitesToSkip.length}`);

  const results: ScheduleWorkflowResult[] = [];
  const errors: string[] = [];
  let scheduled = 0;
  let failed = 0;

  // Log skipped sites
  for (const site of sitesToSkip) {
    console.log(`⏭️  Skipping ${site.name}: ${site.reason}`);
  }

  // If dry run, just simulate everything
  if (options.dryRun) {
    console.log('🧪 DRY RUN MODE - Simulating all workflow scheduling');
    
    for (const site of sitesToSchedule) {
      const { workflowId, scheduleId } = EmailSyncSchedulingService.generateWorkflowIds(site.id);
      results.push({
        workflowId,
        scheduleId,
        success: true
      });
      scheduled++;
    }

    return {
      scheduled,
      skipped: sitesToSkip.length,
      failed: 0,
      results,
      errors: []
    };
  }

  // Schedule workflows with staggered timing for optimal distribution
  console.log('⚡ Starting staggered workflow scheduling...');
  
  for (let i = 0; i < sitesToSchedule.length; i++) {
    const site = sitesToSchedule[i];
    
    try {
      // Stagger workflow starts by 5 seconds to avoid overwhelming the system
      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, 5000));
      }

      const result = await scheduleEmailSyncWorkflowActivity(site, options);
      results.push(result);

      if (result.success) {
        scheduled++;
        console.log(`✅ [${i + 1}/${sitesToSchedule.length}] Successfully scheduled: ${site.name}`);
      } else {
        failed++;
        const errorMsg = `Failed to schedule ${site.name}: ${result.error}`;
        errors.push(errorMsg);
        console.error(`❌ [${i + 1}/${sitesToSchedule.length}] ${errorMsg}`);
      }

    } catch (error) {
      failed++;
      const errorMsg = `Exception scheduling ${site.name}: ${error instanceof Error ? error.message : String(error)}`;
      errors.push(errorMsg);
      console.error(`❌ [${i + 1}/${sitesToSchedule.length}] ${errorMsg}`);
      
      // Add failed result
      const { workflowId, scheduleId } = EmailSyncSchedulingService.generateWorkflowIds(site.id);
      results.push({
        workflowId,
        scheduleId,
        success: false,
        error: errorMsg
      });
    }
  }

  // Summary
  console.log(`📊 Email sync workflow scheduling completed:`);
  console.log(`   - Scheduled: ${scheduled}`);
  console.log(`   - Skipped: ${sitesToSkip.length}`);
  console.log(`   - Failed: ${failed}`);
  console.log(`   - Total processed: ${sites.length}`);

  if (errors.length > 0) {
    console.log(`❌ Errors encountered:`);
    errors.forEach((error, index) => {
      console.log(`   ${index + 1}. ${error}`);
    });
  }

  return {
    scheduled,
    skipped: sitesToSkip.length,
    failed,
    results,
    errors
  };
}

/**
 * Create a recurring email sync schedule for a site
 * This creates a Temporal schedule that runs periodically (e.g., every hour)
 */
export async function createRecurringEmailSyncScheduleActivity(
  site: SiteWithCronStatus,
  cronExpression: string = '0 * * * *', // Every hour
  options: SchedulingOptions = {}
): Promise<ScheduleWorkflowResult> {
  const { workflowId, scheduleId } = EmailSyncSchedulingService.generateWorkflowIds(site.id);
  
  console.log(`🔄 Creating recurring email sync schedule for ${site.name}`);
  console.log(`   - Schedule ID: ${scheduleId}`);
  console.log(`   - Cron Expression: ${cronExpression}`);
  
  try {
    // If dry run, just simulate the scheduling
    if (options.dryRun) {
      console.log('🧪 DRY RUN MODE - Simulating recurring schedule creation');
      return {
        workflowId,
        scheduleId,
        success: true
      };
    }

    const client = await getTemporalClient();
    const scheduleClient = client.schedule as any;
    
    // Prepare workflow arguments
    const workflowArgs = [{
      userId: site.user_id,
      siteId: site.id,
      provider: site.email?.incomingServer?.includes('gmail') ? 'gmail' as const :
                site.email?.incomingServer?.includes('outlook') ? 'outlook' as const : 'imap' as const,
      since: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
      batchSize: 50,
      enableAnalysis: true, // Enable AI email analysis
      analysisLimit: 15     // Analyze up to 15 emails
    }];

    // Create schedule
    await scheduleClient.create({
      scheduleId,
      spec: {
        intervals: [{ every: cronExpression }],
      },
      action: {
        type: 'startWorkflow',
        workflowType: 'syncEmailsWorkflow',
        taskQueue: temporalConfig.taskQueue,
        args: workflowArgs,
      },
    });

    console.log(`✅ Successfully created recurring schedule for ${site.name}`);

    // Update cron status to reflect the scheduled workflow
    const nextRun = getNextRunTime(cronExpression);
    const cronUpdate: CronStatusUpdate = {
      siteId: site.id,
      workflowId: `${scheduleId}-recurring`,
      scheduleId,
      activityName: 'syncEmailsWorkflow',
      status: 'SCHEDULED',
      nextRun: nextRun.toISOString()
    };

    await saveCronStatusActivity(cronUpdate);

    return {
      workflowId: `${scheduleId}-recurring`,
      scheduleId,
      success: true
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Failed to create recurring schedule for ${site.name}:`, errorMessage);

    return {
      workflowId: `${scheduleId}-recurring`,
      scheduleId,
      success: false,
      error: errorMessage
    };
  }
}

/**
 * Calculate next run time based on cron expression
 * Simple implementation for common patterns
 */
function getNextRunTime(cronExpression: string): Date {
  // For "0 * * * *" (every hour), next run is at the top of the next hour
  if (cronExpression === '0 * * * *') {
    const now = new Date();
    const nextHour = new Date(now);
    nextHour.setHours(now.getHours() + 1, 0, 0, 0);
    return nextHour;
  }
  
  // Default to 1 hour from now for other patterns
  return new Date(Date.now() + 60 * 60 * 1000);
} 