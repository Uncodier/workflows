"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendCustomerSupportMessageActivity = sendCustomerSupportMessageActivity;
exports.processAnalysisDataActivity = processAnalysisDataActivity;
const apiService_1 = require("../services/apiService");
/**
 * Send customer support message based on email data
 */
async function sendCustomerSupportMessageActivity(emailData, baseParams) {
    console.log('📞 Sending customer support message...');
    const { email, lead_notification, response_type } = emailData;
    const { site_id, user_id, agentId } = baseParams;
    // Build the message request payload usando los campos directos
    const messageRequest = {
        message: email.summary || 'Customer support interaction from analysis',
        site_id: site_id,
        agentId: agentId,
        userId: user_id,
        lead_notification: lead_notification && response_type ? response_type : undefined,
    };
    // Add contact information if available
    if (email.contact_info.name) {
        messageRequest.name = email.contact_info.name;
    }
    if (email.contact_info.email) {
        messageRequest.email = email.contact_info.email;
    }
    if (email.contact_info.phone) {
        messageRequest.phone = email.contact_info.phone;
    }
    console.log('📤 Sending customer support message with payload:', {
        hasContactInfo: !!(email.contact_info.name || email.contact_info.email),
        intent: emailData.intent || 'unknown',
        priority: emailData.priority || 'medium',
        analysisId: emailData.analysis_id || 'no-id'
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
 * Process email data and prepare for customer support interaction
 */
async function processAnalysisDataActivity(emailData) {
    const { lead_notification, priority, intent, potential_value } = emailData;
    console.log('🔍 Processing email data for customer support...');
    // Determine if this email requires customer support action
    const shouldProcess = lead_notification ||
        priority === 'high' ||
        intent === 'complaint' ||
        potential_value === 'high';
    let reason = '';
    if (lead_notification) {
        reason = 'Lead notification required based on analysis';
    }
    else if (priority === 'high') {
        reason = 'High priority analysis';
    }
    else if (intent === 'complaint') {
        reason = 'Complaint detected - requires immediate attention';
    }
    else if (potential_value === 'high') {
        reason = 'High commercial potential detected';
    }
    else {
        reason = 'No immediate action required - processing for completeness';
    }
    console.log(`📊 Email processing result: ${shouldProcess ? 'PROCESS' : 'SKIP'} - ${reason}`);
    return {
        shouldProcess: true, // Por ahora procesar todos los emails
        priority: priority || 'medium',
        reason
    };
}
