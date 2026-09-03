"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendChannelMessageFromAgentActivity = sendChannelMessageFromAgentActivity;
const apiService_1 = require("../services/apiService");
async function sendChannelMessageFromAgentActivity(params) {
    console.log(`Sending ${params.channel} message via agent API to ${params.to}`);
    const response = await apiService_1.apiService.post('/api/agents/tools/sendChannelMessage', {
        channel: params.channel,
        to: params.to,
        message: params.message,
        site_id: params.site_id,
        subject: params.subject,
        agent_id: params.agent_id,
        conversation_id: params.conversation_id,
        lead_id: params.lead_id,
        message_id: params.message_id,
    });
    if (!response.success) {
        throw new Error(`Failed to send ${params.channel} message: ${response.error?.message || 'Unknown error'}`);
    }
    const messageId = response.data?.messageId || response.data?.message_id;
    console.log(`${params.channel} sent successfully via agent API:`, messageId);
    return {
        success: true,
        messageId,
    };
}
