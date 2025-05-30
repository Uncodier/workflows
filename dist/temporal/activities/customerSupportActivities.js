"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendCustomerSupportMessageActivity = sendCustomerSupportMessageActivity;
exports.processAnalysisDataActivity = processAnalysisDataActivity;
const apiService_1 = require("../services/apiService");
/**
 * Send customer support message based on analysis data
 */
async function sendCustomerSupportMessageActivity(analysisData, baseParams) {
    console.log('📞 Sending customer support message...');
    const { analysis } = analysisData;
    const { lead_extraction, commercial_opportunity } = analysis;
    // Build the message request payload
    const messageRequest = {
        message: analysis.summary || 'Customer support interaction from analysis',
        site_id: baseParams.site_id,
        agentId: baseParams.agentId,
        userId: baseParams.userId,
        lead_notification: commercial_opportunity.response_type,
    };
    // Add contact information if available
    if (lead_extraction.contact_info.name) {
        messageRequest.name = lead_extraction.contact_info.name;
    }
    if (lead_extraction.contact_info.email) {
        messageRequest.email = lead_extraction.contact_info.email;
    }
    if (lead_extraction.contact_info.phone) {
        messageRequest.phone = lead_extraction.contact_info.phone;
    }
    console.log('📤 Sending customer support message with payload:', {
        hasContactInfo: !!(lead_extraction.contact_info.name || lead_extraction.contact_info.email),
        intent: lead_extraction.intent,
        priority: analysis.priority,
        sentiment: analysis.sentiment
    });
    try {
        const response = await apiService_1.apiService.post('/api/agents/customerSupport/message', messageRequest);
        if (!response.success) {
            throw new Error(`Failed to send customer support message: ${response.error?.message}`);
        }
        console.log('✅ Customer support message sent successfully');
        return response.data;
    }
    catch (error) {
        console.error('❌ Failed to send customer support message:', error);
        throw error;
    }
}
/**
 * Process analysis data and prepare for customer support interaction
 */
async function processAnalysisDataActivity(analysisData) {
    const { analysis } = analysisData;
    const { commercial_opportunity, priority, sentiment } = analysis;
    console.log('🔍 Processing analysis data for customer support...');
    // Determine if this analysis requires customer support action
    const shouldProcess = commercial_opportunity.requires_response ||
        priority === 'high' ||
        sentiment === 'negative' ||
        commercial_opportunity.priority_level === 'high';
    let reason = '';
    if (commercial_opportunity.requires_response) {
        reason = 'Requires response based on commercial opportunity';
    }
    else if (priority === 'high') {
        reason = 'High priority analysis';
    }
    else if (sentiment === 'negative') {
        reason = 'Negative sentiment detected';
    }
    else if (commercial_opportunity.priority_level === 'high') {
        reason = 'High commercial priority';
    }
    else {
        reason = 'No immediate action required';
    }
    console.log(`📊 Analysis processing result: ${shouldProcess ? 'PROCESS' : 'SKIP'} - ${reason}`);
    return {
        shouldProcess,
        priority,
        reason
    };
}
