"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.leadAttentionWorkflow = leadAttentionWorkflow;
const workflow_1 = require("@temporalio/workflow");
const timeouts_1 = require("../config/timeouts");
// Configure activity options using centralized timeouts
const { checkExistingLeadNotificationActivity, getLeadActivity, leadAttentionActivity } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: timeouts_1.ACTIVITY_TIMEOUTS.DEFAULT, // ✅ Using centralized config (2 minutes)
    retry: timeouts_1.RETRY_POLICIES.NETWORK, // ✅ Using appropriate retry policy for network operations
});
/**
 * Lead Attention Workflow
 * Checks if a lead has an assignee_id and sends a lead attention notification via the external API
 * Only sends notification if the lead has an assignee_id, otherwise skips silently
 */
async function leadAttentionWorkflow(params) {
    console.log('🔔 WORKFLOW START: Starting lead attention workflow...');
    console.log(`📋 WORKFLOW: Lead ID: ${params.lead_id}`);
    console.log(`📝 WORKFLOW: User message: ${params.user_message ? 'included' : 'not provided'}`);
    console.log(`📝 WORKFLOW: System message: ${params.system_message ? 'included' : 'not provided'}`);
    console.log(`📋 WORKFLOW: Full params:`, JSON.stringify(params, null, 2));
    const startTime = new Date();
    try {
        // Validate required parameters
        if (!params.lead_id) {
            throw new Error('Missing required parameter: lead_id is required');
        }
        console.log('🔍 WORKFLOW: Checking lead attention notification requirements:', {
            lead_id: params.lead_id,
            user_message: params.user_message ? 'included' : 'not provided',
            system_message: params.system_message ? 'included' : 'not provided'
        });
        // STEP 1: Check for existing notifications today
        console.log('🚀 WORKFLOW: Step 1 - Checking for existing notifications...');
        const existingNotificationResult = await checkExistingLeadNotificationActivity({
            lead_id: params.lead_id
        });
        console.log('🚀 WORKFLOW: Step 1 result:', JSON.stringify(existingNotificationResult, null, 2));
        if (!existingNotificationResult.success) {
            console.error('❌ WORKFLOW: Step 1 failed - could not check existing notifications');
            throw new Error(existingNotificationResult.error || 'Failed to check existing notifications');
        }
        if (existingNotificationResult.exists) {
            console.log('⏭️ WORKFLOW: Step 1 SKIP - notification already sent today');
            const endTime = new Date();
            const executionTime = `${endTime.getTime() - startTime.getTime()}ms`;
            return {
                success: true,
                data: {
                    skipped: true,
                    reason: 'Notification already sent today',
                    lastNotification: existingNotificationResult.lastNotification
                },
                executionTime,
                timestamp: endTime.toISOString()
            };
        }
        // STEP 2: Get lead information and check assignee_id
        console.log('🚀 WORKFLOW: Step 2 - Getting lead information...');
        const leadResult = await getLeadActivity(params.lead_id);
        console.log('🚀 WORKFLOW: Step 2 result:', JSON.stringify(leadResult, null, 2));
        if (!leadResult.success) {
            console.error('❌ WORKFLOW: Step 2 failed - could not get lead information');
            throw new Error(leadResult.error || 'Failed to get lead information');
        }
        const lead = leadResult.lead;
        if (!lead) {
            console.error('❌ WORKFLOW: Step 2 failed - lead not found');
            throw new Error('Lead not found');
        }
        const assigneeId = lead.assignee_id || lead.assignee_id;
        console.log(`🚀 WORKFLOW: Step 2 check - assignee_id: ${assigneeId || 'NOT FOUND'}`);
        if (!assigneeId) {
            console.log('⏭️ WORKFLOW: Step 2 SKIP - lead has no assignee_id');
            const endTime = new Date();
            const executionTime = `${endTime.getTime() - startTime.getTime()}ms`;
            return {
                success: true,
                data: {
                    skipped: true,
                    reason: 'Lead has no assignee_id',
                    leadInfo: {
                        id: lead.id,
                        name: lead.name || lead.email || 'Unknown Lead',
                        company: lead.company || lead.company_name
                    }
                },
                executionTime,
                timestamp: endTime.toISOString()
            };
        }
        // STEP 3: Send notification via API
        console.log('🚀 WORKFLOW: Step 3 - Sending notification to API...');
        const result = await leadAttentionActivity({
            lead_id: params.lead_id,
            user_message: params.user_message,
            system_message: params.system_message
        });
        console.log('🚀 WORKFLOW: Step 3 result:', JSON.stringify(result, null, 2));
        const endTime = new Date();
        const executionTime = `${endTime.getTime() - startTime.getTime()}ms`;
        if (result.success && result.data?.skipped) {
            console.log('⏭️ WORKFLOW SKIP: Lead attention notification skipped:', {
                lead_id: params.lead_id,
                reason: result.data.reason,
                executionTime
            });
            console.log('⏭️ WORKFLOW SKIP: Detailed reason:', result.data.reason);
        }
        else if (result.success && result.data?.notificationSent) {
            console.log('✅ WORKFLOW SUCCESS: Lead attention notification sent successfully:', {
                lead_id: params.lead_id,
                assignee_id: result.data.assigneeId,
                executionTime
            });
            console.log('✅ WORKFLOW SUCCESS: Notification response:', JSON.stringify(result.data.response, null, 2));
        }
        else if (!result.success) {
            console.log('❌ WORKFLOW ERROR: Lead attention notification failed:', {
                lead_id: params.lead_id,
                error: result.error,
                executionTime
            });
            console.log('❌ WORKFLOW ERROR: Detailed error:', result.error);
        }
        return {
            success: result.success,
            data: {
                ...result.data,
                ...(assigneeId && { assigneeId }), // Add the assigneeId we found in step 2 if it exists
                leadInfo: {
                    id: lead.id,
                    name: (lead.name || lead.email || 'Unknown Lead'),
                    company: lead.company || lead.company_name
                }
            },
            error: result.error,
            executionTime,
            timestamp: endTime.toISOString()
        };
    }
    catch (error) {
        const endTime = new Date();
        const executionTime = `${endTime.getTime() - startTime.getTime()}ms`;
        console.error('❌ WORKFLOW EXCEPTION: Lead attention workflow failed:', {
            error: error instanceof Error ? error.message : String(error),
            lead_id: params.lead_id,
            executionTime
        });
        console.error('❌ WORKFLOW EXCEPTION: Full error details:', error);
        throw new Error(`Lead attention workflow failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}
