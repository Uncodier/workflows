"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendCustomerSupportMessageActivity = sendCustomerSupportMessageActivity;
exports.processAnalysisDataActivity = processAnalysisDataActivity;
exports.processApiEmailResponseActivity = processApiEmailResponseActivity;
const apiService_1 = require("../services/apiService");
/**
 * Send customer support message based on email data or website chat data
 */
async function sendCustomerSupportMessageActivity(emailData, // Allow both EmailData and direct website chat format
baseParams) {
    console.log('📞 Sending customer support message...');
    // ✅ NEW: Support both EmailData format and direct website chat format
    let message;
    let site_id;
    let user_id;
    let conversation_id;
    let visitor_id;
    let lead_id;
    let contactName;
    let contactEmail;
    let contactPhone;
    // Detect if this is EmailData format (has valid contact_info) or direct website chat format
    if (emailData.contact_info && typeof emailData.contact_info === 'object') {
        // EmailData format
        console.log('📧 Processing EmailData format');
        message = emailData.summary || 'Customer support interaction from analysis';
        site_id = emailData.site_id;
        user_id = emailData.user_id;
        conversation_id = emailData.conversation_id;
        visitor_id = emailData.visitor_id;
        lead_id = emailData.lead_id;
        contactName = emailData.contact_info.name;
        contactEmail = emailData.contact_info.email;
        contactPhone = emailData.contact_info.phone;
    }
    else {
        // Direct website chat format
        console.log('💬 Processing website chat format');
        message = emailData.message || 'Website chat interaction';
        site_id = emailData.site_id;
        user_id = emailData.user_id || ''; // May be empty for website chat
        conversation_id = emailData.conversationId;
        visitor_id = emailData.visitor_id;
        lead_id = emailData.lead_id;
        contactName = emailData.name;
        contactEmail = emailData.email;
        contactPhone = emailData.phone;
    }
    const { agentId, origin } = baseParams;
    // Build the message request payload con SOLO los parámetros requeridos por el API
    const messageRequest = {
        message: message,
        site_id: site_id,
        userId: user_id,
        lead_notification: "none", // Para mejor trazabilidad - no duplicar notificaciones
        origin: origin, // Enviar el origen (whatsapp, email, etc.)
    };
    // ✅ FIXED: Solo agregar agentId si viene explícitamente definido (no undefined)
    if (agentId) {
        messageRequest.agentId = agentId;
        console.log(`🤖 Using explicitly provided agentId: ${agentId}`);
    }
    else {
        console.log(`🤖 No agentId provided - field omitted from request (API should use default behavior)`);
    }
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
    if (contactName) {
        messageRequest.name = contactName;
    }
    // Always send email if available (helps with lead creation/matching)
    if (contactEmail) {
        messageRequest.email = contactEmail;
    }
    // Always send phone if available (helps with lead creation/matching)  
    if (contactPhone) {
        messageRequest.phone = contactPhone;
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
        agentId: messageRequest.agentId || 'field_omitted', // ✅ Show when field is omitted
        lead_id: messageRequest.lead_id,
        conversationId: messageRequest.conversationId,
        visitor_id: messageRequest.visitor_id,
        lead_notification: messageRequest.lead_notification,
        origin: messageRequest.origin
    });
    console.log('📋 Full payload being sent:', JSON.stringify(messageRequest, null, 2));
    try {
        const startTime = Date.now();
        console.log('⏱️ Starting customer support API call...');
        const response = await apiService_1.apiService.post('/api/agents/customerSupport/message', messageRequest);
        const duration = Date.now() - startTime;
        console.log(`⏱️ API call completed in ${duration}ms`);
        if (!response.success) {
            console.error('❌ API call failed:', response.error);
            // ✅ ENHANCED: Better error handling for timeout scenarios
            let errorMessage = response.error?.message || 'Failed to send customer support message';
            if (errorMessage.includes('COMMAND_EXECUTION_FAILED') || errorMessage.includes('expected time')) {
                errorMessage = `Customer support API timeout (took ${duration}ms). ${errorMessage}`;
                console.error('🚨 TIMEOUT DETECTED: Customer support API is taking too long to respond');
                console.error('💡 Suggestions: 1) Check API server load, 2) Increase timeout if needed, 3) Check agent configuration');
            }
            return {
                success: false,
                error: errorMessage
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
        // ✅ ENHANCED: Better error handling for network/timeout errors
        let errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes('timeout') || errorMessage.includes('ETIMEDOUT')) {
            errorMessage = `Network timeout when calling customer support API: ${errorMessage}`;
            console.error('🚨 NETWORK TIMEOUT: Could not reach customer support API in time');
        }
        return {
            success: false,
            error: errorMessage
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
