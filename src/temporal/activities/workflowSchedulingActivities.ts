/**
 * Workflow Scheduling Activities
 * Activities for programmatically scheduling Temporal workflows
 */

import { getTemporalClient } from '../client';
import { temporalConfig } from '../../config/config';
import { EmailSyncSchedulingService, SiteWithCronStatus, SchedulingOptions } from '../services';
import { saveCronStatusActivity, CronStatusUpdate } from './cronActivities';
import { logWorkflowExecutionActivity } from './supabaseActivities';

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
    
    // Calculate 'since' timestamp based on last successful sync to avoid reprocessing emails
    let sinceTimestamp: Date;
    
    if (site.lastEmailSync?.last_run && site.lastEmailSync.status === 'COMPLETED') {
      // Use the timestamp from the last successful sync to get only new emails
      sinceTimestamp = new Date(site.lastEmailSync.last_run);
      console.log(`📧 Using last successful sync time: ${sinceTimestamp.toISOString()}`);
      console.log(`   - Will fetch emails since last completed sync to avoid reprocessing`);
    } else if (site.lastEmailSync?.last_run && site.lastEmailSync.status === 'FAILED') {
      // If previous sync failed, use that timestamp to avoid missing emails
      sinceTimestamp = new Date(site.lastEmailSync.last_run);
      console.log(`📧 Using last failed sync time: ${sinceTimestamp.toISOString()}`);
      console.log(`   - Retrying from last attempt to ensure no emails are missed`);
    } else {
      // No previous sync found, fetch emails from last 24 hours (initial sync)
      sinceTimestamp = new Date(Date.now() - 24 * 60 * 60 * 1000);
      console.log(`📧 No previous sync found, using last 24 hours: ${sinceTimestamp.toISOString()}`);
      console.log(`   - Initial sync will fetch recent emails`);
    }
    
    // Prepare workflow arguments
    const workflowArgs = [{
      userId: site.user_id,
      siteId: site.id,
      provider: site.email?.incomingServer?.includes('gmail') ? 'gmail' as const :
                site.email?.incomingServer?.includes('outlook') ? 'outlook' as const : 'imap' as const,
      since: sinceTimestamp, // Use calculated timestamp instead of hardcoded 24 hours
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
        cron: cronExpression
      },
      action: {
        type: 'startWorkflow',
        workflowType: 'syncEmailsWorkflow',
        taskQueue: temporalConfig.taskQueue,
        args: workflowArgs,
      },
      timeZone: 'UTC',
      policies: {
        catchupWindow: '5m',
        overlap: 'SKIP' as any,
        pauseOnFailure: false,
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
 * Execute a build campaigns workflow for a specific site (on-demand)
 * Creates campaigns based on existing segments for the site
 */
export async function executeBuildCampaignsWorkflowActivity(
  siteId: string,
  options: {
    userId?: string;
    agentId?: string;
    additionalCampaignData?: Record<string, any>;
    dryRun?: boolean;
  } = {}
): Promise<{
  workflowId: string;
  success: boolean;
  error?: string;
}> {
  const workflowId = `build-campaigns-${siteId}-${Date.now()}`;
  
  console.log(`🚀 Executing build campaigns workflow for site: ${siteId}`);
  console.log(`   - Workflow ID: ${workflowId}`);
  
  try {
    // If dry run, just simulate the execution
    if (options.dryRun) {
      console.log('🧪 DRY RUN MODE - Simulating build campaigns workflow execution');
      return {
        workflowId,
        success: true
      };
    }

    const client = await getTemporalClient();
    
    // Prepare workflow arguments
    const workflowArgs = [{
      siteId,
      userId: options.userId,
      agentId: options.agentId,
      additionalCampaignData: options.additionalCampaignData || {}
    }];

    // Start immediate workflow execution
    console.log(`⚡ Starting build campaigns workflow for site: ${siteId}`);
    const handle = await client.workflow.start('buildCampaignsWorkflow', {
      args: workflowArgs,
      workflowId,
      taskQueue: temporalConfig.taskQueue,
      workflowRunTimeout: '30 minutes',
    });

    console.log(`✅ Successfully started build campaigns workflow for site: ${siteId}`);
    console.log(`   - Workflow Handle: ${handle.workflowId}`);

    // Log workflow execution (not cron status since this is on-demand)
    await logWorkflowExecutionActivity({
      workflowType: 'buildCampaignsWorkflow',
      workflowId,
      status: 'STARTED',
      input: {
        siteId,
        userId: options.userId,
        agentId: options.agentId,
        additionalCampaignData: options.additionalCampaignData
      }
    });

    return {
      workflowId,
      success: true
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Failed to execute build campaigns workflow for site ${siteId}:`, errorMessage);

    // Log execution error
    try {
      await logWorkflowExecutionActivity({
        workflowType: 'buildCampaignsWorkflow',
        workflowId,
        status: 'FAILED',
        error: errorMessage,
        input: {
          siteId,
          userId: options.userId,
          agentId: options.agentId,
          additionalCampaignData: options.additionalCampaignData
        }
      });
    } catch (logError) {
      console.error('❌ Failed to log execution error:', logError);
    }

    return {
      workflowId,
      success: false,
      error: errorMessage
    };
  }
}

/**
 * Execute a build segments workflow for a specific site (on-demand)
 * Analyzes and creates segments for the site
 */
export async function executeBuildSegmentsWorkflowActivity(
  siteId: string,
  options: {
    segmentCount?: number;
    mode?: 'analyze' | 'create' | 'update';
    timeout?: number;
    userId?: string;
    includeScreenshot?: boolean;
    profitabilityMetrics?: string[];
    minConfidenceScore?: number;
    segmentAttributes?: string[];
    industryContext?: string;
    additionalInstructions?: string;
    aiProvider?: 'openai' | 'anthropic' | 'gemini';
    aiModel?: string;
    dryRun?: boolean;
  } = {}
): Promise<{
  workflowId: string;
  success: boolean;
  error?: string;
}> {
  const workflowId = `build-segments-${siteId}-${Date.now()}`;
  
  console.log(`🎯 Executing build segments workflow for site: ${siteId}`);
  console.log(`   - Workflow ID: ${workflowId}`);
  
  try {
    // If dry run, just simulate the execution
    if (options.dryRun) {
      console.log('🧪 DRY RUN MODE - Simulating build segments workflow execution');
      return {
        workflowId,
        success: true
      };
    }

    const client = await getTemporalClient();
    
    // Prepare workflow arguments
    const workflowArgs = [{
      siteId,
      segmentCount: options.segmentCount,
      mode: options.mode,
      timeout: options.timeout,
      userId: options.userId,
      includeScreenshot: options.includeScreenshot,
      profitabilityMetrics: options.profitabilityMetrics,
      minConfidenceScore: options.minConfidenceScore,
      segmentAttributes: options.segmentAttributes,
      industryContext: options.industryContext,
      additionalInstructions: options.additionalInstructions,
      aiProvider: options.aiProvider,
      aiModel: options.aiModel
    }];

    // Start immediate workflow execution
    console.log(`⚡ Starting build segments workflow for site: ${siteId}`);
    const handle = await client.workflow.start('buildSegmentsWorkflow', {
      args: workflowArgs,
      workflowId,
      taskQueue: temporalConfig.taskQueue,
      workflowRunTimeout: '1 hour',
    });

    console.log(`✅ Successfully started build segments workflow for site: ${siteId}`);
    console.log(`   - Workflow Handle: ${handle.workflowId}`);

    // Log workflow execution (not cron status since this is on-demand)
    await logWorkflowExecutionActivity({
      workflowType: 'buildSegmentsWorkflow',
      workflowId,
      status: 'STARTED',
      input: {
        siteId,
        segmentCount: options.segmentCount,
        mode: options.mode,
        timeout: options.timeout,
        userId: options.userId,
        includeScreenshot: options.includeScreenshot,
        profitabilityMetrics: options.profitabilityMetrics,
        minConfidenceScore: options.minConfidenceScore,
        segmentAttributes: options.segmentAttributes,
        industryContext: options.industryContext,
        additionalInstructions: options.additionalInstructions,
        aiProvider: options.aiProvider,
        aiModel: options.aiModel
      }
    });

    return {
      workflowId,
      success: true
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Failed to execute build segments workflow for site ${siteId}:`, errorMessage);

    // Log execution error
    try {
      await logWorkflowExecutionActivity({
        workflowType: 'buildSegmentsWorkflow',
        workflowId,
        status: 'FAILED',
        error: errorMessage,
        input: {
          siteId,
          segmentCount: options.segmentCount,
          mode: options.mode,
          timeout: options.timeout,
          userId: options.userId,
          includeScreenshot: options.includeScreenshot,
          profitabilityMetrics: options.profitabilityMetrics,
          minConfidenceScore: options.minConfidenceScore,
          segmentAttributes: options.segmentAttributes,
          industryContext: options.industryContext,
          additionalInstructions: options.additionalInstructions,
          aiProvider: options.aiProvider,
          aiModel: options.aiModel
        }
      });
    } catch (logError) {
      console.error('❌ Failed to log execution error:', logError);
    }

    return {
      workflowId,
      success: false,
      error: errorMessage
    };
  }
}

/**
 * Execute a build content workflow for a specific site (on-demand)
 * Generates AI-powered content recommendations for the site
 */
export async function executeBuildContentWorkflowActivity(
  siteId: string,
  options: {
    segmentId?: string;
    contentTypes?: string[];
    limit?: number;
    userId?: string;
    funnelStage?: 'all' | 'awareness' | 'consideration' | 'decision' | 'retention';
    topics?: string[];
    aiProvider?: 'openai' | 'anthropic' | 'gemini';
    aiModel?: string;
    timeout?: number;
    includeMetadata?: boolean;
    sortBy?: 'relevance' | 'date' | 'popularity';
    dryRun?: boolean;
  } = {}
): Promise<{
  workflowId: string;
  success: boolean;
  error?: string;
}> {
  const workflowId = `build-content-${siteId}-${Date.now()}`;
  
  console.log(`📝 Executing build content workflow for site: ${siteId}`);
  console.log(`   - Workflow ID: ${workflowId}`);
  
  try {
    // If dry run, just simulate the execution
    if (options.dryRun) {
      console.log('🧪 DRY RUN MODE - Simulating build content workflow execution');
      return {
        workflowId,
        success: true
      };
    }

    const client = await getTemporalClient();
    
    // Prepare workflow arguments
    const workflowArgs = [{
      siteId,
      segmentId: options.segmentId,
      contentTypes: options.contentTypes,
      limit: options.limit,
      userId: options.userId,
      funnelStage: options.funnelStage,
      topics: options.topics,
      aiProvider: options.aiProvider,
      aiModel: options.aiModel,
      timeout: options.timeout,
      includeMetadata: options.includeMetadata,
      sortBy: options.sortBy
    }];

    // Start immediate workflow execution
    console.log(`⚡ Starting build content workflow for site: ${siteId}`);
    const handle = await client.workflow.start('buildContentWorkflow', {
      args: workflowArgs,
      workflowId,
      taskQueue: temporalConfig.taskQueue,
      workflowRunTimeout: '45 minutes',
    });

    console.log(`✅ Successfully started build content workflow for site: ${siteId}`);
    console.log(`   - Workflow Handle: ${handle.workflowId}`);

    // Log workflow execution (not cron status since this is on-demand)
    await logWorkflowExecutionActivity({
      workflowType: 'buildContentWorkflow',
      workflowId,
      status: 'STARTED',
      input: {
        siteId,
        segmentId: options.segmentId,
        contentTypes: options.contentTypes,
        limit: options.limit,
        userId: options.userId,
        funnelStage: options.funnelStage,
        topics: options.topics,
        aiProvider: options.aiProvider,
        aiModel: options.aiModel,
        timeout: options.timeout,
        includeMetadata: options.includeMetadata,
        sortBy: options.sortBy
      }
    });

    return {
      workflowId,
      success: true
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Failed to execute build content workflow for site ${siteId}:`, errorMessage);

    // Log execution error
    try {
      await logWorkflowExecutionActivity({
        workflowType: 'buildContentWorkflow',
        workflowId,
        status: 'FAILED',
        error: errorMessage,
        input: {
          siteId,
          segmentId: options.segmentId,
          contentTypes: options.contentTypes,
          limit: options.limit,
          userId: options.userId,
          funnelStage: options.funnelStage,
          topics: options.topics,
          aiProvider: options.aiProvider,
          aiModel: options.aiModel,
          timeout: options.timeout,
          includeMetadata: options.includeMetadata,
          sortBy: options.sortBy
        }
      });
    } catch (logError) {
      console.error('❌ Failed to log execution error:', logError);
    }

    return {
      workflowId,
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