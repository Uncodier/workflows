"use strict";
/**
 * Workflow Scheduling Activities
 * Activities for programmatically scheduling Temporal workflows
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.scheduleEmailSyncWorkflowActivity = scheduleEmailSyncWorkflowActivity;
exports.scheduleMultipleEmailSyncWorkflowsActivity = scheduleMultipleEmailSyncWorkflowsActivity;
exports.createRecurringEmailSyncScheduleActivity = createRecurringEmailSyncScheduleActivity;
exports.executeBuildCampaignsWorkflowActivity = executeBuildCampaignsWorkflowActivity;
exports.executeBuildSegmentsWorkflowActivity = executeBuildSegmentsWorkflowActivity;
exports.executeBuildContentWorkflowActivity = executeBuildContentWorkflowActivity;
exports.scheduleDailyStandUpWorkflowsActivity = scheduleDailyStandUpWorkflowsActivity;
const client_1 = require("../client");
const config_1 = require("../../config/config");
const services_1 = require("../services");
const cronActivities_1 = require("./cronActivities");
const supabaseActivities_1 = require("./supabaseActivities");
const supabaseService_1 = require("../services/supabaseService");
/**
 * Schedule a single email sync workflow for a specific site
 * Uses Temporal client to create actual workflow schedules
 */
