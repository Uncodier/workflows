"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.teamMemberInterventionActivity = teamMemberInterventionActivity;
const apiService_1 = require("../services/apiService");
/**
 * Activity to record team member intervention in agent conversations
 */
async function teamMemberInterventionActivity(params) {
    console.log('👤 Recording team member intervention in conversation:', params.conversationId);
    try {
        const response = await apiService_1.apiService.post('/api/agents/chat/intervention', {
            conversationId: params.conversationId,
            message: params.message,
            user_id: params.user_id,
            agentId: params.agentId,
            conversation_title: params.conversation_title,
            lead_id: params.lead_id,
            visitor_id: params.visitor_id,
            site_id: params.site_id
        });
        if (!response.success) {
            throw new Error(`Failed to record intervention: ${response.error?.message}`);
        }
        console.log('✅ Team member intervention recorded successfully');
        return {
            success: true,
            conversationId: params.conversationId,
            messageId: response.data?.messageId,
            timestamp: new Date().toISOString()
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('❌ Failed to record team member intervention:', errorMessage);
        return {
            success: false,
            conversationId: params.conversationId,
            timestamp: new Date().toISOString(),
            error: errorMessage
        };
    }
}
