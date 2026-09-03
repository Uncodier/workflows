"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendChannelMessageFromAgentWorkflow = sendChannelMessageFromAgentWorkflow;
const workflow_1 = require("@temporalio/workflow");
const timeouts_1 = require("../config/timeouts");
// Configure activity options
const { sendChannelMessageFromAgentActivity } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: timeouts_1.ACTIVITY_TIMEOUTS.WHATSAPP_OPERATIONS, // Reusing timeout config
    retry: timeouts_1.RETRY_POLICIES.NETWORK,
});
/**
 * Send Channel Message From Agent Workflow
 * Sends a generic channel message (like telegram or messenger) via the API endpoint
 */
async function sendChannelMessageFromAgentWorkflow(params) {
    console.log(`📤 Starting send ${params.channel} from agent workflow...`);
    const startTime = new Date();
    try {
        if (!params.channel || !params.to || !params.message || !params.site_id) {
            throw new Error(`Missing required parameters: channel, to, message and site_id are required`);
        }
        const searchAttributes = {
            site_id: [params.site_id],
        };
        if (params.agent_id) {
            searchAttributes.user_id = [params.agent_id];
        }
        if (params.lead_id) {
            searchAttributes.lead_id = [params.lead_id];
        }
        (0, workflow_1.upsertSearchAttributes)(searchAttributes);
        console.log(`📞 Executing activity to send ${params.channel} message...`);
        const result = await sendChannelMessageFromAgentActivity(params);
        if (!result.success) {
            throw new Error(result.error || `Failed to send ${params.channel} message`);
        }
        const endTime = new Date();
        const executionTimeMs = endTime.getTime() - startTime.getTime();
        console.log(`✅ ${params.channel} message workflow completed successfully in ${executionTimeMs}ms`);
        return {
            success: true,
            messageId: result.messageId || 'unknown',
            recipient: params.to,
            executionTime: `${executionTimeMs}ms`,
            timestamp: endTime.toISOString()
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Send ${params.channel} from agent workflow failed:`, errorMessage);
        throw new Error(errorMessage);
    }
}
