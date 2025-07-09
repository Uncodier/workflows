"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendNewsletterWorkflow = sendNewsletterWorkflow;
const workflow_1 = require("@temporalio/workflow");
const timeouts_1 = require("../config/timeouts");
// Configure activity options using centralized timeouts
const { validateEmailConfigurationActivity, getLeadsBySegmentsActivity, sendNewsletterEmailActivity } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: timeouts_1.ACTIVITY_TIMEOUTS.EMAIL_OPERATIONS, // 3 minutes
    retry: timeouts_1.RETRY_POLICIES.NETWORK, // Appropriate retry policy for network operations
});
/**
 * Send Newsletter Workflow
 * Sends newsletter emails to leads based on segments and status
 *
 * Steps:
 * 1. Validate email configuration exists for the site
 * 2. Get leads by segments and status (filters are optional)
 * 3. Send emails one by one using sendEmailFromAgent workflow
 * 4. Return comprehensive results
 *
 * Business Rules:
 * - Filters (segments_ids, status) are optional
 * - Always looks for leads with email
 * - If more than 500, brings the latest 500 by creation date
 */
async function sendNewsletterWorkflow(params) {
    console.log('📧 Starting send newsletter workflow...');
    console.log(`   - Site ID: ${params.site_id}`);
    console.log(`   - Subject: ${params.subject}`);
    console.log(`   - Segments: ${params.segments_ids?.length ? params.segments_ids.join(', ') : 'All segments (no filter)'}`);
    console.log(`   - Status: ${params.status?.length ? params.status.join(', ') : 'All statuses (no filter)'}`);
    console.log(`   - Max emails: ${params.maxEmails || 500}`);
    const startTime = new Date();
    try {
        // Step 1: Validate email configuration exists for the site
        console.log('🔍 Step 1: Validating email configuration...');
        const emailConfigResult = await validateEmailConfigurationActivity({
            site_id: params.site_id
        });
        if (!emailConfigResult.success) {
            console.error('❌ Failed to validate email configuration:', emailConfigResult.error);
            return {
                success: false,
                emailsSent: 0,
                emailsFailed: 0,
                totalLeads: 0,
                leadsProcessed: 0,
                emailConfigValid: false,
                executionTime: `${new Date().getTime() - startTime.getTime()}ms`,
                timestamp: new Date().toISOString(),
                error: `Email configuration validation failed: ${emailConfigResult.error}`
            };
        }
        if (!emailConfigResult.hasEmailConfig) {
            console.error('❌ Email configuration not found or invalid');
            return {
                success: false,
                emailsSent: 0,
                emailsFailed: 0,
                totalLeads: 0,
                leadsProcessed: 0,
                emailConfigValid: false,
                executionTime: `${new Date().getTime() - startTime.getTime()}ms`,
                timestamp: new Date().toISOString(),
                error: `Email configuration not found or invalid: ${emailConfigResult.error}`
            };
        }
        console.log('✅ Email configuration validated successfully');
        // Step 2: Get leads by segments and status (optional filters)
        console.log('👥 Step 2: Getting leads with optional filters...');
        const leadsResult = await getLeadsBySegmentsActivity({
            site_id: params.site_id,
            segment_ids: params.segments_ids || [], // Empty array if not provided
            status: params.status || [], // Empty array if not provided
            limit: params.maxEmails || 500
        });
        if (!leadsResult.success) {
            console.error('❌ Failed to fetch leads:', leadsResult.error);
            return {
                success: false,
                emailsSent: 0,
                emailsFailed: 0,
                totalLeads: 0,
                leadsProcessed: 0,
                emailConfigValid: true,
                executionTime: `${new Date().getTime() - startTime.getTime()}ms`,
                timestamp: new Date().toISOString(),
                error: `Failed to fetch leads: ${leadsResult.error}`
            };
        }
        if (leadsResult.leads.length === 0) {
            console.log('⚠️  No leads found matching the criteria');
            return {
                success: true,
                emailsSent: 0,
                emailsFailed: 0,
                totalLeads: 0,
                leadsProcessed: 0,
                emailConfigValid: true,
                executionTime: `${new Date().getTime() - startTime.getTime()}ms`,
                timestamp: new Date().toISOString(),
                error: 'No leads found with valid email addresses'
            };
        }
        console.log(`✅ Found ${leadsResult.leads.length} leads to process`);
        // Step 3: Send newsletter emails
        console.log('📧 Step 3: Sending newsletter emails...');
        const emailResult = await sendNewsletterEmailActivity({
            leads: leadsResult.leads,
            site_id: params.site_id,
            subject: params.subject,
            message: params.message,
            maxEmails: params.maxEmails || 500
        });
        if (!emailResult.success) {
            console.error('❌ Newsletter sending failed:', emailResult.error);
            return {
                success: false,
                emailsSent: emailResult.emailsSent,
                emailsFailed: emailResult.emailsFailed,
                totalLeads: leadsResult.leads.length,
                leadsProcessed: emailResult.emailsSent + emailResult.emailsFailed,
                emailConfigValid: true,
                executionTime: `${new Date().getTime() - startTime.getTime()}ms`,
                timestamp: new Date().toISOString(),
                error: `Newsletter sending failed: ${emailResult.error}`,
                results: emailResult.results
            };
        }
        const endTime = new Date();
        const executionTime = `${endTime.getTime() - startTime.getTime()}ms`;
        console.log('🎉 Newsletter workflow completed successfully');
        console.log(`   - Total leads found: ${leadsResult.leads.length}`);
        console.log(`   - Emails sent: ${emailResult.emailsSent}`);
        console.log(`   - Emails failed: ${emailResult.emailsFailed}`);
        console.log(`   - Total processed: ${emailResult.emailsSent + emailResult.emailsFailed}`);
        console.log(`   - Execution time: ${executionTime}`);
        return {
            success: true,
            emailsSent: emailResult.emailsSent,
            emailsFailed: emailResult.emailsFailed,
            totalLeads: leadsResult.leads.length,
            leadsProcessed: emailResult.emailsSent + emailResult.emailsFailed,
            emailConfigValid: true,
            executionTime,
            timestamp: new Date().toISOString(),
            results: emailResult.results
        };
    }
    catch (error) {
        const endTime = new Date();
        const executionTime = `${endTime.getTime() - startTime.getTime()}ms`;
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('❌ Send newsletter workflow failed:', errorMessage);
        return {
            success: false,
            emailsSent: 0,
            emailsFailed: 0,
            totalLeads: 0,
            leadsProcessed: 0,
            emailConfigValid: false,
            executionTime,
            timestamp: new Date().toISOString(),
            error: errorMessage
        };
    }
}
