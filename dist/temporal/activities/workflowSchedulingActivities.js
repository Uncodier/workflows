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
exports.executeDailyStandUpWorkflowsActivity = executeDailyStandUpWorkflowsActivity;
exports.scheduleDailyOperationsWorkflowActivity = scheduleDailyOperationsWorkflowActivity;
exports.scheduleIndividualDailyStandUpsActivity = scheduleIndividualDailyStandUpsActivity;
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
 * Execute daily stand up workflows for sites with active business hours
 *
 * @param options.dryRun - If true, only simulates execution without running real workflows
 * @param options.testMode - If true, adds safety checks and limits to prevent production issues
 * @param options.maxSites - Maximum number of sites to process (useful for testing)
 * @param options.businessHoursAnalysis - Business hours analysis from prioritization engine for filtering sites
 */
async function executeDailyStandUpWorkflowsActivity(options = {}) {
    console.log('🌅 Starting Daily Stand Up workflow execution...');
    const { businessHoursAnalysis } = options;
    if (businessHoursAnalysis) {
        console.log('📋 BUSINESS HOURS FILTERING ENABLED:');
        console.log(`   - Sites with business_hours: ${businessHoursAnalysis.sitesWithBusinessHours}`);
        console.log(`   - Sites open today: ${businessHoursAnalysis.sitesOpenToday}`);
        console.log(`   - Will execute for filtered sites only`);
    }
    else {
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
    const results = [];
    const errors = [];
    let scheduled = 0;
    let failed = 0;
    const testInfo = {
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
        const supabaseService = (0, supabaseService_1.getSupabaseService)();
        // Check database connection
        const isConnected = await supabaseService.getConnectionStatus();
        if (!isConnected) {
            throw new Error('Database not available for workflow execution');
        }
        let sitesToProcess = [];
        if (businessHoursAnalysis && businessHoursAnalysis.openSites.length > 0) {
            // FILTERED MODE: Only process sites with active business hours
            console.log('🔍 Using business hours filtering...');
            const allSites = await supabaseService.fetchSites();
            const openSiteIds = businessHoursAnalysis.openSites.map((site) => site.siteId);
            sitesToProcess = allSites.filter(site => openSiteIds.includes(site.id));
            console.log(`✅ Found ${allSites.length} total sites, filtered to ${sitesToProcess.length} sites with active business hours`);
            if (businessHoursAnalysis.openSites.length > 0) {
                console.log('📊 Sites to process:');
                businessHoursAnalysis.openSites.forEach((site) => {
                    console.log(`   • Site ${site.siteId}: ${site.businessHours.open} - ${site.businessHours.close}`);
                });
            }
        }
        else {
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
                }
                else {
                    failed++;
                    const error = `Failed to execute Daily Stand Up for ${site.name}: ${workflowResult.error}`;
                    errors.push(error);
                    console.error(`❌ ${error}`);
                }
            }
            catch (siteError) {
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
    }
    catch (error) {
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
async function executeDailyStandUpWorkflow(site, executionOptions) {
    const workflowId = `daily-standup-${site.id}-${Date.now()}`;
    try {
        const client = await (0, client_1.getTemporalClient)();
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
                        businessHoursAnalysis: executionOptions.businessHoursAnalysis
                    }
                }],
            taskQueue: config_1.temporalConfig.taskQueue,
            workflowId: workflowId,
        });
        console.log(`✅ Daily Stand Up workflow started for ${site.name}`);
        console.log(`   Workflow ID: ${handle.workflowId}`);
        return { workflowId, scheduleId: executionOptions.scheduleType, success: true };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Failed to execute Daily Stand Up workflow for ${site.name}: ${errorMessage}`);
        return { workflowId, scheduleId: executionOptions.scheduleType, success: false, error: errorMessage };
    }
}
// Removed calculateNextDailyStandUpTime function as it's not used
// Removed isValidBusinessDay function as it's not used
/**
 * Schedule Daily Operations Workflow for later execution
 * Creates a Temporal schedule to run dailyOperationsWorkflow at a specific time
 */
async function scheduleDailyOperationsWorkflowActivity(scheduledTime, // Format: "HH:MM" (e.g., "09:00")
businessHoursAnalysis, options = {}) {
    const { timezone = 'America/Mexico_City' } = options;
    console.log(`📅 Scheduling Daily Operations Workflow for ${scheduledTime}`);
    console.log(`   - Timezone: ${timezone}`);
    console.log(`   - Target time: ${scheduledTime}`);
    try {
        const client = await (0, client_1.getTemporalClient)();
        const scheduleClient = client.schedule;
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
        let finalTargetLocal;
        let scheduleForTomorrow;
        if (targetAlreadyPassed) {
            // Schedule for tomorrow in local timezone
            finalTargetLocal = new Date(targetLocalToday);
            finalTargetLocal.setUTCDate(finalTargetLocal.getUTCDate() + 1);
            scheduleForTomorrow = true;
            console.log(`   ⏰ Target time already passed in ${timezone} TODAY, scheduling for TOMORROW`);
        }
        else {
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
        // Create the schedule
        await scheduleClient.create({
            scheduleId,
            spec: {
                cron: cronExpression
            },
            action: {
                type: 'startWorkflow',
                workflowType: 'dailyOperationsWorkflow',
                taskQueue: config_1.temporalConfig.taskQueue,
                args: workflowArgs,
                workflowId: `${workflowId}-execution`,
            },
            timeZone: timezone,
            policies: {
                catchupWindow: '5m',
                overlap: 'SKIP',
                pauseOnFailure: false,
            },
            state: {
                note: `Scheduled daily operations for ${scheduledTime} on ${finalLocalDateStr} (${timezone})`,
                paused: false,
            },
        });
        const executionMessage = scheduleForTomorrow ?
            `Will execute TOMORROW (${finalLocalDateStr}) at ${scheduledTime} ${timezone}` :
            `Will execute TODAY (${finalLocalDateStr}) at ${scheduledTime} ${timezone}`;
        console.log(`✅ Successfully scheduled Daily Operations workflow`);
        console.log(`   - ${executionMessage}`);
        console.log(`   - Schedule ID: ${scheduleId}`);
        // Update cron status to reflect the scheduled workflow
        const cronUpdate = {
            siteId: 'global', // This is a global schedule
            workflowId: scheduleId,
            scheduleId,
            activityName: 'dailyOperationsWorkflow',
            status: 'SCHEDULED',
            nextRun: finalTargetUTC.toISOString(),
        };
        await (0, cronActivities_1.saveCronStatusActivity)(cronUpdate);
        return {
            workflowId: scheduleId,
            scheduleId,
            success: true
        };
    }
    catch (error) {
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
 * Creates delayed workflow executions for each site based on their specific business hours
 * Uses Temporal timers instead of schedules for one-time executions
 */
async function scheduleIndividualDailyStandUpsActivity(businessHoursAnalysis, options = {}) {
    const { timezone = 'America/Mexico_City' } = options;
    console.log(`📅 Scheduling individual Daily Stand Up workflows using TIMERS`);
    console.log(`   - Default timezone: ${timezone}`);
    console.log(`   - Sites with business_hours: ${businessHoursAnalysis.openSites?.length || 0}`);
    const results = [];
    const errors = [];
    let scheduled = 0;
    let failed = 0;
    try {
        const client = await (0, client_1.getTemporalClient)();
        const supabaseService = (0, supabaseService_1.getSupabaseService)();
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
            businessHoursAnalysis.openSites.forEach((site) => {
                sitesWithBusinessHours.set(site.siteId, site.businessHours);
            });
        }
        // Process ALL sites (both with and without business_hours)
        for (const site of allSites) {
            try {
                console.log(`\n📋 Processing site: ${site.name || 'Unnamed'} (${site.id})`);
                // Check if this site has business_hours
                const businessHours = sitesWithBusinessHours.get(site.id);
                let scheduledTime;
                let siteTimezone;
                let businessHoursSource;
                if (businessHours) {
                    // Site HAS business_hours - use them
                    scheduledTime = businessHours.open; // e.g., "09:00"
                    siteTimezone = businessHours.timezone || timezone;
                    businessHoursSource = 'database-configured';
                    console.log(`   ✅ Has business_hours: ${businessHours.open} - ${businessHours.close} ${siteTimezone}`);
                }
                else {
                    // Site DOES NOT have business_hours - use fallback
                    scheduledTime = "09:00"; // Default fallback time
                    siteTimezone = timezone; // Default timezone
                    businessHoursSource = 'fallback-default';
                    console.log(`   ⚠️ No business_hours found - using FALLBACK: ${scheduledTime} ${siteTimezone}`);
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
                let finalTargetLocal;
                if (targetAlreadyPassed) {
                    finalTargetLocal = new Date(targetLocalToday);
                    finalTargetLocal.setUTCDate(finalTargetLocal.getUTCDate() + 1);
                    console.log(`   ⏰ Target time already passed, scheduling for TOMORROW`);
                }
                else {
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
                }
                else {
                    const delayHours = delayMs / (1000 * 60 * 60);
                    console.log(`   ⏰ Will execute in ${delayHours.toFixed(2)} hours`);
                }
                // Create unique workflow ID for this site
                const workflowId = `daily-standup-timer-${site.id}-${Date.now()}`;
                console.log(`   - Workflow ID: ${workflowId}`);
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
                            targetTimeUTC: finalTargetUTC.toISOString()
                        }
                    }];
                // Start the DELAYED workflow instead of creating a schedule
                await client.workflow.start('delayedExecutionWorkflow', {
                    args: [{
                            delayMs: Math.max(delayMs, 0), // Ensure non-negative delay
                            targetWorkflow: 'dailyStandUpWorkflow',
                            targetArgs: workflowArgs,
                            siteName: site.name || 'Site',
                            scheduledTime: `${scheduledTime} ${siteTimezone}`,
                            executionType: 'timer-based-standup'
                        }],
                    taskQueue: config_1.temporalConfig.taskQueue,
                    workflowId: workflowId,
                    workflowRunTimeout: '48h', // Allow up to 48 hours for the delay
                });
                console.log(`✅ Successfully scheduled Daily Stand Up with TIMER for ${site.name || 'Site'}`);
                console.log(`   - Will execute at: ${scheduledTime} ${siteTimezone} on ${finalLocalDateStr}`);
                console.log(`   - Business hours source: ${businessHoursSource}`);
                console.log(`   - Using TIMER approach instead of schedule`);
                // Update cron status to reflect the scheduled workflow
                const cronUpdate = {
                    siteId: site.id,
                    workflowId: workflowId,
                    scheduleId: workflowId, // Use workflowId as scheduleId for timers
                    activityName: 'dailyStandUpWorkflow-timer',
                    status: 'SCHEDULED',
                    nextRun: finalTargetUTC.toISOString(),
                };
                await (0, cronActivities_1.saveCronStatusActivity)(cronUpdate);
                results.push({
                    workflowId: workflowId,
                    scheduleId: workflowId,
                    success: true
                });
                scheduled++;
            }
            catch (siteError) {
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
    }
    catch (error) {
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
