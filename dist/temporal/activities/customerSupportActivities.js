"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendCustomerSupportMessageActivity = sendCustomerSupportMessageActivity;
exports.processAnalysisDataActivity = processAnalysisDataActivity;
exports.processApiEmailResponseActivity = processApiEmailResponseActivity;
const apiService_1 = require("../services/apiService");
/**
 * Send customer support message based on email data
 */
async function sendCustomerSupportMessageActivity(emailData, baseParams) {
    console.log('📞 Sending customer support message...');
    const { summary, site_id, user_id, conversation_id, visitor_id, lead_id } = emailData;
    const { agentId, origin } = baseParams;
    // Build the message request payload con SOLO los parámetros requeridos por el API
    const messageRequest = {
        message: summary || 'Customer support interaction from analysis',
        site_id: site_id,
        userId: user_id,
        agentId: agentId,
        lead_notification: "none", // Para mejor trazabilidad - no duplicar notificaciones
        origin: origin, // Enviar el origen (whatsapp, email, etc.)
    };
    // Add conversation ID if available (important for WhatsApp)
    if (conversation_id) {
        messageRequest.conversationId = conversation_id;
        console.log(`💬 Using conversation ID: ${conversation_id}`);
    }
    // Add visitor ID if available (for non-authenticated users)
    if (visitor_id) {
        messageRequest.visitor_id = visitor_id;
        console.log(`👤 Using visitor ID: ${visitor_id}`);
    }
    // Add all available contact information - origin indicates response channel, not data restrictions
    if (emailData.contact_info.name) {
        messageRequest.name = emailData.contact_info.name;
    }
    // Always send email if available (helps with lead creation/matching)
    if (emailData.contact_info.email) {
        messageRequest.email = emailData.contact_info.email;
    }
    // Always send phone if available (helps with lead creation/matching)  
    if (emailData.contact_info.phone) {
        messageRequest.phone = emailData.contact_info.phone;
    }
    // ✅ FIXED: Solo enviar lead_id si viene explícitamente, NUNCA generar o derivar automáticamente
    if (lead_id) {
        messageRequest.lead_id = lead_id;
        console.log(`📋 Using explicitly provided lead_id: ${lead_id}`);
    }
    else {
        console.log(`⚠️ No lead_id provided - API will handle lead creation/matching if needed`);
    }
    console.log('📤 Sending customer support message with payload:', {
        message: messageRequest.message?.substring(0, 50) + '...',
        hasName: !!messageRequest.name,
        hasEmail: !!messageRequest.email,
        hasPhone: !!messageRequest.phone,
        site_id: messageRequest.site_id,
        userId: messageRequest.userId,
        agentId: messageRequest.agentId,
        lead_id: messageRequest.lead_id,
        conversationId: messageRequest.conversationId,
        visitor_id: messageRequest.visitor_id,
        lead_notification: messageRequest.lead_notification,
        origin: messageRequest.origin
    });
    console.log('📋 Full payload being sent:', JSON.stringify(messageRequest, null, 2));
    try {
        const response = await apiService_1.apiService.post('/api/agents/customerSupport/message', messageRequest);
        if (!response.success) {
            console.error('❌ API call failed:', response.error);
            return {
                success: false,
                error: response.error?.message || 'Failed to send customer support message'
            };
        }
        console.log('✅ Customer support message sent successfully');
        console.log('📊 API Response data:', JSON.stringify(response.data, null, 2));
        // ✅ FIXED: Return consistent structure that workflow expects
        return {
            success: true,
            data: response.data
        };
    }
    catch (error) {
        console.error('❌ Failed to send customer support message:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : String(error)
        };
    }
}
/**
 * Process email data and prepare for customer support interaction
 */
async function processAnalysisDataActivity(emailData) {
    const { lead_notification, priority, intent, potential_value } = emailData;
    console.log('🔍 Processing email data for customer support...');
    console.log(`📨 Original lead_notification: ${lead_notification}`);
    // Determine if this email requires customer support action and assign reason
    let shouldProcess = false;
    let reason = '';
    if (lead_notification === 'email') {
        shouldProcess = true;
        reason = 'Email lead notification detected from syncEmails analysis';
    }
    else if (priority === 'high') {
        shouldProcess = true;
        reason = 'High priority analysis';
    }
    else if (intent === 'complaint') {
        shouldProcess = true;
        reason = 'Complaint detected - requires immediate attention';
    }
    else if (potential_value === 'high') {
        shouldProcess = true;
        reason = 'High commercial potential detected';
    }
    else {
        shouldProcess = false;
        reason = 'No processing criteria met - skipping customer support';
    }
    console.log(`📊 Email processing result: ${shouldProcess ? 'PROCESS' : 'SKIP'} - ${reason}`);
    console.log(`🔄 Will send lead_notification="none" to customer support for traceability`);
    return {
        shouldProcess,
        priority: priority || 'medium',
        reason
    };
}
/**
 * Process API email response and execute customer support workflow
 */
async function processApiEmailResponseActivity(apiResponse) {
    console.log('🔄 Processing API email response for customer support workflow...');
    try {
        const { childWorkflow } = apiResponse;
        if (childWorkflow.type !== 'scheduleCustomerSupportMessagesWorkflow') {
            throw new Error(`Unexpected workflow type: ${childWorkflow.type}`);
        }
        console.log(`📊 Processing ${childWorkflow.args.emails.length} emails from API response`);
        console.log(`🏢 Site: ${childWorkflow.args.site_id}, User: ${childWorkflow.args.user_id}`);
        // Return the args to be used by the calling workflow
        return {
            success: true,
            workflowId: `schedule-customer-support-${Date.now()}`
        };
    }
    catch (error) {
        console.error('❌ Failed to process API email response:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : String(error)
        };
    }
}
