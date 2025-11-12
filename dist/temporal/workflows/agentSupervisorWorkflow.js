"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.agentSupervisorWorkflow = agentSupervisorWorkflow;
const workflow_1 = require("@temporalio/workflow");
const timeouts_1 = require("../config/timeouts");
// Configure activity options using centralized timeouts
const { callAgentSupervisorActivity, getSiteIdFromCommandOrConversationActivity, validateWorkflowConfigActivity } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: timeouts_1.ACTIVITY_TIMEOUTS.CUSTOMER_SUPPORT, // Using centralized config (5 minutes)
    retry: timeouts_1.RETRY_POLICIES.CUSTOMER_SUPPORT, // Using appropriate retry policy
});
/**
 * Agent Supervisor Workflow
 * Calls the agent supervisor API endpoint with command_id and conversation_id
 * This workflow runs independently and should not block parent workflows
 */
async function agentSupervisorWorkflow(params) {
    console.log('🎯 Starting agent supervisor workflow...');
    console.log(`📋 Command ID: ${params.command_id || 'not provided'}`);
    console.log(`💬 Conversation ID: ${params.conversation_id || 'not provided'}`);
    try {
        // Validate that we have at least one required parameter
        if (!params.command_id && !params.conversation_id) {
            console.log('⚠️ No command_id or conversation_id provided - skipping supervisor call');
            return {
                success: false,
                error: 'Both command_id and conversation_id are missing'
            };
        }
        // Step 1: Get site_id from command_id or conversation_id
        console.log('🔍 Step 1: Getting site_id from command_id or conversation_id...');
        const siteIdResult = await getSiteIdFromCommandOrConversationActivity({
            command_id: params.command_id,
            conversation_id: params.conversation_id
        });
        if (!siteIdResult.success || !siteIdResult.site_id) {
            console.log(`⚠️ Could not determine site_id - skipping supervisor call: ${siteIdResult.error}`);
            return {
                success: false,
                error: siteIdResult.error || 'Could not determine site_id'
            };
        }
        const site_id = siteIdResult.site_id;
        console.log(`✅ Found site_id: ${site_id}`);
        // Step 2: Validate that supervise_conversations activity is active
        console.log('🔐 Step 2: Validating supervise_conversations activity status...');
        const configValidation = await validateWorkflowConfigActivity(site_id, 'supervise_conversations');
        if (!configValidation.shouldExecute) {
            console.log(`⛔ Supervisor workflow blocked: ${configValidation.reason}`);
            return {
                success: false,
                error: configValidation.reason
            };
        }
        console.log(`✅ Activity validation passed: ${configValidation.reason}`);
        // Step 3: Call the supervisor activity
        console.log('📞 Step 3: Calling supervisor activity...');
        const result = await callAgentSupervisorActivity({
            command_id: params.command_id,
            conversation_id: params.conversation_id
        });
        if (result.success) {
            console.log('✅ Agent supervisor workflow completed successfully');
            return {
                success: true
            };
        }
        else {
            console.log(`⚠️ Agent supervisor workflow completed with error: ${result.error}`);
            return {
                success: false,
                error: result.error
            };
        }
    }
    catch (error) {
        console.error('❌ Agent supervisor workflow failed:', error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        // Return error but don't fail the workflow - allows parent to continue
        return {
            success: false,
            error: errorMessage
        };
    }
}