async function scheduleEmailSyncWorkflowActivity(site, options = {}) {
    const { workflowId, scheduleId } = services_1.EmailSyncSchedulingService.generateWorkflowIds(site.id);
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
        const client = await (0, client_1.getTemporalClient)();
        // Calculate 'since' timestamp based on last successful sync to avoid reprocessing emails
        let sinceTimestamp;
        if (site.lastEmailSync?.last_run && site.lastEmailSync.status === 'COMPLETED') {
            // Use the timestamp from the last successful sync to get only new emails
            sinceTimestamp = new Date(site.lastEmailSync.last_run);
            console.log(`📧 Using last successful sync time: ${sinceTimestamp.toISOString()}`);
            console.log(`   - Will fetch emails since last completed sync to avoid reprocessing`);
        }
        else if (site.lastEmailSync?.last_run && site.lastEmailSync.status === 'FAILED') {
            // If previous sync failed, use that timestamp to avoid missing emails
            sinceTimestamp = new Date(site.lastEmailSync.last_run);
            console.log(`📧 Using last failed sync time: ${sinceTimestamp.toISOString()}`);
            console.log(`   - Retrying from last attempt to ensure no emails are missed`);
        }
        else {
            // No previous sync found, fetch emails from last 24 hours (initial sync)
            sinceTimestamp = new Date(Date.now() - 24 * 60 * 60 * 1000);
            console.log(`📧 No previous sync found, using last 24 hours: ${sinceTimestamp.toISOString()}`);
            console.log(`   - Initial sync will fetch recent emails`);
        }
        // Prepare workflow arguments
        const workflowArgs = [{
                userId: site.user_id,
                siteId: site.id,
                provider: site.email?.incomingServer?.includes('gmail') ? 'gmail' :
                    site.email?.incomingServer?.includes('outlook') ? 'outlook' : 'imap',
                since: sinceTimestamp, // Use calculated timestamp instead of hardcoded 24 hours
                batchSize: 50,
                analysisLimit: 15 // Analyze up to 15 emails
            }];
        // Create immediate workflow execution (ASAP scheduling)
        console.log(`⚡ Starting immediate workflow execution for ${site.name}`);
        const handle = await client.workflow.start('syncEmailsWorkflow', {
            args: workflowArgs,
            workflowId,
            taskQueue: config_1.temporalConfig.taskQueue,
            workflowRunTimeout: '1 hour', // Email sync timeout
        });
        console.log(`✅ Successfully started workflow for ${site.name}`);
        console.log(`   - Workflow Handle: ${handle.workflowId}`);
        // Update cron status to reflect the scheduled workflow
        const nextRun = new Date(Date.now() + 60 * 60 * 1000); // Next run in 1 hour
        const cronUpdate = {
            siteId: site.id,
            workflowId,
            scheduleId,
            activityName: 'syncEmailsWorkflow',
            status: 'RUNNING',
            nextRun: nextRun.toISOString()
        };
        await (0, cronActivities_1.saveCronStatusActivity)(cronUpdate);
        return {
            workflowId,
            scheduleId,
            success: true
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Failed to schedule workflow for ${site.name}:`, errorMessage);
        // Save error status to cron table
        try {
            const cronUpdate = {
                siteId: site.id,
                workflowId,
                scheduleId,
                activityName: 'syncEmailsWorkflow',
                status: 'FAILED',
                errorMessage: errorMessage,
                retryCount: 1
            };
            await (0, cronActivities_1.saveCronStatusActivity)(cronUpdate);
        }
        catch (statusError) {
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
async function scheduleMultipleEmailSyncWorkflowsActivity(sites, options = {}) {
    console.log(`📅 Scheduling email sync workflows for ${sites.length} sites...`);
    const sitesToSchedule = sites.filter(site => site.shouldSchedule);
    const sitesToSkip = sites.filter(site => !site.shouldSchedule);
    console.log(`   - Sites to schedule: ${sitesToSchedule.length}`);
    console.log(`   - Sites to skip: ${sitesToSkip.length}`);
    const results = [];
    const errors = [];
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
            const { workflowId, scheduleId } = services_1.EmailSyncSchedulingService.generateWorkflowIds(site.id);
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
            }
            else {
                failed++;
                const errorMsg = `Failed to schedule ${site.name}: ${result.error}`;
                errors.push(errorMsg);
                console.error(`❌ [${i + 1}/${sitesToSchedule.length}] ${errorMsg}`);
            }
        }
        catch (error) {
            failed++;
            const errorMsg = `Exception scheduling ${site.name}: ${error instanceof Error ? error.message : String(error)}`;
            errors.push(errorMsg);
            console.error(`❌ [${i + 1}/${sitesToSchedule.length}] ${errorMsg}`);
            // Add failed result
            const { workflowId, scheduleId } = services_1.EmailSyncSchedulingService.generateWorkflowIds(site.id);
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
async function createRecurringEmailSyncScheduleActivity(site, cronExpression = '0 * * * *', // Every hour
options = {}) {
    const { workflowId, scheduleId } = services_1.EmailSyncSchedulingService.generateWorkflowIds(site.id);
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
        const client = await (0, client_1.getTemporalClient)();
        const scheduleClient = client.schedule;
        // Prepare workflow arguments
        const workflowArgs = [{
                userId: site.user_id,
                siteId: site.id,
                provider: site.email?.incomingServer?.includes('gmail') ? 'gmail' :
                    site.email?.incomingServer?.includes('outlook') ? 'outlook' : 'imap',
                since: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
                batchSize: 50,
                enableAnalysis: true, // Enable AI email analysis
                analysisLimit: 15 // Analyze up to 15 emails
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
                taskQueue: config_1.temporalConfig.taskQueue,
                args: workflowArgs,
            },
            timeZone: 'UTC',
            policies: {
                catchupWindow: '5m',
                overlap: 'SKIP',
                pauseOnFailure: false,
            },
        });
        console.log(`✅ Successfully created recurring schedule for ${site.name}`);
        // Update cron status to reflect the scheduled workflow
        const nextRun = getNextRunTime(cronExpression);
        const cronUpdate = {
            siteId: site.id,
            workflowId: `${scheduleId}-recurring`,
            scheduleId,
            activityName: 'syncEmailsWorkflow',
            status: 'SCHEDULED',
            nextRun: nextRun.toISOString()
        };
        await (0, cronActivities_1.saveCronStatusActivity)(cronUpdate);
        return {
            workflowId: `${scheduleId}-recurring`,
            scheduleId,
            success: true
        };
    }
    catch (error) {
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
async function executeBuildCampaignsWorkflowActivity(siteId, options = {}) {
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
        const client = await (0, client_1.getTemporalClient)();
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
            taskQueue: config_1.temporalConfig.taskQueue,
            workflowRunTimeout: '30 minutes',
        });
        console.log(`✅ Successfully started build campaigns workflow for site: ${siteId}`);
        console.log(`   - Workflow Handle: ${handle.workflowId}`);
        // Log workflow execution (not cron status since this is on-demand)
        await (0, supabaseActivities_1.logWorkflowExecutionActivity)({
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
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Failed to execute build campaigns workflow for site ${siteId}:`, errorMessage);
        // Log execution error
        try {
            await (0, supabaseActivities_1.logWorkflowExecutionActivity)({
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
        }
        catch (logError) {
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
async function executeBuildSegmentsWorkflowActivity(siteId, options = {}) {
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
        const client = await (0, client_1.getTemporalClient)();
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
            taskQueue: config_1.temporalConfig.taskQueue,
            workflowRunTimeout: '1 hour',
        });
        console.log(`✅ Successfully started build segments workflow for site: ${siteId}`);
        console.log(`   - Workflow Handle: ${handle.workflowId}`);
        // Log workflow execution (not cron status since this is on-demand)
        await (0, supabaseActivities_1.logWorkflowExecutionActivity)({
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
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Failed to execute build segments workflow for site ${siteId}:`, errorMessage);
        // Log execution error
        try {
            await (0, supabaseActivities_1.logWorkflowExecutionActivity)({
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
        }
        catch (logError) {
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
async function executeBuildContentWorkflowActivity(siteId, options = {}) {
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
        const client = await (0, client_1.getTemporalClient)();
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
            taskQueue: config_1.temporalConfig.taskQueue,
            workflowRunTimeout: '45 minutes',
        });
        console.log(`✅ Successfully started build content workflow for site: ${siteId}`);
        console.log(`   - Workflow Handle: ${handle.workflowId}`);
        // Log workflow execution (not cron status since this is on-demand)
        await (0, supabaseActivities_1.logWorkflowExecutionActivity)({
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
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Failed to execute build content workflow for site ${siteId}:`, errorMessage);
        // Log execution error
        try {
            await (0, supabaseActivities_1.logWorkflowExecutionActivity)({
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
        }
        catch (logError) {
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
function getNextRunTime(cronExpression) {
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
 * Simple activity to schedule daily stand up workflows for all sites
 * Uses business_hours from settings or defaults to Mexico schedule
 *
 * @param options.dryRun - If true, only simulates scheduling without creating real schedules
 * @param options.testMode - If true, adds safety checks and limits to prevent production issues
 * @param options.maxSites - Maximum number of sites to process (useful for testing)
 */
async function scheduleDailyStandUpWorkflowsActivity(options = {}) {
    console.log('🌅 Starting Daily Stand Up workflow scheduling for all sites...');
    // Safety checks for test mode
    if (options.testMode) {
        console.log('🧪 TEST MODE ENABLED - Extra safety checks activated');
        options.dryRun = true; // Force dry run in test mode
        options.maxSites = options.maxSites || 3; // Limit to 3 sites max in test mode
    }
    if (options.dryRun) {
        console.log('🔬 DRY RUN MODE - No real schedules will be created');
    }
    const results = [];
    const errors = [];
    let scheduled = 0;
    let failed = 0;
    const testInfo = {
        mode: options.dryRun ? 'dry-run' : 'live',
        testMode: options.testMode || false,
        maxSites: options.maxSites,
        startTime: new Date().toISOString()
    };
    try {
        const supabaseService = (0, supabaseService_1.getSupabaseService)();
        // Check database connection
        const isConnected = await supabaseService.getConnectionStatus();
        if (!isConnected) {
            throw new Error('Database not available for scheduling');
        }
        // Fetch all sites
        let sites = await supabaseService.fetchSites();
        console.log(`✅ Found ${sites.length} sites total`);
        // Apply maxSites limit if specified
        if (options.maxSites && options.maxSites > 0) {
            sites = sites.slice(0, options.maxSites);
            console.log(`🔢 Limited to first ${sites.length} sites for testing`);
        }
        if (sites.length === 0) {
            console.log('⚠️ No sites found, nothing to schedule');
            return {
                scheduled: 0,
                skipped: 0,
                failed: 0,
                results: [],
                errors: [],
                testInfo
            };
        }
        testInfo.sitesProcessed = sites.length;
        testInfo.siteNames = sites.map(site => site.name);
        // For each site, schedule a daily stand up
        for (const site of sites) {
            try {
                console.log(`📋 Processing site: ${site.name} (${site.id})`);
                if (options.dryRun) {
                    console.log(`🧪 DRY RUN: Would schedule dailyStandUp for ${site.name}`);
                    console.log(`      📅 Schedule: Monday-Friday at 8:00 AM (Mexico City time)`);
                    console.log(`      🕐 Cron expression: "0 8 * * 1-5"`);
                    console.log(`      🌍 Timezone: America/Mexico_City`);
                    scheduled++;
                    continue;
                }
                // Create the schedule with default Mexico timezone and weekdays
                const scheduleResult = await createSimpleDailyStandUpSchedule(site);
                results.push(scheduleResult);
                if (scheduleResult.success) {
                    scheduled++;
                    console.log(`✅ Successfully scheduled for ${site.name}`);
                }
                else {
                    failed++;
                    const error = `Failed to schedule ${site.name}: ${scheduleResult.error}`;
                    errors.push(error);
                    console.error(`❌ ${error}`);
                }
            }
            catch (siteError) {
                failed++;
                const errorMsg = `Error processing site ${site.name}: ${siteError instanceof Error ? siteError.message : String(siteError)}`;
                errors.push(errorMsg);
                console.error(`❌ ${errorMsg}`);
            }
        }
        testInfo.endTime = new Date().toISOString();
        testInfo.duration = `${Date.now() - new Date(testInfo.startTime).getTime()}ms`;
        // Calculate next execution time for Mexico timezone
        const nextExecution = calculateNextDailyStandUpTime();
        testInfo.nextExecution = nextExecution;
        console.log(`📊 Daily Stand Up scheduling completed: ${scheduled} scheduled, ${failed} failed`);
        if (options.dryRun) {
            console.log(`⏰ Next execution would be: ${nextExecution.toLocaleString('es-MX', {
                timeZone: 'America/Mexico_City',
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            })} (Mexico City)`);
        }
        return { scheduled, skipped: 0, failed, results, errors, testInfo };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Failed to schedule Daily Stand Up workflows: ${errorMessage}`);
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
 * Calculate the next Daily Stand Up execution time based on Mexico timezone
 */
function calculateNextDailyStandUpTime() {
    const now = new Date();
    const mexicoTime = new Date(now.toLocaleString("en-US", { timeZone: "America/Mexico_City" }));
    // Set to 8:00 AM
    const nextExecution = new Date(mexicoTime);
    nextExecution.setHours(8, 0, 0, 0);
    // If it's already past 8 AM today, or it's weekend, find next weekday
    if (nextExecution <= mexicoTime || nextExecution.getDay() === 0 || nextExecution.getDay() === 6) {
        do {
            nextExecution.setDate(nextExecution.getDate() + 1);
            nextExecution.setHours(8, 0, 0, 0);
        } while (nextExecution.getDay() === 0 || nextExecution.getDay() === 6); // Skip weekends
    }
    return nextExecution;
}
/**
 * Create a simple daily stand up schedule for a site
 */
async function createSimpleDailyStandUpSchedule(site) {
    const scheduleId = `daily-standup-${site.id}`;
    const workflowId = `${scheduleId}-${Date.now()}`;
    try {
        const client = await (0, client_1.getTemporalClient)();
        // Default schedule: Monday to Friday at 8 AM Mexico time
        const cronExpression = '0 8 * * 1-5'; // 8 AM on weekdays
        const timezone = 'America/Mexico_City';
        console.log(`🕐 Creating simple schedule: "${cronExpression}" (${timezone})`);
        // Create the schedule
        await client.schedule.create({
            scheduleId,
            spec: {
                cron: cronExpression,
                timezone
            },
            action: {
                type: 'startWorkflow',
                workflowType: 'dailyStandUpWorkflow',
                taskQueue: config_1.temporalConfig.taskQueue,
                args: [{
                        site_id: site.id,
                        userId: site.user_id,
                        additionalData: {
                            scheduledBy: 'activityPrioritizationEngine',
                            scheduleTime: '08:00',
                            workingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
                            timezone
                        }
                    }],
                workflowId: `daily-standup-${site.id}-${Date.now()}`,
            },
            policies: {
                catchupWindow: '1h',
                overlap: 'SKIP',
                pauseOnFailure: false
            }
        });
        console.log(`✅ Successfully created simple schedule for ${site.name}`);
        return { workflowId, scheduleId, success: true };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Failed to create simple schedule for ${site.name}: ${errorMessage}`);
        return { workflowId, scheduleId, success: false, error: errorMessage };
    }
}
