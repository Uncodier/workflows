/**
 * Workflow Scheduling Activities
 * Activities for programmatically scheduling Temporal workflows
 */

import { getTemporalClient } from '../client';
import { temporalConfig } from '../../config/config';
import { EmailSyncSchedulingService, SiteWithCronStatus, SchedulingOptions } from '../services';
import { 
  saveCronStatusActivity, 
  CronStatusUpdate
} from './cronActivities';
import { logWorkflowExecutionActivity, checkSiteAnalysisActivity } from './supabaseActivities';
import { getSupabaseService } from '../services/supabaseService';

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
      workflowId: handle.workflowId,
      scheduleId,
      activityName: 'syncEmailsWorkflow',
      status: 'RUNNING',
      nextRun: nextRun.toISOString()
    };

    await saveCronStatusActivity(cronUpdate);

    return {
      workflowId: handle.workflowId,
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
        workflowId: workflowId,
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
      workflowId: workflowId,
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

    // Create schedule and capture the actual handle returned by Temporal
    const scheduleHandle = await scheduleClient.create({
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

    // Get the actual schedule ID from Temporal (should be the same as scheduleId, but using actual returned value)
    const actualScheduleId = scheduleHandle.scheduleId;
    
    console.log(`✅ Successfully created recurring schedule for ${site.name}`);
    console.log(`   - Temporal Schedule ID: ${actualScheduleId}`);

    // Update cron status to reflect the scheduled workflow using actual Temporal IDs
    const nextRun = getNextRunTime(cronExpression);
    const cronUpdate: CronStatusUpdate = {
      siteId: site.id,
      workflowId: `${actualScheduleId}-recurring`, // Use actual Temporal schedule ID
      scheduleId: actualScheduleId, // Use actual Temporal schedule ID
      activityName: 'syncEmailsWorkflow',
      status: 'SCHEDULED',
      nextRun: nextRun.toISOString()
    };

    await saveCronStatusActivity(cronUpdate);

    return {
      workflowId: `${actualScheduleId}-recurring`, // Use actual Temporal schedule ID
      scheduleId: actualScheduleId, // Use actual Temporal schedule ID
      success: true
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Failed to create recurring schedule for ${site.name}:`, errorMessage);

    return {
      workflowId: `${scheduleId}-recurring`, // Keep original generated ID in error case
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
      workflowId: handle.workflowId,
      status: 'STARTED',
      input: {
        siteId,
        userId: options.userId,
        agentId: options.agentId,
        additionalCampaignData: options.additionalCampaignData
      }
    });

    return {
      workflowId: handle.workflowId,
      success: true
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Failed to execute build campaigns workflow for site ${siteId}:`, errorMessage);

    // Log execution error
    try {
      await logWorkflowExecutionActivity({
        workflowType: 'buildCampaignsWorkflow',
        workflowId: workflowId,
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
      workflowId: workflowId,
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

/**
 * Execute daily stand up workflows for sites with active business hours
 * 
 * @param options.dryRun - If true, only simulates execution without running real workflows
 * @param options.testMode - If true, adds safety checks and limits to prevent production issues
 * @param options.maxSites - Maximum number of sites to process (useful for testing)
 * @param options.businessHoursAnalysis - Business hours analysis from prioritization engine for filtering sites
 */
export async function executeDailyStandUpWorkflowsActivity(
  options: { 
    dryRun?: boolean; 
    testMode?: boolean; 
    maxSites?: number;
    businessHoursAnalysis?: any;
  } = {}
): Promise<{
  scheduled: number;
  skipped: number;
  failed: number;
  results: ScheduleWorkflowResult[];
  errors: string[];
  testInfo?: any;
}> {
  console.log('🌅 Starting Daily Stand Up workflow execution...');
  
  const { businessHoursAnalysis } = options;
  
  if (businessHoursAnalysis) {
    console.log('📋 BUSINESS HOURS FILTERING ENABLED:');
    console.log(`   - Sites with business_hours: ${businessHoursAnalysis.sitesWithBusinessHours}`);
    console.log(`   - Sites open today: ${businessHoursAnalysis.sitesOpenToday}`);
    console.log(`   - Will execute for filtered sites only`);
  } else {
    console.log('📋 FALLBACK MODE - No business hours filtering:');
    console.log('   - Will execute for all sites (legacy behavior)');
  }
  
  // Safety checks for test mode
  if (options.testMode) {
    console.log('🧪 TEST MODE ENABLED - Extra safety checks activated');
    options.dryRun = true; // Force dry run in test mode
    options.maxSites = options.maxSites || 3; // Limit to 3 sites max in test mode
  }
  
  if (options.dryRun) {
    console.log('🔬 DRY RUN MODE - No real workflows will be executed');
  }
  
  const results: ScheduleWorkflowResult[] = [];
  const errors: string[] = [];
  let scheduled = 0;
  let failed = 0;
  const testInfo: any = {
    mode: options.dryRun ? 'DRY_RUN' : 'PRODUCTION',
    testMode: options.testMode,
    businessHoursFiltering: !!businessHoursAnalysis,
    startTime: new Date().toISOString(),
    endTime: '',
    duration: '',
    totalSites: 0,
    maxSites: options.maxSites || 0,
    siteNames: []
  };

  try {
    const supabaseService = getSupabaseService();
    
    // Check database connection
    const isConnected = await supabaseService.getConnectionStatus();
    if (!isConnected) {
      throw new Error('Database not available for workflow execution');
    }

    let sitesToProcess: any[] = [];

    if (businessHoursAnalysis && businessHoursAnalysis.openSites.length > 0) {
      // FILTERED MODE: Only process sites with active business hours
      console.log('🔍 Using business hours filtering...');
      
      const allSites = await supabaseService.fetchSites();
      const openSiteIds = businessHoursAnalysis.openSites.map((site: any) => site.siteId);
      
      sitesToProcess = allSites.filter(site => openSiteIds.includes(site.id));
      
      console.log(`✅ Found ${allSites.length} total sites, filtered to ${sitesToProcess.length} sites with active business hours`);
      
      if (businessHoursAnalysis.openSites.length > 0) {
        console.log('📊 Sites to process:');
        businessHoursAnalysis.openSites.forEach((site: any) => {
          console.log(`   • Site ${site.siteId}: ${site.businessHours.open} - ${site.businessHours.close}`);
        });
      }
    } else {
      // FALLBACK MODE: Process all sites (legacy behavior)
      console.log('⏮️ Using fallback mode - processing all sites...');
      sitesToProcess = await supabaseService.fetchSites();
      console.log(`✅ Found ${sitesToProcess.length} sites total (fallback mode)`);
    }

    // Apply maxSites limit if specified
    if (options.maxSites && options.maxSites > 0) {
      sitesToProcess = sitesToProcess.slice(0, options.maxSites);
      console.log(`🔢 Limited to first ${sitesToProcess.length} sites for testing`);
    }

    if (sitesToProcess.length === 0) {
      console.log('⚠️ No sites to process');
      return { 
        scheduled: 0, 
        skipped: 0, 
        failed: 0, 
        results: [], 
        errors: [],
        testInfo 
      };
    }

    testInfo.totalSites = sitesToProcess.length;
    testInfo.siteNames = sitesToProcess.map(s => s.name);

    // Execute daily stand up workflow for each filtered site
    for (const site of sitesToProcess) {
      try {
        console.log(`\n📋 Executing Daily Stand Up for site: ${site.name} (${site.id})`);

        if (options.dryRun) {
          console.log(`🧪 DRY RUN: Would execute dailyStandUpWorkflow for ${site.name}`);
          scheduled++;
          continue;
        }

        // Determine execution mode based on business hours analysis
        const hasBusinessHours = businessHoursAnalysis && businessHoursAnalysis.openSites.length > 0;
        const executeReason = hasBusinessHours ? 'business-hours-scheduled' : 'fallback-execution';
        const scheduleType = hasBusinessHours ? 'business-hours' : 'immediate';
        
        // Execute the daily stand up workflow with proper scheduling mode
        const workflowResult = await executeDailyStandUpWorkflow(site, {
          executeReason,
          scheduleType,
          businessHoursAnalysis,
          scheduledBy: 'activityPrioritizationEngine'
        });
        
        results.push(workflowResult);

        if (workflowResult.success) {
          scheduled++;
          console.log(`✅ Successfully executed Daily Stand Up for ${site.name}`);
        } else {
          failed++;
          const error = `Failed to execute Daily Stand Up for ${site.name}: ${workflowResult.error}`;
          errors.push(error);
          console.error(`❌ ${error}`);
        }

      } catch (siteError) {
        failed++;
        const errorMsg = `Error executing Daily Stand Up for site ${site.name}: ${siteError instanceof Error ? siteError.message : String(siteError)}`;
        errors.push(errorMsg);
        console.error(`❌ ${errorMsg}`);
      }
    }

    testInfo.endTime = new Date().toISOString();
    testInfo.duration = `${Date.now() - new Date(testInfo.startTime).getTime()}ms`;
    
    console.log(`\n📊 Daily Stand Up execution completed:`);
    console.log(`   ✅ Executed: ${scheduled} sites`);
    console.log(`   ⏭️ Skipped: 0 sites`);
    console.log(`   ❌ Failed: ${failed} sites`);
    console.log(`   🔍 Business hours filtering: ${businessHoursAnalysis ? 'ENABLED' : 'DISABLED'}`);
    
    if (options.dryRun) {
      console.log(`⏰ This was a dry run - no actual workflows were executed`);
    }
    
    return { scheduled, skipped: 0, failed, results, errors, testInfo };

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Failed to execute Daily Stand Up workflows: ${errorMessage}`);
    testInfo.error = errorMessage;
    testInfo.endTime = new Date().toISOString();
    return { 
      scheduled: 0, 
      skipped: 0, 
      failed: 1, 
      results: [], 
      errors: [errorMessage],
      testInfo 
    };
  }
}

/**
 * Execute daily stand up workflow for a single site
 */
async function executeDailyStandUpWorkflow(
  site: any, 
  executionOptions: {
    executeReason: string;
    scheduleType: string;
    businessHoursAnalysis?: any;
    scheduledBy: string;
    parentScheduleId?: string;
  }
): Promise<ScheduleWorkflowResult> {
  const workflowId = `daily-standup-${site.id}-${Date.now()}`;

  try {
    const client = await getTemporalClient();
    
    console.log(`🚀 Executing Daily Stand Up workflow for ${site.name}`);
    console.log(`   Schedule type: ${executionOptions.scheduleType}`);
    console.log(`   Execute reason: ${executionOptions.executeReason}`);
    
    const handle = await client.workflow.start('dailyStandUpWorkflow', {
      args: [{
        site_id: site.id,
        userId: site.user_id,
        additionalData: {
          scheduledBy: executionOptions.scheduledBy,
          executeReason: executionOptions.executeReason,
          scheduleType: executionOptions.scheduleType,
          scheduleTime: executionOptions.scheduleType === 'business-hours' ? 'business-hours-based' : 'immediate',
          executionDay: new Date().toLocaleDateString('en-US', { weekday: 'long' }),
          timezone: 'UTC',
          executionMode: executionOptions.scheduleType === 'business-hours' ? 'scheduled' : 'direct',
          businessHoursAnalysis: executionOptions.businessHoursAnalysis,
          parentScheduleId: executionOptions.parentScheduleId,
          dailyOperationsScheduleId: executionOptions.parentScheduleId // Also add as alias for clarity
        }
      }],
      taskQueue: temporalConfig.taskQueue,
      workflowId: workflowId,
    });
    
    console.log(`✅ Daily Stand Up workflow started for ${site.name}`);
    console.log(`   Workflow ID: ${handle.workflowId}`);
    
    return { workflowId: handle.workflowId, scheduleId: executionOptions.scheduleType, success: true };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Failed to execute Daily Stand Up workflow for ${site.name}: ${errorMessage}`);
    return { workflowId: workflowId, scheduleId: executionOptions.scheduleType, success: false, error: errorMessage };
  }
}

// Removed calculateNextDailyStandUpTime function as it's not used

// Removed isValidBusinessDay function as it's not used

/**
 * Schedule Daily Operations Workflow for later execution
 * Creates a Temporal schedule to run dailyOperationsWorkflow at a specific time
 */
export async function scheduleDailyOperationsWorkflowActivity(
  scheduledTime: string, // Format: "HH:MM" (e.g., "09:00")
  businessHoursAnalysis: any,
  options: { timezone?: string } = {}
): Promise<ScheduleWorkflowResult> {
  const { timezone = 'America/Mexico_City' } = options;
  
  console.log(`📅 Scheduling Daily Operations Workflow for ${scheduledTime}`);
  console.log(`   - Timezone: ${timezone}`);
  console.log(`   - Target time: ${scheduledTime}`);
  
      try {
    const client = await getTemporalClient();
    const scheduleClient = client.schedule as any;
    
    // Parse the target time
    const [hours, minutes] = scheduledTime.split(':').map(Number);
    
    const nowUTC = new Date();
    
    // Step 1: Get current time in target timezone (Mexico)
    const timezoneOffset = timezone === 'America/Mexico_City' ? 6 : 0;
    const nowLocal = new Date(nowUTC.getTime() - (timezoneOffset * 60 * 60 * 1000));
    const localDateStr = nowLocal.toISOString().split('T')[0];
    
    console.log(`   - Current time (UTC): ${nowUTC.toISOString()}`);
    console.log(`   - Current ${timezone} time: ${nowLocal.getUTCHours().toString().padStart(2, '0')}:${nowLocal.getUTCMinutes().toString().padStart(2, '0')} on ${localDateStr}`);
    
    // Step 2: Create target time for "today" in local timezone
    const targetLocalToday = new Date(nowLocal);
    targetLocalToday.setUTCHours(hours, minutes, 0, 0);
    
    console.log(`   - Target ${timezone} time TODAY (${localDateStr}): ${targetLocalToday.getUTCHours().toString().padStart(2, '0')}:${targetLocalToday.getUTCMinutes().toString().padStart(2, '0')}`);
    
    // Step 3: Check if target time already passed in local timezone
    const targetAlreadyPassed = targetLocalToday <= nowLocal;
    
    // Step 4: Determine final target date (today or tomorrow in local timezone)
    let finalTargetLocal: Date;
    let scheduleForTomorrow: boolean;
    
    if (targetAlreadyPassed) {
      // Schedule for tomorrow in local timezone
      finalTargetLocal = new Date(targetLocalToday);
      finalTargetLocal.setUTCDate(finalTargetLocal.getUTCDate() + 1);
      scheduleForTomorrow = true;
      console.log(`   ⏰ Target time already passed in ${timezone} TODAY, scheduling for TOMORROW`);
    } else {
      // Schedule for today in local timezone
      finalTargetLocal = targetLocalToday;
      scheduleForTomorrow = false;
      console.log(`   ⏰ Target time hasn't passed in ${timezone} TODAY, scheduling for TODAY`);
    }
    
    const finalLocalDateStr = finalTargetLocal.toISOString().split('T')[0];
    console.log(`   - Final target ${timezone} time: ${finalTargetLocal.getUTCHours().toString().padStart(2, '0')}:${finalTargetLocal.getUTCMinutes().toString().padStart(2, '0')} on ${finalLocalDateStr}`);
    
    // Step 5: Convert final local time to UTC for scheduling
    const finalTargetUTC = new Date(finalTargetLocal.getTime() + (timezoneOffset * 60 * 60 * 1000));
    console.log(`   - Final target UTC time: ${finalTargetUTC.toISOString()}`);
    
    // Create unique schedule ID with the actual date we're scheduling for
    const scheduleId = `daily-operations-${finalLocalDateStr}-${scheduledTime.replace(':', '')}`;
    const workflowId = `daily-operations-scheduled-${Date.now()}`;
    
    console.log(`   - Schedule ID: ${scheduleId}`);
    console.log(`   - Scheduling for date: ${finalLocalDateStr}`);
    
    // Create cron expression for the specific time on the target date
    // Format: "minute hour day month dayOfWeek"
    const cronExpression = `${minutes} ${hours} ${finalTargetUTC.getUTCDate()} ${finalTargetUTC.getUTCMonth() + 1} *`;
    
    console.log(`   - Cron Expression: ${cronExpression}`);
    console.log(`   - Final target UTC datetime: ${finalTargetUTC.toISOString()}`);
    
    // Prepare workflow arguments
    const workflowArgs = [{ businessHoursAnalysis }];

    // Create the schedule and capture the actual handle returned by Temporal
    const scheduleHandle = await scheduleClient.create({
      scheduleId,
      spec: {
        cron: cronExpression
      },
      action: {
        type: 'startWorkflow',
        workflowType: 'dailyOperationsWorkflow',
        taskQueue: temporalConfig.taskQueue,
        args: workflowArgs,
        workflowId: `${workflowId}-execution`,
      },
      timeZone: timezone,
      policies: {
        catchupWindow: '5m',
        overlap: 'SKIP' as any,
        pauseOnFailure: false,
      },
      state: {
        note: `Scheduled daily operations for ${scheduledTime} on ${finalLocalDateStr} (${timezone})`,
        paused: false,
      },
    });

    // Get the actual schedule ID from Temporal
    const actualScheduleId = scheduleHandle.scheduleId;

    const executionMessage = scheduleForTomorrow ? 
      `Will execute TOMORROW (${finalLocalDateStr}) at ${scheduledTime} ${timezone}` :
      `Will execute TODAY (${finalLocalDateStr}) at ${scheduledTime} ${timezone}`;
      
    console.log(`✅ Successfully scheduled Daily Operations workflow`);
    console.log(`   - ${executionMessage}`);
    console.log(`   - Temporal Schedule ID: ${actualScheduleId}`);
    
    // Update cron status to reflect the scheduled workflow using actual Temporal IDs
    const cronUpdate: CronStatusUpdate = {
      siteId: 'global', // This is a global schedule
      workflowId: actualScheduleId, // Use actual Temporal schedule ID
      scheduleId: actualScheduleId, // Use actual Temporal schedule ID
      activityName: 'dailyOperationsWorkflow',
      status: 'SCHEDULED',
      nextRun: finalTargetUTC.toISOString(),
    };
    
    await saveCronStatusActivity(cronUpdate);

    return {
      workflowId: actualScheduleId, // Use actual Temporal schedule ID
      scheduleId: actualScheduleId, // Use actual Temporal schedule ID
      success: true
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Failed to schedule Daily Operations workflow: ${errorMessage}`);
    
    const failedId = `failed-${Date.now()}`;
    return {
      workflowId: failedId,
      scheduleId: failedId,
      success: false,
      error: errorMessage
    };
  }
}

/**
 * Schedule Daily Stand Up Workflows for individual sites using TIMERS
 * Creates delayed workflow executions for sites with business_hours OR weekday fallback
 * Uses Temporal timers instead of schedules for one-time executions
 * WEEKEND RESTRICTION: sites without business_hours are skipped on weekends (Fri/Sat)
 * WEEKDAY FALLBACK: sites without business_hours use 09:00 fallback (Sun-Thu)
 */
export async function scheduleIndividualDailyStandUpsActivity(
  businessHoursAnalysis: any,
  options: { timezone?: string; parentScheduleId?: string } = {}
): Promise<{
  scheduled: number;
  failed: number;
  results: ScheduleWorkflowResult[];
  errors: string[];
}> {
  const { timezone = 'America/Mexico_City' } = options;
  
  console.log(`📅 Scheduling individual Daily Stand Up workflows using TIMERS`);
  console.log(`   - Default timezone: ${timezone}`);
  console.log(`   - Sites with business_hours: ${businessHoursAnalysis.openSites?.length || 0}`);
  
  const results: ScheduleWorkflowResult[] = [];
  const errors: string[] = [];
  let scheduled = 0;
  let failed = 0;

  try {
    const client = await getTemporalClient();
    const supabaseService = getSupabaseService();
    
    // Get ALL sites from database
    const allSites = await supabaseService.fetchSites();
    console.log(`   - Total sites in database: ${allSites.length}`);
    
    if (!allSites || allSites.length === 0) {
      console.log('⚠️ No sites found in database');
      return { scheduled: 0, failed: 0, results: [], errors: [] };
    }

    // Create a map of sites with business hours for quick lookup
    const sitesWithBusinessHours = new Map();
    if (businessHoursAnalysis.openSites) {
      businessHoursAnalysis.openSites.forEach((site: any) => {
        sitesWithBusinessHours.set(site.siteId, site.businessHours);
      });
    }
    
    // Determine if fallback should be used based on day of week
    const currentDay = new Date().getDay(); // 0=Sunday, 1=Monday, etc.
    const isWeekend = currentDay === 0 || currentDay === 6; // Sunday = 0, Saturday = 6
    const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][currentDay];
    
    console.log(`   - Current day: ${dayName} (${currentDay})`);
    console.log(`   - Is weekend: ${isWeekend}`);
    console.log(`   - Fallback policy: ${isWeekend ? 'NO FALLBACK (weekend)' : 'FALLBACK ALLOWED (weekday)'}`);
    
    // Process sites with different logic for weekends vs weekdays
    for (const site of allSites as any[]) {
      try {
        console.log(`\n📋 Processing site: ${site.name || 'Unnamed'} (${site.id})`);
        
        // Check if this site has business_hours
        const businessHours = sitesWithBusinessHours.get(site.id);
        
        let scheduledTime: string;
        let siteTimezone: string;
        let businessHoursSource: string;
        
        if (businessHours) {
          // Site HAS business_hours - use them
          scheduledTime = businessHours.open; // e.g., "09:00"
          siteTimezone = businessHours.timezone || timezone;
          businessHoursSource = 'database-configured';
          console.log(`   ✅ Has business_hours: ${businessHours.open} - ${businessHours.close} ${siteTimezone}`);
        } else if (!isWeekend) {
          // Site DOES NOT have business_hours - use fallback ONLY on weekdays
          scheduledTime = "09:00"; // Default fallback time
          siteTimezone = timezone; // Default timezone
          businessHoursSource = 'fallback-weekday';
          console.log(`   ⚠️ No business_hours found - using WEEKDAY FALLBACK: ${scheduledTime} ${siteTimezone}`);
        } else {
          // Weekend: NO fallback for sites without business_hours
          console.log(`   ⏭️ SKIPPING - No business_hours configured and weekend (no fallback)`);
          continue;
        }
        
        console.log(`   - Scheduled time: ${scheduledTime}`);
        console.log(`   - Timezone: ${siteTimezone}`);
        console.log(`   - Business hours source: ${businessHoursSource}`);
        
        // Parse the target time
        const [hours, minutes] = scheduledTime.split(':').map(Number);
        
        const nowUTC = new Date();
        const timezoneOffset = siteTimezone === 'America/Mexico_City' ? 6 : 0;
        
        // Calculate current time in site's timezone
        const nowLocal = new Date(nowUTC.getTime() - (timezoneOffset * 60 * 60 * 1000));
        
        // Create target time for "today" in site's timezone
        const targetLocalToday = new Date(nowLocal);
        targetLocalToday.setUTCHours(hours, minutes, 0, 0);
        
        // Check if target time already passed in site's timezone
        const targetAlreadyPassed = targetLocalToday <= nowLocal;
        
        // Determine final target date (today or tomorrow in site's timezone)
        let finalTargetLocal: Date;
        
        if (targetAlreadyPassed) {
          finalTargetLocal = new Date(targetLocalToday);
          finalTargetLocal.setUTCDate(finalTargetLocal.getUTCDate() + 1);
          console.log(`   ⏰ Target time already passed, scheduling for TOMORROW`);
        } else {
          finalTargetLocal = targetLocalToday;
          console.log(`   ⏰ Target time hasn't passed, scheduling for TODAY`);
        }
        
        const finalLocalDateStr = finalTargetLocal.toISOString().split('T')[0];
        const finalTargetUTC = new Date(finalTargetLocal.getTime() + (timezoneOffset * 60 * 60 * 1000));
        
        console.log(`   - Final target: ${finalTargetLocal.getUTCHours().toString().padStart(2, '0')}:${finalTargetLocal.getUTCMinutes().toString().padStart(2, '0')} ${siteTimezone} on ${finalLocalDateStr}`);
        console.log(`   - Final target UTC: ${finalTargetUTC.toISOString()}`);
        
        // Calculate delay in milliseconds from now
        const now = new Date();
        const delayMs = finalTargetUTC.getTime() - now.getTime();
        
        if (delayMs <= 0) {
          console.log(`   ⚠️ Target time is in the past, executing immediately`);
        } else {
          const delayHours = delayMs / (1000 * 60 * 60);
          console.log(`   ⏰ Will execute in ${delayHours.toFixed(2)} hours`);
        }
        
        // Create unique workflow ID for this site with better uniqueness
        const uniqueHash = Math.random().toString(36).substring(2, 15); // 13 character random string
        const dateSpecificId = `daily-standup-timer-${site.id}-${finalLocalDateStr}-${scheduledTime.replace(':', '')}-${uniqueHash}`;
        
        console.log(`   - Workflow ID: ${dateSpecificId}`);
        console.log(`   - Delay: ${delayMs}ms (${(delayMs / 1000 / 60).toFixed(1)} minutes)`);
        
        // Prepare workflow arguments for dailyStandUpWorkflow
        const workflowArgs = [{
          site_id: site.id,
          userId: site.user_id,
          additionalData: {
            scheduledBy: 'activityPrioritizationEngine-timerBased',
            executeReason: `${businessHoursSource}-${scheduledTime}`,
            scheduleType: businessHoursSource,
            scheduleTime: `${scheduledTime} ${siteTimezone}`,
            executionDay: finalLocalDateStr,
            timezone: siteTimezone,
            executionMode: 'timer-delayed',
            businessHours: businessHours || { 
              open: scheduledTime, 
              close: '18:00', 
              enabled: true, 
              timezone: siteTimezone, 
              source: businessHoursSource 
            },
            siteName: site.name || `Site ${site.id.substring(0, 8)}`,
            fallbackUsed: !businessHours,
            delayMs,
            targetTimeUTC: finalTargetUTC.toISOString(),
            workflowVersion: '2.0', // Add version tracking
            createdAt: new Date().toISOString(),
            parentScheduleId: options.parentScheduleId,
            dailyOperationsScheduleId: options.parentScheduleId // Also add as alias for clarity
          }
        }];

        // Start the DELAYED workflow and capture the actual handle returned by Temporal
        try {
          const workflowHandle = await client.workflow.start('delayedExecutionWorkflow', {
            args: [{
              delayMs: Math.max(delayMs, 0), // Ensure non-negative delay
              targetWorkflow: 'dailyStandUpWorkflow',
              targetArgs: workflowArgs,
              siteName: site.name || 'Site',
              scheduledTime: `${scheduledTime} ${siteTimezone}`,
              executionType: 'timer-based-standup'
            }],
            taskQueue: temporalConfig.taskQueue,
            workflowId: dateSpecificId,
            workflowRunTimeout: '48h', // Allow up to 48 hours for the delay
          });

          // Get the actual workflow ID from Temporal
          const actualWorkflowId = workflowHandle.workflowId;

          console.log(`✅ Successfully scheduled Daily Stand Up with TIMER for ${site.name || 'Site'}`);
          console.log(`   - Will execute at: ${scheduledTime} ${siteTimezone} on ${finalLocalDateStr}`);
          console.log(`   - Business hours source: ${businessHoursSource}`);
          console.log(`   - Temporal Workflow ID: ${actualWorkflowId}`);
          console.log(`   - Using TIMER approach instead of schedule`);

          // Update cron status to reflect the scheduled workflow using actual Temporal IDs
          const cronUpdate: CronStatusUpdate = {
            siteId: site.id,
            workflowId: actualWorkflowId, // Use actual Temporal workflow ID
            scheduleId: dateSpecificId, // Use dateSpecificId as scheduleId for timers
            activityName: 'dailyStandUpWorkflow-timer',
            status: 'SCHEDULED',
            nextRun: finalTargetUTC.toISOString(),
          };
          
          await saveCronStatusActivity(cronUpdate);

          results.push({
            workflowId: actualWorkflowId, // Use actual Temporal workflow ID
            scheduleId: dateSpecificId,
            success: true
          });
          
          scheduled++;
          
        } catch (startError) {
          // If we get a "workflow already started" error, we need to handle it gracefully
          if (startError instanceof Error && startError.message.includes('Workflow execution already started')) {
            console.log(`   ⚠️ Workflow already exists for site ${site.id}, this is expected for timer-based workflows`);
            console.log(`   📋 Existing workflow is likely still running or completed recently`);
            console.log(`   🔄 This can happen if the activity prioritization engine runs multiple times`);
            
            // Instead of failing, we'll consider this a "success" since the workflow is already scheduled
            // But we'll mark it as a special case in the results
            results.push({
              workflowId: dateSpecificId,
              scheduleId: dateSpecificId,
              success: true,
              error: `Workflow already exists - likely duplicate execution detected`
            });
            
            scheduled++; // Count as scheduled since a workflow exists
            
            console.log(`   ✅ Handled duplicate workflow gracefully for ${site.name || 'Site'}`);
            console.log(`   📊 This prevents the "Workflow execution already started" error`);
            
            continue; // Skip to next site
          } else {
            // Re-throw other errors
            throw startError;
          }
        }

      } catch (siteError) {
        const errorMessage = siteError instanceof Error ? siteError.message : String(siteError);
        console.error(`❌ Failed to schedule Daily Stand Up for site ${site.id}: ${errorMessage}`);
        
        errors.push(`Site ${site.id}: ${errorMessage}`);
        failed++;
        
        results.push({
          workflowId: `failed-${site.id}-${Date.now()}`,
          scheduleId: `failed-${site.id}-${Date.now()}`,
          success: false,
          error: errorMessage
        });
      }
    }

    console.log(`\n📊 Individual Daily Stand Up TIMER scheduling completed:`);
    console.log(`   ✅ Scheduled: ${scheduled} sites`);
    console.log(`   ❌ Failed: ${failed} sites`);
    console.log(`   🎯 Using TIMER-based approach for reliable one-time execution`);
    console.log(`   📅 Each site will execute at their specific business hours`);

    return { scheduled, failed, results, errors };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Failed to schedule individual Daily Stand Ups: ${errorMessage}`);
    
    return {
      scheduled: 0,
      failed: 1,
      results: [],
      errors: [errorMessage]
    };
  }
}

/**
 * Schedule Site Analysis Workflows for individual sites using TIMERS
 * Creates delayed workflow executions for sites with business_hours OR weekday fallback
 * AND that haven't had their initial analysis
 * Uses Temporal timers instead of schedules for one-time executions
 * WEEKEND RESTRICTION: sites without business_hours are skipped on weekends (Fri/Sat)
 * WEEKDAY FALLBACK: sites without business_hours use 09:00 fallback (Sun-Thu)
 * EXECUTES 1 HOUR BEFORE DAILY STANDUP to prepare analysis data
 */
export async function scheduleIndividualSiteAnalysisActivity(
  businessHoursAnalysis: any,
  options: { timezone?: string; parentScheduleId?: string } = {}
): Promise<{
  scheduled: number;
  skipped: number;
  failed: number;
  results: ScheduleWorkflowResult[];
  errors: string[];
}> {
  const { timezone = 'America/Mexico_City' } = options;
  
  console.log(`🔍 Scheduling individual Site Analysis workflows using TIMERS`);
  console.log(`   - Default timezone: ${timezone}`);
  console.log(`   - Sites with business_hours: ${businessHoursAnalysis.openSites?.length || 0}`);
  
  const results: ScheduleWorkflowResult[] = [];
  const errors: string[] = [];
  let scheduled = 0;
  let skipped = 0;
  let failed = 0;

  try {
    const client = await getTemporalClient();
    const supabaseService = getSupabaseService();
    
    // Get ALL sites from database
    const allSites = await supabaseService.fetchSites();
    console.log(`   - Total sites in database: ${allSites.length}`);
    
    if (!allSites || allSites.length === 0) {
      console.log('⚠️ No sites found in database');
      return { scheduled: 0, skipped: 0, failed: 0, results: [], errors: [] };
    }

    // Create a map of sites with business hours for quick lookup
    const sitesWithBusinessHours = new Map();
    if (businessHoursAnalysis.openSites) {
      businessHoursAnalysis.openSites.forEach((site: any) => {
        sitesWithBusinessHours.set(site.siteId, site.businessHours);
      });
    }
    
    // Determine if fallback should be used based on day of week
    const currentDay = new Date().getDay(); // 0=Sunday, 1=Monday, etc.
    const isWeekend = currentDay === 0 || currentDay === 6; // Sunday = 0, Saturday = 6
    const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][currentDay];
    
    console.log(`   - Current day: ${dayName} (${currentDay})`);
    console.log(`   - Is weekend: ${isWeekend}`);
    console.log(`   - Fallback policy: ${isWeekend ? 'NO FALLBACK (weekend)' : 'FALLBACK ALLOWED (weekday)'}`);
    
    // Process sites with different logic for weekends vs weekdays
    for (const site of allSites as any[]) {
      try {
        console.log(`\n🔍 Processing site analysis for: ${site.name || 'Unnamed'} (${site.id})`);
        
        // Check if this site has business_hours first
        const businessHours = sitesWithBusinessHours.get(site.id);
        
        if (!businessHours && isWeekend) {
          console.log(`   ⏭️ SKIPPING - No business_hours configured and weekend (no fallback)`);
          skipped++;
          results.push({
            workflowId: `skipped-${site.id}`,
            scheduleId: `skipped-${site.id}`,
            success: true,
            error: `Skipped: No business_hours configured and weekend (no fallback)`
          });
          continue;
        }
        
        // Check if this site has already been analyzed using the analysis table
        const analysisStatus = await checkSiteAnalysisActivity(site.id);
        
        if (analysisStatus.hasAnalysis) {
          console.log(`   ⏭️ SKIPPING - Site already analyzed: ${analysisStatus.reason}`);
          if (analysisStatus.lastAnalysis) {
            console.log(`   📅 Last analysis: ${analysisStatus.lastAnalysis.created_at}`);
          }
          
          skipped++;
          results.push({
            workflowId: `skipped-${site.id}`,
            scheduleId: `skipped-${site.id}`,
            success: true,
            error: `Skipped: ${analysisStatus.reason}`
          });
          continue;
        }
        
        console.log(`   ✅ NEEDS ANALYSIS - ${analysisStatus.reason}`);
        
        let scheduledTime: string;
        let siteTimezone: string;
        let businessHoursSource: string;
        
        if (businessHours) {
          // Site HAS business_hours - use them
          scheduledTime = businessHours.open; // e.g., "09:00"
          siteTimezone = businessHours.timezone || timezone;
          businessHoursSource = 'database-configured';
          console.log(`   ✅ Has business_hours: ${businessHours.open} - ${businessHours.close} ${siteTimezone}`);
        } else {
          // Site DOES NOT have business_hours - use weekday fallback
          scheduledTime = "09:00"; // Default fallback time
          siteTimezone = timezone; // Default timezone
          businessHoursSource = 'fallback-weekday';
          console.log(`   ⚠️ No business_hours found - using WEEKDAY FALLBACK: ${scheduledTime} ${siteTimezone}`);
        }
        
        // Parse the target time and subtract 1 hour for site analysis
        const [hours, minutes] = scheduledTime.split(':').map(Number);
        
        // Calculate site analysis time (1 hour before daily standup)
        let analysisHour = hours - 1;
        if (analysisHour < 0) {
          analysisHour = 23; // Wrap to previous day if needed
        }
        
        const analysisScheduledTime = `${analysisHour.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
        
        console.log(`   - Original daily standup time: ${scheduledTime}`);
        console.log(`   - Site analysis time (1h earlier): ${analysisScheduledTime}`);
        console.log(`   - Timezone: ${siteTimezone}`);
        console.log(`   - Business hours source: ${businessHoursSource}`);
        
        const nowUTC = new Date();
        const timezoneOffset = siteTimezone === 'America/Mexico_City' ? 6 : 0;
        
        // Calculate current time in site's timezone
        const nowLocal = new Date(nowUTC.getTime() - (timezoneOffset * 60 * 60 * 1000));
        
        // Create target time for "today" in site's timezone using analysis time
        const targetLocalToday = new Date(nowLocal);
        targetLocalToday.setUTCHours(analysisHour, minutes, 0, 0);
        
        // Check if target time already passed in site's timezone
        const targetAlreadyPassed = targetLocalToday <= nowLocal;
        
        // Determine final target date (today or tomorrow in site's timezone)
        let finalTargetLocal: Date;
        
        if (targetAlreadyPassed) {
          finalTargetLocal = new Date(targetLocalToday);
          finalTargetLocal.setUTCDate(finalTargetLocal.getUTCDate() + 1);
          console.log(`   ⏰ Target time already passed, scheduling for TOMORROW`);
        } else {
          finalTargetLocal = targetLocalToday;
          console.log(`   ⏰ Target time hasn't passed, scheduling for TODAY`);
        }
        
        const finalLocalDateStr = finalTargetLocal.toISOString().split('T')[0];
        const finalTargetUTC = new Date(finalTargetLocal.getTime() + (timezoneOffset * 60 * 60 * 1000));
        
        console.log(`   - Final target: ${finalTargetLocal.getUTCHours().toString().padStart(2, '0')}:${finalTargetLocal.getUTCMinutes().toString().padStart(2, '0')} ${siteTimezone} on ${finalLocalDateStr}`);
        console.log(`   - Final target UTC: ${finalTargetUTC.toISOString()}`);
        
        // Calculate delay in milliseconds from now
        const now = new Date();
        const delayMs = finalTargetUTC.getTime() - now.getTime();
        
        if (delayMs <= 0) {
          console.log(`   ⚠️ Target time is in the past, executing immediately`);
        } else {
          const delayHours = delayMs / (1000 * 60 * 60);
          console.log(`   ⏰ Will execute in ${delayHours.toFixed(2)} hours`);
        }
        
        // Create unique workflow ID for this site analysis
        const workflowId = `site-analysis-timer-${site.id}-${Date.now()}`;
        
        console.log(`   - Workflow ID: ${workflowId}`);
        console.log(`   - Delay: ${delayMs}ms (${(delayMs / 1000 / 60).toFixed(1)} minutes)`);
        
        // Prepare workflow arguments for analyzeSiteWorkflow
        const workflowArgs = [{
          site_id: site.id,
          userId: site.user_id,
          additionalData: {
            scheduledBy: 'activityPrioritizationEngine-siteAnalysis',
            executeReason: `initial-site-analysis-${businessHoursSource}-${analysisScheduledTime}`,
            scheduleType: `site-analysis-${businessHoursSource}`,
            scheduleTime: `${analysisScheduledTime} ${siteTimezone}`,
            executionDay: finalLocalDateStr,
            timezone: siteTimezone,
            executionMode: 'timer-delayed-analysis',
            businessHours: businessHours || { 
              open: analysisScheduledTime, 
              close: '18:00', 
              enabled: true, 
              timezone: siteTimezone, 
              source: businessHoursSource 
            },
            siteName: site.name || `Site ${site.id.substring(0, 8)}`,
            fallbackUsed: !businessHours,
            delayMs,
            targetTimeUTC: finalTargetUTC.toISOString(),
            analysisType: 'initial-site-analysis',
            originalDailyStandupTime: scheduledTime,
            analysisExecutesOneHourEarlier: true,
            parentScheduleId: options.parentScheduleId,
            dailyOperationsScheduleId: options.parentScheduleId // Also add as alias for clarity
          }
        }];

        // Start the DELAYED workflow for site analysis
        await client.workflow.start('delayedExecutionWorkflow', {
          args: [{
            delayMs: Math.max(delayMs, 0), // Ensure non-negative delay
            targetWorkflow: 'analyzeSiteWorkflow',
            targetArgs: workflowArgs,
            siteName: site.name || 'Site',
            scheduledTime: `${analysisScheduledTime} ${siteTimezone}`,
            executionType: 'timer-based-site-analysis'
          }],
          taskQueue: temporalConfig.taskQueue,
          workflowId: workflowId,
          workflowRunTimeout: '48h', // Allow up to 48 hours for the delay
        });

        console.log(`✅ Successfully scheduled Site Analysis with TIMER for ${site.name || 'Site'}`);
        console.log(`   - Will execute at: ${analysisScheduledTime} ${siteTimezone} on ${finalLocalDateStr} (1h before daily standup)`);
        console.log(`   - Daily standup time: ${scheduledTime} ${siteTimezone}`);
        console.log(`   - Business hours source: ${businessHoursSource}`);
        console.log(`   - Using TIMER approach for one-time site analysis`);
        console.log(`   - ⏰ EXECUTES 1 HOUR BEFORE DAILY STANDUP`);
        
        // Update cron status to reflect the scheduled workflow
        const cronUpdate: CronStatusUpdate = {
          siteId: site.id,
          workflowId: workflowId,
          scheduleId: workflowId, // Use workflowId as scheduleId for timers
          activityName: 'analyzeSiteWorkflow',
          status: 'SCHEDULED',
          nextRun: finalTargetUTC.toISOString(),
        };
        
        await saveCronStatusActivity(cronUpdate);

        results.push({
          workflowId: workflowId,
          scheduleId: workflowId,
          success: true
        });
        
        scheduled++;

      } catch (siteError) {
        const errorMessage = siteError instanceof Error ? siteError.message : String(siteError);
        console.error(`❌ Failed to schedule Site Analysis for site ${site.id}: ${errorMessage}`);
        
        errors.push(`Site ${site.id}: ${errorMessage}`);
        failed++;
        
        results.push({
          workflowId: `failed-${site.id}-${Date.now()}`,
          scheduleId: `failed-${site.id}-${Date.now()}`,
          success: false,
          error: errorMessage
        });
      }
    }

    console.log(`\n📊 Individual Site Analysis TIMER scheduling completed:`);
    console.log(`   ✅ Scheduled: ${scheduled} sites`);
    console.log(`   ⏭️ Skipped: ${skipped} sites (already analyzed)`);
    console.log(`   ❌ Failed: ${failed} sites`);
    console.log(`   🎯 Using TIMER-based approach for reliable one-time execution`);
    console.log(`   📅 Each site will execute at their specific business hours MINUS 1 HOUR`);
    console.log(`   🔍 This is a ONE-TIME analysis per site (checks cron_status)`);
    console.log(`   ⏰ EXECUTES 1 HOUR BEFORE DAILY STANDUP to prepare analysis data`);

    return { scheduled, skipped, failed, results, errors };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Failed to schedule individual Site Analysis: ${errorMessage}`);
    
    return {
      scheduled: 0,
      skipped: 0,
      failed: 1,
      results: [],
      errors: [errorMessage]
    };
  }
}

/**
 * Schedule Lead Generation Workflows for individual sites using TIMERS
 * Creates delayed workflow executions for sites with business_hours OR weekday fallback
 * Uses Temporal timers instead of schedules for one-time executions
 * WEEKEND RESTRICTION: sites without business_hours are skipped on weekends (Fri/Sat)
 * WEEKDAY FALLBACK: sites without business_hours use 09:00 fallback (Sun-Thu)
 * EXECUTES 1 HOUR AFTER DAILY STANDUP to generate leads after standup analysis
 */
export async function scheduleIndividualLeadGenerationActivity(
  businessHoursAnalysis: any,
  options: { timezone?: string; parentScheduleId?: string } = {}
): Promise<{
  scheduled: number;
  skipped: number;
  failed: number;
  results: ScheduleWorkflowResult[];
  errors: string[];
}> {
  const { timezone = 'America/Mexico_City' } = options;
  
  console.log(`🔥 Scheduling individual Lead Generation workflows using TIMERS`);
  console.log(`   - Default timezone: ${timezone}`);
  console.log(`   - Sites with business_hours: ${businessHoursAnalysis.openSites?.length || 0}`);
  
  const results: ScheduleWorkflowResult[] = [];
  const errors: string[] = [];
  let scheduled = 0;
  const skipped = 0;
  let failed = 0;

  try {
    const client = await getTemporalClient();
    const supabaseService = getSupabaseService();
    
    // Get ALL sites from database
    const allSites = await supabaseService.fetchSites();
    console.log(`   - Total sites in database: ${allSites.length}`);
    
    if (!allSites || allSites.length === 0) {
      console.log('⚠️ No sites found in database');
      return { scheduled: 0, skipped: 0, failed: 0, results: [], errors: [] };
    }

    // Create a map of sites with business hours for quick lookup
    const sitesWithBusinessHours = new Map();
    if (businessHoursAnalysis.openSites) {
      businessHoursAnalysis.openSites.forEach((site: any) => {
        sitesWithBusinessHours.set(site.siteId, site.businessHours);
      });
    }
    
    // Determine if fallback should be used based on day of week
    const currentDay = new Date().getDay(); // 0=Sunday, 1=Monday, etc.
    const isWeekend = currentDay === 0 || currentDay === 6; // Sunday = 0, Saturday = 6
    const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][currentDay];
    
    console.log(`   - Current day: ${dayName} (${currentDay})`);
    console.log(`   - Is weekend: ${isWeekend}`);
    console.log(`   - Fallback policy: ${isWeekend ? 'NO FALLBACK (weekend)' : 'FALLBACK ALLOWED (weekday)'}`);
    
    // Process sites with different logic for weekends vs weekdays
    for (const site of allSites as any[]) {
      try {
        console.log(`\n🔥 Processing site for Lead Generation: ${site.name || 'Unnamed'} (${site.id})`);
        
        // Check if this site has business_hours
        const businessHours = sitesWithBusinessHours.get(site.id);
        
        let scheduledTime: string;
        let siteTimezone: string;
        let businessHoursSource: string;
        
        if (businessHours) {
          // Site HAS business_hours - use them
          scheduledTime = businessHours.open; // e.g., "09:00"
          siteTimezone = businessHours.timezone || timezone;
          businessHoursSource = 'database-configured';
          console.log(`   ✅ Has business_hours: ${businessHours.open} - ${businessHours.close} ${siteTimezone}`);
        } else if (!isWeekend) {
          // Site DOES NOT have business_hours - use fallback ONLY on weekdays
          scheduledTime = "09:00"; // Default fallback time
          siteTimezone = timezone; // Default timezone
          businessHoursSource = 'fallback-weekday';
          console.log(`   ⚠️ No business_hours found - using WEEKDAY FALLBACK: ${scheduledTime} ${siteTimezone}`);
        } else {
          // Weekend: NO fallback for sites without business_hours
          console.log(`   ⏭️ SKIPPING - No business_hours configured and weekend (no fallback)`);
          continue;
        }
        
        // Parse the original daily standup time
        const [hours, minutes] = scheduledTime.split(':').map(Number);
        
        // Calculate lead generation time (1 hour after daily standup)
        let leadGenHour = hours + 1;
        if (leadGenHour >= 24) {
          leadGenHour = 0; // Wrap to next day if needed
        }
        
        const leadGenScheduledTime = `${leadGenHour.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
        
        console.log(`   - Original daily standup time: ${scheduledTime}`);
        console.log(`   - Lead generation time (1h later): ${leadGenScheduledTime}`);
        console.log(`   - Timezone: ${siteTimezone}`);
        console.log(`   - Business hours source: ${businessHoursSource}`);
        
        const nowUTC = new Date();
        const timezoneOffset = siteTimezone === 'America/Mexico_City' ? 6 : 0;
        
        // Calculate current time in site's timezone
        const nowLocal = new Date(nowUTC.getTime() - (timezoneOffset * 60 * 60 * 1000));
        
        // Create target time for "today" in site's timezone using lead generation time
        const targetLocalToday = new Date(nowLocal);
        targetLocalToday.setUTCHours(leadGenHour, minutes, 0, 0);
        
        // Check if target time already passed in site's timezone
        const targetAlreadyPassed = targetLocalToday <= nowLocal;
        
        // Determine final target date (today or tomorrow in site's timezone)
        let finalTargetLocal: Date;
        
        if (targetAlreadyPassed) {
          finalTargetLocal = new Date(targetLocalToday);
          finalTargetLocal.setUTCDate(finalTargetLocal.getUTCDate() + 1);
          console.log(`   ⏰ Target time already passed, scheduling for TOMORROW`);
        } else {
          finalTargetLocal = targetLocalToday;
          console.log(`   ⏰ Target time hasn't passed, scheduling for TODAY`);
        }
        
        const finalLocalDateStr = finalTargetLocal.toISOString().split('T')[0];
        const finalTargetUTC = new Date(finalTargetLocal.getTime() + (timezoneOffset * 60 * 60 * 1000));
        
        console.log(`   - Final target: ${finalTargetLocal.getUTCHours().toString().padStart(2, '0')}:${finalTargetLocal.getUTCMinutes().toString().padStart(2, '0')} ${siteTimezone} on ${finalLocalDateStr}`);
        console.log(`   - Final target UTC: ${finalTargetUTC.toISOString()}`);
        
        // Calculate delay in milliseconds from now
        const now = new Date();
        const delayMs = finalTargetUTC.getTime() - now.getTime();
        
        if (delayMs <= 0) {
          console.log(`   ⚠️ Target time is in the past, executing immediately`);
        } else {
          const delayHours = delayMs / (1000 * 60 * 60);
          console.log(`   ⏰ Will execute in ${delayHours.toFixed(2)} hours`);
        }
        
        // Create unique workflow ID for this site's lead generation
        const uniqueHash = Math.random().toString(36).substring(2, 15);
        const workflowId = `lead-generation-timer-${site.id}-${finalLocalDateStr}-${leadGenScheduledTime.replace(':', '')}-${uniqueHash}`;
        
        console.log(`   - Workflow ID: ${workflowId}`);
        console.log(`   - Delay: ${delayMs}ms (${(delayMs / 1000 / 60).toFixed(1)} minutes)`);
        
        // Prepare workflow arguments for leadGenerationWorkflow
        const workflowArgs = [{
          site_id: site.id,
          userId: site.user_id,
          create: true, // Actually create leads (not just validation)
          additionalData: {
            scheduledBy: 'activityPrioritizationEngine-leadGeneration',
            executeReason: `post-standup-lead-generation-${businessHoursSource}-${leadGenScheduledTime}`,
            scheduleType: `lead-generation-${businessHoursSource}`,
            scheduleTime: `${leadGenScheduledTime} ${siteTimezone}`,
            executionDay: finalLocalDateStr,
            timezone: siteTimezone,
            executionMode: 'timer-delayed-lead-generation',
            businessHours: businessHours || { 
              open: scheduledTime, 
              close: '18:00', 
              enabled: true, 
              timezone: siteTimezone, 
              source: businessHoursSource 
            },
            siteName: site.name || `Site ${site.id.substring(0, 8)}`,
            fallbackUsed: !businessHours,
            delayMs,
            targetTimeUTC: finalTargetUTC.toISOString(),
            leadGenerationType: 'post-standup-lead-generation',
            originalDailyStandupTime: scheduledTime,
            leadGenExecutesOneHourLater: true,
            executesAfterDailyStandup: true,
            parentScheduleId: options.parentScheduleId,
            dailyOperationsScheduleId: options.parentScheduleId // Also add as alias for clarity
          }
        }];

        // Start the DELAYED workflow and capture the actual handle returned by Temporal
        const leadGenHandle = await client.workflow.start('delayedExecutionWorkflow', {
          args: [{
            delayMs: Math.max(delayMs, 0), // Ensure non-negative delay
            targetWorkflow: 'leadGenerationWorkflow',
            targetArgs: workflowArgs,
            siteName: site.name || 'Site',
            scheduledTime: `${leadGenScheduledTime} ${siteTimezone}`,
            executionType: 'timer-based-lead-generation'
          }],
          taskQueue: temporalConfig.taskQueue,
          workflowId: workflowId,
          workflowRunTimeout: '48h', // Allow up to 48 hours for the delay
        });

        // Get the actual workflow ID from Temporal
        const actualLeadGenWorkflowId = leadGenHandle.workflowId;

        console.log(`✅ Successfully scheduled Lead Generation with TIMER for ${site.name || 'Site'}`);
        console.log(`   - Will execute at: ${leadGenScheduledTime} ${siteTimezone} on ${finalLocalDateStr} (1h after daily standup)`);
        console.log(`   - Daily standup time: ${scheduledTime} ${siteTimezone}`);
        console.log(`   - Business hours source: ${businessHoursSource}`);
        console.log(`   - Temporal Workflow ID: ${actualLeadGenWorkflowId}`);
        console.log(`   - Using TIMER approach for one-time lead generation`);
        console.log(`   - 🔥 EXECUTES 1 HOUR AFTER DAILY STANDUP`);
        
        // Update cron status to reflect the scheduled workflow using actual Temporal IDs
        const cronUpdate: CronStatusUpdate = {
          siteId: site.id,
          workflowId: actualLeadGenWorkflowId, // Use actual Temporal workflow ID
          scheduleId: workflowId, // Use original generated workflowId as scheduleId for timers
          activityName: 'leadGenerationWorkflow',
          status: 'SCHEDULED',
          nextRun: finalTargetUTC.toISOString(),
        };
        
        await saveCronStatusActivity(cronUpdate);

        results.push({
          workflowId: actualLeadGenWorkflowId, // Use actual Temporal workflow ID
          scheduleId: workflowId,
          success: true
        });
        
        scheduled++;

        // ===================================================================
        // NEW: Schedule idealClientProfileMiningWorkflow SAME DAY (30m after Lead Gen)
        // ===================================================================

        // Calculate ICP mining time (30 minutes after lead generation)
        let icpHour = leadGenHour;
        let icpMinute = minutes + 30;
        if (icpMinute >= 60) {
          icpHour = icpHour + 1;
          icpMinute = icpMinute - 60;
        }
        if (icpHour >= 24) {
          icpHour = icpHour - 24; // Wrap to next day if needed
        }

        const icpScheduledTime = `${icpHour.toString().padStart(2, '0')}:${icpMinute.toString().padStart(2, '0')}`;

        // Create target time for ICP mining in site's timezone
        const icpTargetLocal = new Date(finalTargetLocal);
        icpTargetLocal.setUTCHours(icpHour, icpMinute, 0, 0);

        // If ICP time is earlier than lead gen time after minute adjustment, it wrapped to next day
        if (icpHour < leadGenHour || (icpHour === leadGenHour && icpMinute < minutes)) {
          icpTargetLocal.setUTCDate(icpTargetLocal.getUTCDate() + 1);
        }

        const icpTargetUTC = new Date(icpTargetLocal.getTime() + (timezoneOffset * 60 * 60 * 1000));
        const icpDelayMs = icpTargetUTC.getTime() - now.getTime();

        // Create unique workflow ID for ICP mining
        const icpUniqueHash = Math.random().toString(36).substring(2, 15);
        const icpWorkflowId = `icp-mining-timer-${site.id}-${finalLocalDateStr}-${icpScheduledTime.replace(':', '')}-${icpUniqueHash}`;

        console.log(`\n🎯 Scheduling ICP Mining workflow (30m after Lead Generation):`);
        console.log(`   - ICP mining time: ${icpScheduledTime} ${siteTimezone}`);
        console.log(`   - Target time UTC: ${icpTargetUTC.toISOString()}`);
        console.log(`   - Delay: ${icpDelayMs}ms (${(icpDelayMs / 1000 / 60).toFixed(1)} minutes)`);
        console.log(`   - Workflow ID: ${icpWorkflowId}`);

        // Prepare workflow arguments for idealClientProfileMiningWorkflow
        const icpWorkflowArgs = [{
          site_id: site.id,
          userId: site.user_id,
          // Allow batch mode: will pick first pending icp_mining for the site
          additionalData: {
            scheduledBy: 'activityPrioritizationEngine-icpMining',
            executeReason: `post-leadgeneration-icp-mining-${businessHoursSource}-${icpScheduledTime}`,
            scheduleType: `icp-mining-${businessHoursSource}`,
            scheduleTime: `${icpScheduledTime} ${siteTimezone}`,
            executionDay: finalLocalDateStr,
            timezone: siteTimezone,
            executionMode: 'timer-delayed-icp-mining',
            businessHours: businessHours || {
              open: scheduledTime,
              close: '18:00',
              enabled: true,
              timezone: siteTimezone,
              source: businessHoursSource
            },
            siteName: site.name || `Site ${site.id.substring(0, 8)}`,
            fallbackUsed: !businessHours,
            delayMs: icpDelayMs,
            targetTimeUTC: icpTargetUTC.toISOString(),
            leadGenTime: leadGenScheduledTime,
            executesSameDayAsLeadGeneration: true,
            parentScheduleId: options.parentScheduleId,
            dailyOperationsScheduleId: options.parentScheduleId
          }
        }];

        // Start the DELAYED workflow for ICP mining
        await client.workflow.start('delayedExecutionWorkflow', {
          args: [{
            delayMs: Math.max(icpDelayMs, 0),
            targetWorkflow: 'idealClientProfileMiningWorkflow',
            targetArgs: icpWorkflowArgs,
            siteName: site.name || 'Site',
            scheduledTime: `${icpScheduledTime} ${siteTimezone}`,
            executionType: 'timer-based-icp-mining'
          }],
          taskQueue: temporalConfig.taskQueue,
          workflowId: icpWorkflowId,
          workflowRunTimeout: '48h',
        });

        // Save cron status entry for ICP mining
        const icpCronUpdate: CronStatusUpdate = {
          siteId: site.id,
          workflowId: icpWorkflowId,
          scheduleId: icpWorkflowId,
          activityName: 'idealClientProfileMiningWorkflow',
          status: 'SCHEDULED',
          nextRun: icpTargetUTC.toISOString(),
        };
        await saveCronStatusActivity(icpCronUpdate);

        results.push({
          workflowId: icpWorkflowId,
          scheduleId: icpWorkflowId,
          success: true
        });

        // ===================================================================
        // NEW: Schedule dailyStrategicAccountsWorkflow 2 hours after Lead Gen
        // ===================================================================
        
        // Calculate strategic accounts time (2 hours after lead generation)
        let strategicHour = leadGenHour + 2;
        if (strategicHour >= 24) {
          strategicHour = strategicHour - 24; // Wrap to next day if needed
        }
        
        const strategicScheduledTime = `${strategicHour.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
        
        // Create target time for strategic accounts in site's timezone
        const strategicTargetLocal = new Date(finalTargetLocal);
        strategicTargetLocal.setUTCHours(strategicHour, minutes, 0, 0);
        
        // If strategic accounts time is earlier than lead gen time, it means it wrapped to next day
        if (strategicHour < leadGenHour) {
          strategicTargetLocal.setUTCDate(strategicTargetLocal.getUTCDate() + 1);
        }
        
        const strategicTargetUTC = new Date(strategicTargetLocal.getTime() + (timezoneOffset * 60 * 60 * 1000));
        const strategicDelayMs = strategicTargetUTC.getTime() - now.getTime();
        
        // Create unique workflow ID for strategic accounts
        const strategicUniqueHash = Math.random().toString(36).substring(2, 15);
        const strategicWorkflowId = `daily-strategic-accounts-timer-${site.id}-${finalLocalDateStr}-${strategicScheduledTime.replace(':', '')}-${strategicUniqueHash}`;
        
        console.log(`\n🎯 Scheduling Daily Strategic Accounts workflow (2h after Lead Generation):`);
        console.log(`   - Strategic accounts time: ${strategicScheduledTime} ${siteTimezone}`);
        console.log(`   - Target time UTC: ${strategicTargetUTC.toISOString()}`);
        console.log(`   - Delay: ${strategicDelayMs}ms (${(strategicDelayMs / 1000 / 60).toFixed(1)} minutes)`);
        console.log(`   - Workflow ID: ${strategicWorkflowId}`);
        
        // Prepare workflow arguments for dailyStrategicAccountsWorkflow
        const strategicWorkflowArgs = [{
                  site_id: site.id,
        userId: site.user_id,
        additionalData: {
            scheduledBy: 'activityPrioritizationEngine-strategicAccounts',
            executeReason: `post-leadgeneration-strategic-accounts-${businessHoursSource}-${strategicScheduledTime}`,
            scheduleType: `strategic-accounts-${businessHoursSource}`,
            scheduleTime: `${strategicScheduledTime} ${siteTimezone}`,
            executionDay: finalLocalDateStr,
            timezone: siteTimezone,
            executionMode: 'timer-delayed-strategic-accounts',
            businessHours: businessHours || { 
              open: scheduledTime, 
              close: '18:00', 
              enabled: true, 
              timezone: siteTimezone, 
              source: businessHoursSource 
            },
            siteName: site.name || `Site ${site.id.substring(0, 8)}`,
            fallbackUsed: !businessHours,
            delayMs: strategicDelayMs,
            targetTimeUTC: strategicTargetUTC.toISOString(),
            strategicAccountsType: 'post-leadgeneration-strategic-accounts',
            originalDailyStandupTime: scheduledTime,
            leadGenTime: leadGenScheduledTime,
            executesAfterLeadGeneration: true,
            parentScheduleId: options.parentScheduleId,
            dailyOperationsScheduleId: options.parentScheduleId // Also add as alias for clarity
          }
        }];

        // Temporary guard: disable Strategic Accounts scheduling unless explicitly enabled
        if (process.env.SCHEDULE_STRATEGIC_ACCOUNTS !== 'true') {
          console.log('⏭️ Skipping Strategic Accounts scheduling (temporarily disabled). Set SCHEDULE_STRATEGIC_ACCOUNTS=true to enable.');
        } else {
          // Start the DELAYED workflow for strategic accounts
          await client.workflow.start('delayedExecutionWorkflow', {
            args: [{
              delayMs: Math.max(strategicDelayMs, 0), // Ensure non-negative delay
              targetWorkflow: 'dailyStrategicAccountsWorkflow',
              targetArgs: strategicWorkflowArgs,
              siteName: site.name || 'Site',
              scheduledTime: `${strategicScheduledTime} ${siteTimezone}`,
              executionType: 'timer-based-strategic-accounts'
            }],
            taskQueue: temporalConfig.taskQueue,
            workflowId: strategicWorkflowId,
            workflowRunTimeout: '48h', // Allow up to 48 hours for the delay
          });

          console.log(`✅ Successfully scheduled Daily Strategic Accounts with TIMER for ${site.name || 'Site'}`);
          console.log(`   - Will execute at: ${strategicScheduledTime} ${siteTimezone} on ${finalLocalDateStr} (2h after lead generation)`);
          console.log(`   - Lead generation time: ${leadGenScheduledTime} ${siteTimezone}`);
          console.log(`   - 🎯 EXECUTES 2 HOURS AFTER LEAD GENERATION`);
          
          // Update cron status for strategic accounts workflow
          const strategicCronUpdate: CronStatusUpdate = {
            siteId: site.id,
            workflowId: strategicWorkflowId,
            scheduleId: strategicWorkflowId, // Use workflowId as scheduleId for timers
            activityName: 'dailyStrategicAccountsWorkflow',
            status: 'SCHEDULED',
            nextRun: strategicTargetUTC.toISOString(),
          };
          
          await saveCronStatusActivity(strategicCronUpdate);

          results.push({
            workflowId: strategicWorkflowId,
            scheduleId: strategicWorkflowId,
            success: true
          });
          
          scheduled++;
        }

      } catch (siteError) {
        const errorMessage = siteError instanceof Error ? siteError.message : String(siteError);
        console.error(`❌ Failed to schedule Lead Generation for site ${site.id}: ${errorMessage}`);
        
        errors.push(`Site ${site.id}: ${errorMessage}`);
        failed++;
        
        results.push({
          workflowId: `failed-${site.id}-${Date.now()}`,
          scheduleId: `failed-${site.id}-${Date.now()}`,
          success: false,
          error: errorMessage
        });
      }
    }

    console.log(`\n📊 Individual Lead Generation + Strategic Accounts TIMER scheduling completed:`);
    const strategicEnabled = process.env.SCHEDULE_STRATEGIC_ACCOUNTS === 'true';
    if (strategicEnabled) {
      console.log(`   ✅ Scheduled: ${scheduled} workflows (${scheduled / 2} sites x 2 workflows each)`);
    } else {
      console.log(`   ✅ Scheduled: ${scheduled} lead generation workflows (Strategic Accounts disabled)`);
    }
    console.log(`   ⏭️ Skipped: ${skipped} sites`);
    console.log(`   ❌ Failed: ${failed} sites`);
    console.log(`   🎯 Using TIMER-based approach for reliable one-time execution`);
    console.log(`   📅 Each site will execute Lead Generation at business hours PLUS 1 HOUR`);
    if (strategicEnabled) {
      console.log(`   🎯 Each site will execute Strategic Accounts at Lead Generation time PLUS 2 HOURS`);
      console.log(`   🔥 SEQUENCE: Daily Standup → 1h → Lead Generation → 2h → Strategic Accounts`);
    } else {
      console.log(`   ⏭️ Strategic Accounts step is currently disabled`);
      console.log(`   🔥 SEQUENCE: Daily Standup → 1h → Lead Generation`);
    }

    return { scheduled, skipped, failed, results, errors };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Failed to schedule individual Lead Generation: ${errorMessage}`);
    
    return {
      scheduled: 0,
      skipped: 0,
      failed: 1,
      results: [],
      errors: [errorMessage]
    };
  }
}

/**
 * Execute daily prospection workflows for sites after daily standups
 * 
 * @param options.dryRun - If true, only simulates execution without running real workflows
 * @param options.testMode - If true, adds safety checks and limits to prevent production issues
 * @param options.maxSites - Maximum number of sites to process (useful for testing)
 * @param options.businessHoursAnalysis - Business hours analysis for filtering sites
 * @param options.hoursThreshold - Hours threshold for lead age (default 48)
 * @param options.maxLeads - Maximum leads per site (default 50)
 */
export async function executeDailyProspectionWorkflowsActivity(
  options: { 
    dryRun?: boolean; 
    testMode?: boolean; 
    maxSites?: number;
    businessHoursAnalysis?: any;
    hoursThreshold?: number;
    maxLeads?: number;
    parentScheduleId?: string;
  } = {}
): Promise<{
  scheduled: number;
  skipped: number;
  failed: number;
  results: ScheduleWorkflowResult[];
  errors: string[];
  testInfo?: any;
}> {
  console.log('🎯 Starting Daily Prospection workflow execution...');
  
  const { businessHoursAnalysis, hoursThreshold = 48, maxLeads = 30 } = options;
  
  if (businessHoursAnalysis) {
    console.log('📋 BUSINESS HOURS FILTERING ENABLED:');
    console.log(`   - Sites with business_hours: ${businessHoursAnalysis.sitesWithBusinessHours}`);
    console.log(`   - Sites open today: ${businessHoursAnalysis.sitesOpenToday}`);
    console.log(`   - Will execute prospection for filtered sites only`);
  } else {
    console.log('📋 FALLBACK MODE - No business hours filtering:');
    console.log('   - Will execute prospection for all sites (legacy behavior)');
  }
  
  // Safety checks for test mode
  if (options.testMode) {
    console.log('🧪 TEST MODE ENABLED - Extra safety checks activated');
    options.dryRun = true; // Force dry run in test mode
    options.maxSites = options.maxSites || 3; // Limit to 3 sites max in test mode
  }
  
  if (options.dryRun) {
    console.log('🔬 DRY RUN MODE - No real prospection workflows will be executed');
  }
  
  const results: ScheduleWorkflowResult[] = [];
  const errors: string[] = [];
  let scheduled = 0;
  let failed = 0;
  let skipped = 0;
  
  try {
    console.log('📊 Getting sites for daily prospection...');
    
    // Check database availability
    const supabaseService = getSupabaseService();
    const isConnected = await supabaseService.getConnectionStatus();
    
    if (!isConnected) {
      console.log('⚠️ Database not available, cannot execute daily prospection workflows');
      return {
        scheduled: 0,
        skipped: 0,
        failed: 1,
        results: [],
        errors: ['Database not available']
      };
    }

    console.log('✅ Database connection confirmed, fetching sites...');
    
    // Import supabase service role client
    const { supabaseServiceRole } = await import('../../lib/supabase/client');

    let sitesQuery = supabaseServiceRole
      .from('sites')
      .select('id, name, url, user_id, business_hours')
      .eq('active', true);

    // Apply site limit for testing
    if (options.maxSites && options.maxSites > 0) {
      console.log(`⚠️ Limiting to ${options.maxSites} sites for testing`);
      sitesQuery = sitesQuery.limit(options.maxSites);
    }

    const { data: allSites, error: sitesError } = await sitesQuery;

    if (sitesError) {
      console.error('❌ Error fetching sites:', sitesError);
      return {
        scheduled: 0,
        skipped: 0,
        failed: 1,
        results: [],
        errors: [`Error fetching sites: ${sitesError.message}`]
      };
    }

    if (!allSites || allSites.length === 0) {
      console.log('ℹ️ No sites found for daily prospection');
      return {
        scheduled: 0,
        skipped: 0,
        failed: 0,
        results: [],
        errors: []
      };
    }

    console.log(`📋 Found ${allSites.length} total sites`);

    // Filter sites based on business hours analysis if available
    let sitesToProcess = allSites;
    
    if (businessHoursAnalysis && businessHoursAnalysis.openSites && businessHoursAnalysis.openSites.length > 0) {
      const openSiteIds = businessHoursAnalysis.openSites.map((site: any) => site.siteId);
      sitesToProcess = allSites.filter(site => openSiteIds.includes(site.id));
      
      console.log(`🔍 Business hours filtering applied:`);
      console.log(`   - Total sites: ${allSites.length}`);
      console.log(`   - Sites with active business hours today: ${sitesToProcess.length}`);
      console.log(`   - Skipped sites (outside business hours): ${allSites.length - sitesToProcess.length}`);
      
      skipped = allSites.length - sitesToProcess.length;
    } else {
      console.log(`📋 No business hours filtering - processing all ${allSites.length} sites`);
    }

    if (sitesToProcess.length === 0) {
      console.log('ℹ️ No sites to process after business hours filtering');
      return {
        scheduled: 0,
        skipped: allSites.length,
        failed: 0,
        results: [],
        errors: []
      };
    }

    console.log(`🚀 Processing ${sitesToProcess.length} sites for daily prospection...`);

    // Process each site
    for (const site of sitesToProcess) {
      try {
        console.log(`🎯 Processing site: ${site.name} (${site.id})`);
        
        const prospectionResult = await executeDailyProspectionWorkflow(site, {
          executeReason: businessHoursAnalysis ? 'business-hours-triggered' : 'scheduled-execution',
          scheduleType: businessHoursAnalysis ? 'business-hours' : 'standard',
          businessHoursAnalysis: businessHoursAnalysis,
          scheduledBy: 'activityPrioritizationEngine',
          hoursThreshold,
          maxLeads,
          dryRun: options.dryRun,
          parentScheduleId: options.parentScheduleId
        });
        
        results.push(prospectionResult);
        
        if (prospectionResult.success) {
          scheduled++;
          console.log(`✅ Daily prospection workflow started for ${site.name}`);
        } else {
          failed++;
          console.error(`❌ Failed to start daily prospection workflow for ${site.name}: ${prospectionResult.error}`);
          if (prospectionResult.error) {
            errors.push(`${site.name}: ${prospectionResult.error}`);
          }
        }
        
      } catch (siteError) {
        failed++;
        const errorMessage = siteError instanceof Error ? siteError.message : String(siteError);
        console.error(`❌ Error processing site ${site.name}: ${errorMessage}`);
        errors.push(`${site.name}: ${errorMessage}`);
        
        results.push({
          workflowId: `daily-prospection-${site.id}-failed`,
          scheduleId: 'failed',
          success: false,
          error: errorMessage
        });
      }
    }

    console.log('📊 Daily prospection workflow execution completed:');
    console.log(`   ✅ Successful: ${scheduled}`);
    console.log(`   ❌ Failed: ${failed}`);
    console.log(`   ⏭️ Skipped: ${skipped}`);
    
    return {
      scheduled,
      skipped,
      failed,
      results,
      errors,
      testInfo: options.testMode ? {
        mode: options.dryRun ? 'DRY_RUN' : 'TEST',
        maxSites: options.maxSites,
        hoursThreshold,
        maxLeads,
        duration: 'N/A'
      } : undefined
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Fatal error in executeDailyProspectionWorkflowsActivity:', errorMessage);
    
    return {
      scheduled: 0,
      skipped: 0,
      failed: 1,
      results: [],
      errors: [errorMessage]
    };
  }
}

/**
 * Execute daily prospection workflow for a single site
 */
async function executeDailyProspectionWorkflow(
  site: any, 
  executionOptions: {
    executeReason: string;
    scheduleType: string;
    businessHoursAnalysis?: any;
    scheduledBy: string;
    hoursThreshold?: number;
    maxLeads?: number;
    dryRun?: boolean;
    parentScheduleId?: string;
  }
): Promise<ScheduleWorkflowResult> {
  const workflowId = `daily-prospection-${site.id}-${Date.now()}`;

  try {
    // If dry run, just simulate the execution
    if (executionOptions.dryRun) {
      console.log(`🧪 DRY RUN - Simulating daily prospection workflow for ${site.name}`);
      return { 
        workflowId, 
        scheduleId: executionOptions.scheduleType, 
        success: true 
      };
    }

    const client = await getTemporalClient();
    
    console.log(`🚀 Executing Daily Prospection workflow for ${site.name}`);
    console.log(`   Schedule type: ${executionOptions.scheduleType}`);
    console.log(`   Execute reason: ${executionOptions.executeReason}`);
    console.log(`   Hours threshold: ${executionOptions.hoursThreshold || 48} hours`);
    console.log(`   Max leads: ${executionOptions.maxLeads || 50}`);
    
    const handle = await client.workflow.start('dailyProspectionWorkflow', {
      args: [{
        site_id: site.id,
        userId: site.user_id,
        hoursThreshold: executionOptions.hoursThreshold || 48,
        maxLeads: executionOptions.maxLeads || 30,
        minLeadsRequired: 30,
        updateStatus: false,
        additionalData: {
          scheduledBy: executionOptions.scheduledBy,
          executeReason: executionOptions.executeReason,
          scheduleType: executionOptions.scheduleType,
          scheduleTime: executionOptions.scheduleType === 'business-hours' ? 'business-hours-based' : 'immediate',
          executionDay: new Date().toLocaleDateString('en-US', { weekday: 'long' }),
          timezone: 'UTC',
          executionMode: executionOptions.scheduleType === 'business-hours' ? 'scheduled' : 'direct',
          businessHoursAnalysis: executionOptions.businessHoursAnalysis,
          triggeredBy: 'activityPrioritizationEngine',
          followsAfter: 'dailyStandUpWorkflow',
          parentScheduleId: executionOptions.parentScheduleId,
          dailyOperationsScheduleId: executionOptions.parentScheduleId // Also add as alias for clarity
        }
      }],
      taskQueue: temporalConfig.taskQueue,
      workflowId: workflowId,
    });
    
    console.log(`✅ Daily Prospection workflow started for ${site.name}`);
    console.log(`   Workflow ID: ${handle.workflowId}`);
    
    return { workflowId: handle.workflowId, scheduleId: executionOptions.scheduleType, success: true };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Failed to execute Daily Prospection workflow for ${site.name}: ${errorMessage}`);
    return { workflowId: workflowId, scheduleId: executionOptions.scheduleType, success: false, error: errorMessage };
  }
}

/**
 * Schedule Daily Prospection Workflows for individual sites using TIMERS
 * Creates delayed workflow executions for sites with business_hours OR weekday fallback
 * Uses Temporal timers instead of schedules for one-time executions
 * WEEKEND RESTRICTION: sites without business_hours are skipped on weekends (Fri/Sat)
 * WEEKDAY FALLBACK: sites without business_hours use 09:00 fallback (Sun-Thu)
 * EXECUTES 2 HOURS AFTER DAILY STANDUP to process leads after standup and lead generation
 */
export async function scheduleIndividualDailyProspectionActivity(
  businessHoursAnalysis: any,
  options: { 
    timezone?: string;
    hoursThreshold?: number;
    maxLeads?: number;
    parentScheduleId?: string;
  } = {}
): Promise<{
  scheduled: number;
  skipped: number;
  failed: number;
  results: ScheduleWorkflowResult[];
  errors: string[];
}> {
  const { timezone = 'America/Mexico_City', hoursThreshold = 48, maxLeads = 30 } = options;
  
  console.log(`🎯 Scheduling individual Daily Prospection workflows using TIMERS`);
  console.log(`   - Default timezone: ${timezone}`);
  console.log(`   - Sites with business_hours: ${businessHoursAnalysis.openSites?.length || 0}`);
  console.log(`   - Hours threshold: ${hoursThreshold} hours`);
  console.log(`   - Max leads per site: ${maxLeads}`);
  
  const results: ScheduleWorkflowResult[] = [];
  const errors: string[] = [];
  let scheduled = 0;
  const skipped = 0;
  let failed = 0;

  try {
    const client = await getTemporalClient();
    const supabaseService = getSupabaseService();
    
    // Get ALL sites from database
    const allSites = await supabaseService.fetchSites();
    console.log(`   - Total sites in database: ${allSites.length}`);
    
    if (!allSites || allSites.length === 0) {
      console.log('⚠️ No sites found in database');
      return { scheduled: 0, skipped: 0, failed: 0, results: [], errors: [] };
    }

    // Create a map of sites with business hours for quick lookup
    const sitesWithBusinessHours = new Map();
    if (businessHoursAnalysis.openSites) {
      businessHoursAnalysis.openSites.forEach((site: any) => {
        sitesWithBusinessHours.set(site.siteId, site.businessHours);
      });
    }
    
    // Determine if fallback should be used based on day of week
    const currentDay = new Date().getDay(); // 0=Sunday, 1=Monday, etc.
    const isWeekend = currentDay === 0 || currentDay === 6; // Sunday = 0, Saturday = 6
    const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][currentDay];
    
    console.log(`   - Current day: ${dayName} (${currentDay})`);
    console.log(`   - Is weekend: ${isWeekend}`);
    console.log(`   - Fallback policy: ${isWeekend ? 'NO FALLBACK (weekend)' : 'FALLBACK ALLOWED (weekday)'}`);
    
    // Process sites with different logic for weekends vs weekdays
    for (const site of allSites as any[]) {
      try {
        console.log(`\n🎯 Processing site for Daily Prospection: ${site.name || 'Unnamed'} (${site.id})`);
        
        // Check if this site has business_hours
        const businessHours = sitesWithBusinessHours.get(site.id);
        
        let scheduledTime: string;
        let siteTimezone: string;
        let businessHoursSource: string;
        
        if (businessHours) {
          // Site HAS business_hours - use them
          scheduledTime = businessHours.open; // e.g., "09:00"
          siteTimezone = businessHours.timezone || timezone;
          businessHoursSource = 'database-configured';
          console.log(`   ✅ Has business_hours: ${businessHours.open} - ${businessHours.close} ${siteTimezone}`);
        } else if (!isWeekend) {
          // Site DOES NOT have business_hours - use fallback ONLY on weekdays
          scheduledTime = "09:00"; // Default fallback time
          siteTimezone = timezone; // Default timezone
          businessHoursSource = 'fallback-weekday';
          console.log(`   ⚠️ No business_hours found - using WEEKDAY FALLBACK: ${scheduledTime} ${siteTimezone}`);
        } else {
          // Weekend: NO fallback for sites without business_hours
          console.log(`   ⏭️ SKIPPING - No business_hours configured and weekend (no fallback)`);
          continue;
        }
        
        // Parse the original daily standup time
        const [hours, minutes] = scheduledTime.split(':').map(Number);
        
        // Calculate daily prospection time (2 hours after daily standup)
        let prospectionHour = hours + 2;
        if (prospectionHour >= 24) {
          prospectionHour = prospectionHour - 24; // Wrap to next day if needed
        }
        
        const prospectionScheduledTime = `${prospectionHour.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
        
        console.log(`   - Original daily standup time: ${scheduledTime} ${siteTimezone}`);
        console.log(`   - Daily prospection time: ${prospectionScheduledTime} ${siteTimezone} (2 hours after standup)`);
        console.log(`   - Business hours source: ${businessHoursSource}`);
        
        // Parse the target prospection time
        const [prospectionHours, prospectionMinutes] = prospectionScheduledTime.split(':').map(Number);
        
        const nowUTC = new Date();
        const timezoneOffset = siteTimezone === 'America/Mexico_City' ? 6 : 0;
        
        // Calculate current time in site's timezone
        const nowLocal = new Date(nowUTC.getTime() - (timezoneOffset * 60 * 60 * 1000));
        
        // Create target time for "today" in site's timezone
        const targetLocalToday = new Date(nowLocal);
        targetLocalToday.setUTCHours(prospectionHours, prospectionMinutes, 0, 0);
        
        // Check if target time already passed in site's timezone
        const targetAlreadyPassed = targetLocalToday <= nowLocal;
        
        // Determine final target date (today or tomorrow in site's timezone)
        let finalTargetLocal: Date;
        
        if (targetAlreadyPassed) {
          finalTargetLocal = new Date(targetLocalToday);
          finalTargetLocal.setUTCDate(finalTargetLocal.getUTCDate() + 1);
          console.log(`   ⏰ Target time already passed, scheduling for TOMORROW`);
        } else {
          finalTargetLocal = targetLocalToday;
          console.log(`   ⏰ Target time hasn't passed, scheduling for TODAY`);
        }
        
        const finalLocalDateStr = finalTargetLocal.toISOString().split('T')[0];
        const finalTargetUTC = new Date(finalTargetLocal.getTime() + (timezoneOffset * 60 * 60 * 1000));
        
        console.log(`   - Final target: ${finalTargetLocal.getUTCHours().toString().padStart(2, '0')}:${finalTargetLocal.getUTCMinutes().toString().padStart(2, '0')} ${siteTimezone} on ${finalLocalDateStr}`);
        console.log(`   - Final target UTC: ${finalTargetUTC.toISOString()}`);
        
        // Calculate delay in milliseconds from now
        const now = new Date();
        const delayMs = finalTargetUTC.getTime() - now.getTime();
        
        if (delayMs <= 0) {
          console.log(`   ⚠️ Target time is in the past, executing immediately`);
        } else {
          const delayHours = delayMs / (1000 * 60 * 60);
          console.log(`   ⏰ Will execute in ${delayHours.toFixed(2)} hours`);
        }
        
        // Create unique workflow ID for this site
        const uniqueHash = Math.random().toString(36).substring(2, 15);
        const workflowId = `daily-prospection-timer-${site.id}-${finalLocalDateStr}-${prospectionScheduledTime.replace(':', '')}-${uniqueHash}`;
        
        console.log(`   - Workflow ID: ${workflowId}`);
        console.log(`   - Delay: ${delayMs}ms (${(delayMs / 1000 / 60).toFixed(1)} minutes)`);
        
        // Prepare workflow arguments for dailyProspectionWorkflow
        const workflowArgs = [{
          site_id: site.id,
          userId: site.user_id,
          hoursThreshold,
          maxLeads,
          minLeadsRequired: 30,
          updateStatus: false,
          additionalData: {
            scheduledBy: 'activityPrioritizationEngine-dailyProspection',
            executeReason: `post-standup-daily-prospection-${businessHoursSource}-${prospectionScheduledTime}`,
            scheduleType: `daily-prospection-${businessHoursSource}`,
            scheduleTime: `${prospectionScheduledTime} ${siteTimezone}`,
            executionDay: finalLocalDateStr,
            timezone: siteTimezone,
            executionMode: 'timer-delayed-daily-prospection',
            businessHours: businessHours || { 
              open: scheduledTime, 
              close: '18:00', 
              enabled: true, 
              timezone: siteTimezone, 
              source: businessHoursSource 
            },
            siteName: site.name || `Site ${site.id.substring(0, 8)}`,
            fallbackUsed: !businessHours,
            delayMs,
            targetTimeUTC: finalTargetUTC.toISOString(),
            prospectionType: 'post-standup-daily-prospection',
            originalDailyStandupTime: scheduledTime,
            prospectionExecutesTwoHoursLater: true,
            executesAfterDailyStandup: true,
            executesAfterLeadGeneration: true,
            hoursThreshold,
            maxLeads,
            parentScheduleId: options.parentScheduleId,
            dailyOperationsScheduleId: options.parentScheduleId // Also add as alias for clarity
          }
        }];

        // Start the DELAYED workflow for daily prospection
        await client.workflow.start('delayedExecutionWorkflow', {
          args: [{
            delayMs: Math.max(delayMs, 0), // Ensure non-negative delay
            targetWorkflow: 'dailyProspectionWorkflow',
            targetArgs: workflowArgs,
            siteName: site.name || 'Site',
            scheduledTime: `${prospectionScheduledTime} ${siteTimezone}`,
            executionType: 'timer-based-daily-prospection'
          }],
          taskQueue: temporalConfig.taskQueue,
          workflowId: workflowId,
          workflowRunTimeout: '48h', // Allow up to 48 hours for the delay
        });

        console.log(`✅ Successfully scheduled Daily Prospection with TIMER for ${site.name || 'Site'}`);
        console.log(`   - Will execute at: ${prospectionScheduledTime} ${siteTimezone} on ${finalLocalDateStr}`);
        console.log(`   - Business hours source: ${businessHoursSource}`);
        console.log(`   - Original daily standup: ${scheduledTime} ${siteTimezone}`);
        console.log(`   - Daily prospection: ${prospectionScheduledTime} ${siteTimezone} (2 hours after standup)`);
        console.log(`   - Execution order: DailyStandup → LeadGeneration (+1hr) → DailyProspection (+2hr)`);
        console.log(`   - 🎯 Using TIMER approach for reliable delayed execution`);
        
        results.push({
          workflowId: workflowId,
          scheduleId: workflowId,
          success: true
        });
        
        scheduled++;

      } catch (siteError) {
        const errorMessage = siteError instanceof Error ? siteError.message : String(siteError);
        console.error(`❌ Failed to schedule Daily Prospection for site ${site.id}: ${errorMessage}`);
        
        errors.push(`Site ${site.id}: ${errorMessage}`);
        failed++;
        
        results.push({
          workflowId: `failed-${site.id}-${Date.now()}`,
          scheduleId: `failed-${site.id}-${Date.now()}`,
          success: false,
          error: errorMessage
        });
      }
    }

    console.log(`\n📊 Individual Daily Prospection TIMER scheduling completed:`);
    console.log(`   ✅ Scheduled: ${scheduled} sites`);
    console.log(`   ❌ Failed: ${failed} sites`);
    console.log(`   🎯 Using TIMER-based approach for reliable one-time execution`);
    console.log(`   📅 Each site will execute at their specific business hours PLUS 2 HOURS`);
    console.log(`   🎯 EXECUTES 2 HOURS AFTER DAILY STANDUP to process leads after standup and lead generation`);

    return { scheduled, skipped, failed, results, errors };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Failed to schedule individual Daily Prospection: ${errorMessage}`);
    
    return {
      scheduled: 0,
      skipped: 0,
      failed: 1,
      results: [],
      errors: [errorMessage]
    };
  }
}







