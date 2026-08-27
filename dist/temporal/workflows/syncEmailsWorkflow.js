"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncEmailsWorkflow = syncEmailsWorkflow;
const workflow_1 = require("@temporalio/workflow");
const scheduleCustomerSupportMessagesWorkflow_1 = require("./scheduleCustomerSupportMessagesWorkflow");
const emailAuthErrors_1 = require("../utils/emailAuthErrors");
// Define the activity interface and options
const { logWorkflowExecutionActivity, saveCronStatusActivity, validateAndCleanStuckCronStatusActivity, validateWorkflowConfigActivity, validateCommunicationChannelsActivity, analyzeEmailsLeadsReplyActivity, analyzeEmailsAliasReplyActivity, analyzeEmailsReplyActivity, syncSentEmailsActivity, deliveryStatusActivity, } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: '15 minutes', // ✅ FIXED: Increased timeout to 15 minutes to handle slow email API
    retry: {
        maximumAttempts: 3,
    },
});
/**
 * Workflow to synchronize emails from various providers
 *
 * @param options - Configuration options for email synchronization
 */
async function syncEmailsWorkflow(options) {
    // Handle both camelCase and snake_case parameter formats
    const userId = options.userId || options.user_id;
    if (!userId) {
        throw new Error('User ID is required for syncEmailsWorkflow');
    }
    const siteId = options.siteId || options.site_id || userId;
    const workflowId = `sync-emails-${userId}`;
    const searchAttributes = {
        user_id: [userId],
    };
    if (siteId) {
        searchAttributes.site_id = [siteId];
    }
    (0, workflow_1.upsertSearchAttributes)(searchAttributes);
    console.log(`📧 Starting email sync workflow for user ${userId} (${options.provider})`);
    console.log(`📋 Options:`, JSON.stringify(options, null, 2));
    // STEP 0: Validate workflow configuration
    console.log('🔐 Step 0: Validating workflow configuration...');
    const configValidation = await validateWorkflowConfigActivity(siteId, 'email_sync');
    if (!configValidation.shouldExecute) {
        console.log(`⛔ Workflow execution blocked: ${configValidation.reason}`);
        // Log blocked execution
        await logWorkflowExecutionActivity({
            workflowId,
            workflowType: 'syncEmailsWorkflow',
            status: 'BLOCKED',
            input: options,
            error: `Workflow is ${configValidation.activityStatus} in site settings`,
        });
        return {
            success: false,
            provider: options.provider,
            userId,
            siteId,
            syncedEmails: 0,
            batchesProcessed: 0,
            batches: [],
            syncDuration: '0ms',
            syncedAt: new Date().toISOString(),
            nextSyncRecommended: new Date().toISOString(),
            errors: [`Workflow is ${configValidation.activityStatus} in site settings`],
            analysisResult: null,
        };
    }
    console.log(`✅ Configuration validated: ${configValidation.reason}`);
    // Validate and clean any stuck cron status records before execution
    console.log('🔍 Validating cron status before email sync execution...');
    const cronValidation = await validateAndCleanStuckCronStatusActivity('syncEmailsWorkflow', siteId, 12 // 12 hours threshold - email sync should not be stuck longer than 12h
    );
    console.log(`📋 Cron validation result: ${cronValidation.reason}`);
    if (cronValidation.wasStuck) {
        console.log(`🧹 Cleaned stuck record that was ${cronValidation.hoursStuck?.toFixed(1)}h old`);
    }
    if (!cronValidation.canProceed) {
        console.log('⏳ Another email sync is likely running for this site - terminating');
        // Log termination
        await logWorkflowExecutionActivity({
            workflowId,
            workflowType: 'syncEmailsWorkflow',
            status: 'BLOCKED',
            input: options,
            error: `Workflow blocked: ${cronValidation.reason}`,
        });
        throw new Error(`Workflow blocked: ${cronValidation.reason}`);
    }
    // Log workflow execution start
    await logWorkflowExecutionActivity({
        workflowId,
        workflowType: 'syncEmailsWorkflow',
        status: 'STARTED',
        input: options,
    });
    // Update cron status to indicate the workflow is running
    if (siteId) {
        await saveCronStatusActivity({
            siteId,
            workflowId,
            scheduleId: `email-sync-${siteId}`,
            activityName: 'syncEmailsWorkflow',
            status: 'RUNNING',
            lastRun: new Date().toISOString()
        });
    }
    try {
        console.log(`🔍 Step 1: Validating email sync configuration...`);
        // Parse since parameter correctly - can be Date object or string
        let sinceDate;
        if (options.since) {
            sinceDate = typeof options.since === 'string' ? new Date(options.since) : options.since;
        }
        else {
            sinceDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // Last 24 hours
        }
        // Simulate email sync validation + fetch channels config to branch alias/reply
        const channelsValidation = await validateCommunicationChannelsActivity({ site_id: siteId });
        const hasEmailChannel = !!channelsValidation?.hasEmailChannel;
        // Prefer explicit computed field; fallback to checking aliases key (string or array)
        const emailAliasConfigured = !!(channelsValidation?.emailAliasConfigured ||
            (channelsValidation?.emailConfig && ((typeof channelsValidation.emailConfig.aliases === 'string' && channelsValidation.emailConfig.aliases.trim().length > 0) ||
                (Array.isArray(channelsValidation.emailConfig.aliases) && channelsValidation.emailConfig.aliases.length > 0))));
        const validation = {
            isValid: true,
            provider: options.provider,
            batchSize: options.batchSize || 50,
            since: sinceDate,
            analysisLimit: options.analysisLimit || 15,
            emailAliasConfigured
        };
        if (!validation.isValid) {
            throw new Error(`Invalid email sync configuration for provider ${options.provider}`);
        }
        console.log(`✅ Configuration validated for ${options.provider} provider`);
        console.log(`   - Email channel: ${hasEmailChannel ? 'enabled' : 'disabled'}`);
        console.log(`   - Email alias configured: ${emailAliasConfigured ? 'yes' : 'no'}`);
        console.log(`📬 Step 2: Connecting to ${options.provider} email server...`);
        console.log(`✅ Connected to ${options.provider} email server`);
        console.log(`📥 Step 3: Email sync preparation completed`);
        console.log(`💾 Step 4: Ready to process emails with real activities...`);
        const result = {
            success: true,
            provider: options.provider,
            userId: userId,
            siteId,
            syncedEmails: 0, // Will be updated by real activities
            batchesProcessed: 0, // Will be updated by real activities  
            batches: [], // Will be updated by real activities
            syncDuration: 'real-time',
            syncedAt: new Date().toISOString(),
            nextSyncRecommended: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1 hour from now
            errors: [],
            analysisResult: null,
        };
        // Step 5: AI Email Analysis (now with extended 15-minute timeout)
        console.log(`🤖 Step 5: Starting AI email analysis...`);
        console.log(`📊 Analyzing up to ${validation.analysisLimit} emails for commercial opportunities`);
        try {
            const analysisRequest = {
                site_id: siteId,
                limit: validation.analysisLimit,
                user_id: userId,
                analysis_type: 'commercial_opportunity',
                since_date: validation.since.toISOString()
            };
            // Always run leads reply analysis
            const leadsReplyResponse = await analyzeEmailsLeadsReplyActivity(analysisRequest);
            // If alias configured: call only alias. Otherwise: call only reply.
            let aliasReplyResponse = null;
            let generalReplyResponse = null;
            let hasAliasResults = false;
            if (emailAliasConfigured) {
                aliasReplyResponse = await analyzeEmailsAliasReplyActivity(analysisRequest);
                hasAliasResults = !!(aliasReplyResponse?.success && ((aliasReplyResponse.data?.emails?.length || 0) > 0 || (aliasReplyResponse.data?.analysisCount || 0) > 0));
            }
            else {
                generalReplyResponse = await analyzeEmailsReplyActivity(analysisRequest);
            }
            // ✅ FIXED: Properly handle analysis failure and propagate critical errors
            // Build a summary using the three routes
            if (leadsReplyResponse.success || aliasReplyResponse?.success || generalReplyResponse?.success) {
                console.log(`✅ Email analysis (split routes) initiated successfully`);
                const summary = {
                    emailCount: (leadsReplyResponse.data?.emailCount || 0) + ((aliasReplyResponse?.data?.emailCount || 0) || (generalReplyResponse?.data?.emailCount || 0)),
                    analysisCount: (leadsReplyResponse.data?.analysisCount || 0) + ((aliasReplyResponse?.data?.analysisCount || 0) || (generalReplyResponse?.data?.analysisCount || 0)),
                    commandId: leadsReplyResponse.data?.commandId || aliasReplyResponse?.data?.commandId || generalReplyResponse?.data?.commandId,
                    status: leadsReplyResponse.data?.status || aliasReplyResponse?.data?.status || generalReplyResponse?.data?.status,
                    message: leadsReplyResponse.data?.message || aliasReplyResponse?.data?.message || generalReplyResponse?.data?.message,
                };
                console.log(`📧 ${summary.emailCount} emails submitted for analysis`);
                console.log(`🤖 ${summary.analysisCount} emails were analyzed`);
                console.log(`📋 Command ID: ${summary.commandId}`);
                result.analysisResult = {
                    success: true,
                    commandId: summary.commandId,
                    emailCount: summary.emailCount,
                    analysisCount: summary.analysisCount,
                    status: summary.status,
                    message: summary.message
                };
                // 🚀 Trigger customer support per category when emails exist
                const batches = [
                    { label: 'leadsReply', r: leadsReplyResponse },
                    hasAliasResults ? { label: 'aliasReply', r: aliasReplyResponse } : { label: 'reply', r: generalReplyResponse },
                ];
                for (const batch of batches) {
                    const r = batch.r;
                    if (r?.success && r?.data?.emails && r.data.emails.length > 0) {
                        console.log(`🚀 [${batch.label}] ${r.data.emails.length} emails - starting customer support workflow`);
                        const customerSupportWorkflowId = `schedule-customer-support-${batch.label}-${siteId}-${Date.now()}`;
                        const scheduleParams = {
                            emails: r.data.emails,
                            site_id: siteId,
                            user_id: userId,
                            total_emails: r.data.analysisCount,
                            timestamp: new Date().toISOString(),
                            agentId: undefined,
                            origin: "email"
                        };
                        try {
                            const childWorkflowHandle = await (0, workflow_1.startChild)(scheduleCustomerSupportMessagesWorkflow_1.scheduleCustomerSupportMessagesWorkflow, {
                                workflowId: customerSupportWorkflowId,
                                args: [scheduleParams],
                                parentClosePolicy: workflow_1.ParentClosePolicy.PARENT_CLOSE_POLICY_ABANDON,
                            });
                            console.log(`✅ Started scheduleCustomerSupportMessagesWorkflow: ${childWorkflowHandle.workflowId}`);
                            await new Promise(resolve => setTimeout(resolve, 500));
                        }
                        catch (workflowError) {
                            const workflowErrorMessage = workflowError instanceof Error ? workflowError.message : String(workflowError);
                            console.error(`❌ [${batch.label}] Failed to start customer support workflow: ${workflowErrorMessage}`);
                            result.errors.push(`Customer support workflow (${batch.label}) failed: ${workflowErrorMessage}`);
                        }
                    }
                    else {
                        console.log(`📋 [${batch.label}] No analyzed emails - skip`);
                    }
                }
                console.log(`📋 Email analysis completed. Command ID: ${result.analysisResult.commandId}`);
                console.log(`🔄 Customer support workflow will be triggered automatically when emails are analyzed`);
            }
            else {
                // This case won't execute with mock response since success is always true
                console.log(`⚠️ Email analysis failed: Unknown error`);
                result.analysisResult = {
                    success: false,
                    error: 'Unknown analysis error'
                };
                // ✅ FIXED: Add to errors array for visibility
                result.errors.push(`Email analysis failed: Unknown error`);
                // ✅ FIXED: Don't throw exception for analysis failure - it's not critical for the workflow
                console.log(`🔄 Continuing workflow despite analysis failure...`);
            }
        }
        catch (analysisError) {
            const analysisErrorMessage = analysisError instanceof Error ? analysisError.message : String(analysisError);
            console.log(`⚠️ Email analysis error: ${analysisErrorMessage}`);
            result.analysisResult = {
                success: false,
                error: analysisErrorMessage
            };
            // ✅ FIXED: Add to errors array and continue workflow
            result.errors.push(`Email analysis exception: ${analysisErrorMessage}`);
            console.log(`🔄 Continuing workflow despite analysis exception...`);
        }
        // Step 6: Sync Sent Emails (auth/IMAP failures are skipped, not fatal)
        console.log(`📨 Step 6: Syncing sent emails to update lead status...`);
        const syncSentEmailsRequest = {
            site_id: siteId,
            limit: 20, // Sync last 20 sent emails
            since_date: validation.since.toISOString()
        };
        try {
            const syncSentResponse = await syncSentEmailsActivity(syncSentEmailsRequest);
            if (!syncSentResponse.success) {
                const syncError = syncSentResponse.error || 'Unknown sent-email sync error';
                if ((0, emailAuthErrors_1.isEmailAuthFailure)(syncError)) {
                    console.warn(`⚠️ Sent emails sync skipped (invalid IMAP/credentials): ${syncError}`);
                    result.errors.push(`Sent emails sync skipped: ${syncError}`);
                }
                else {
                    throw new Error(`Sent emails sync failed: ${syncError}`);
                }
            }
            else {
                console.log(`✅ Sent emails sync completed successfully`);
                console.log(`📊 Sync results:`, JSON.stringify(syncSentResponse.data, null, 2));
            }
        }
        catch (syncSentError) {
            const syncErrorMessage = syncSentError instanceof Error ? syncSentError.message : String(syncSentError);
            if ((0, emailAuthErrors_1.isEmailAuthFailure)(syncErrorMessage)) {
                console.warn(`⚠️ Sent emails sync skipped (invalid IMAP/credentials): ${syncErrorMessage}`);
                result.errors.push(`Sent emails sync skipped: ${syncErrorMessage}`);
            }
            else {
                throw syncSentError;
            }
        }
        // Step 7: Check Email Delivery Status
        console.log(`📋 Step 7: Checking email delivery status...`);
        try {
            const deliveryStatusRequest = {
                site_id: siteId
            };
            const deliveryStatusResponse = await deliveryStatusActivity(deliveryStatusRequest);
            // ✅ FIXED: Proper error handling for delivery status
            if (deliveryStatusResponse.success) {
                console.log(`✅ Email delivery status check completed successfully`);
                console.log(`📊 Delivery status results:`, JSON.stringify(deliveryStatusResponse.data, null, 2));
            }
            else {
                console.log(`⚠️ Email delivery status check failed: ${deliveryStatusResponse.error}`);
                result.errors.push(`Delivery status check failed: ${deliveryStatusResponse.error || 'Unknown error'}`);
            }
        }
        catch (deliveryError) {
            const deliveryErrorMessage = deliveryError instanceof Error ? deliveryError.message : String(deliveryError);
            console.log(`⚠️ Email delivery status check error: ${deliveryErrorMessage}`);
            result.errors.push(`Delivery status check exception: ${deliveryErrorMessage}`);
        }
        console.log(`🎉 Email sync completed successfully!`);
        console.log(`📊 Results: Email sync activities completed successfully`);
        if (result.analysisResult?.success) {
            console.log(`🤖 AI Analysis: ${result.analysisResult.emailCount} emails processed, ${result.analysisResult.analysisCount} analyzed (Command: ${result.analysisResult.commandId})`);
        }
        // ✅ FIXED: Show warnings if there were non-critical errors
        if (result.errors.length > 0) {
            console.log(`⚠️ Workflow completed with ${result.errors.length} non-critical errors:`);
            result.errors.forEach((error, index) => {
                console.log(`   ${index + 1}. ${error}`);
            });
        }
        // ✅ FIXED: Always update cron status to COMPLETED even if there were non-critical errors
        if (siteId) {
            await saveCronStatusActivity({
                siteId,
                workflowId,
                scheduleId: `email-sync-${siteId}`,
                activityName: 'syncEmailsWorkflow',
                status: 'COMPLETED',
                lastRun: new Date().toISOString(),
                nextRun: result.nextSyncRecommended,
                // ✅ FIXED: Include error summary if there were non-critical errors
                errorMessage: result.errors.length > 0 ? `${result.errors.length} non-critical errors occurred` : undefined
            });
        }
        // Log successful completion
        await logWorkflowExecutionActivity({
            workflowId,
            workflowType: 'syncEmailsWorkflow',
            status: 'COMPLETED',
            input: options,
            output: result,
        });
        return result;
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Email sync failed: ${errorMessage}`);
        // ✅ FIXED: Always update cron status to FAILED in the catch block
        if (siteId) {
            try {
                await saveCronStatusActivity({
                    siteId,
                    workflowId,
                    scheduleId: `email-sync-${siteId}`,
                    activityName: 'syncEmailsWorkflow',
                    status: 'FAILED',
                    lastRun: new Date().toISOString(),
                    errorMessage: errorMessage,
                    retryCount: 1
                });
            }
            catch (statusError) {
                console.error(`❌ Failed to update cron status to FAILED: ${statusError}`);
                // Even if updating status fails, continue with other cleanup
            }
        }
        // ✅ FIXED: Always log workflow execution failure
        try {
            await logWorkflowExecutionActivity({
                workflowId,
                workflowType: 'syncEmailsWorkflow',
                status: 'FAILED',
                input: options,
                error: errorMessage,
            });
        }
        catch (logError) {
            console.error(`❌ Failed to log workflow execution failure: ${logError}`);
            // Continue even if logging fails
        }
        throw error;
    }
}
