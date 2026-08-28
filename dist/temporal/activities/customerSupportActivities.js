"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendCustomerSupportMessageActivity = sendCustomerSupportMessageActivity;
exports.processAnalysisDataActivity = processAnalysisDataActivity;
exports.processApiEmailResponseActivity = processApiEmailResponseActivity;
exports.callAgentSupervisorActivity = callAgentSupervisorActivity;
exports.notifyTeamOnInboundActivity = notifyTeamOnInboundActivity;
const apiService_1 = require("../services/apiService");
const activityControlActivities_1 = require("./activityControlActivities");
const client_1 = require("../../lib/supabase/client");
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
    let origin_message_id;
    // Detect if this is EmailData format (has valid contact_info) or direct website chat format
    if (emailData.contact_info && typeof emailData.contact_info === 'object') {
        // EmailData format
        console.log('📧 Processing EmailData format');
        message = emailData.original_text || emailData.summary || 'Customer support interaction from analysis';
        site_id = emailData.site_id;
        user_id = emailData.user_id;
        conversation_id = emailData.conversation_id;
        visitor_id = emailData.visitor_id;
        lead_id = emailData.lead_id;
        origin_message_id = emailData.origin_message_id;
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
        origin_message_id = emailData.origin_message_id;
        contactName = emailData.name;
        contactEmail = emailData.email;
        contactPhone = emailData.phone;
    }
    // Provide system time context to help agent correctly schedule reservations
    const now = new Date();
    // Using es-MX format as a helpful hint for Spanish queries, but still sending ISO as primary truth
    const timeContext = `\n\n[System Context for Agent: The current date and time is ${now.toISOString()} (UTC). Local time hint: ${now.toLocaleString('es-MX', { timeZone: 'America/Mexico_City', weekday: 'long' })}, ${now.toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })} (America/Mexico_City). When scheduling or referencing days of the week, you MUST calculate relative to this exact date to avoid booking past dates or wrong weeks.]`;
    message = message + timeContext;
    const { agentId, origin, origin_message_id: baseParamsOriginMessageId } = baseParams;
    // Use origin_message_id from baseParams if not found in emailData
    if (!origin_message_id && baseParamsOriginMessageId) {
        origin_message_id = baseParamsOriginMessageId;
    }
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
    // Add origin_message_id if available
    if (origin_message_id) {
        messageRequest.origin_message_id = origin_message_id;
        console.log(`📨 Using origin_message_id: ${origin_message_id}`);
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
            throw new Error(errorMessage);
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
/**
 * Call agent supervisor API endpoint
 * This activity should not fail the workflow if it fails
 */
async function callAgentSupervisorActivity(params) {
    console.log('🎯 Calling agent supervisor API...');
    console.log(`📋 Command ID: ${params.command_id || 'not provided'}`);
    console.log(`💬 Conversation ID: ${params.conversation_id || 'not provided'}`);
    // Validate that we have at least one required parameter
    if (!params.command_id && !params.conversation_id) {
        console.log('⚠️ No command_id or conversation_id provided - skipping supervisor call');
        return {
            success: false,
            error: 'Both command_id and conversation_id are missing'
        };
    }
    try {
        const startTime = Date.now();
        console.log('⏱️ Starting agent supervisor API call...');
        const response = await apiService_1.apiService.post('/api/agents/supervisor', {
            command_id: params.command_id,
            conversation_id: params.conversation_id
        });
        const duration = Date.now() - startTime;
        console.log(`⏱️ Agent supervisor API call completed in ${duration}ms`);
        if (!response.success) {
            console.error('❌ Agent supervisor API call failed:', response.error);
            // Don't throw - just return error status
            return {
                success: false,
                error: response.error?.message || 'Failed to call agent supervisor API'
            };
        }
        console.log('✅ Agent supervisor API call successful');
        console.log('📊 Supervisor response data:', JSON.stringify(response.data, null, 2));
        return {
            success: true,
            data: response.data
        };
    }
    catch (error) {
        console.error('❌ Failed to call agent supervisor API:', error);
        // Don't throw - just return error status so workflow continues
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
            success: false,
            error: errorMessage
        };
    }
}
/**
 * Notify team on inbound message activity
 * This activity calls the external API when it's the first user message in a conversation
 * This activity should not fail the workflow if it fails
 */
async function notifyTeamOnInboundActivity(params) {
    console.log('🔔 Notify team on inbound activity started...');
    console.log(`📋 Lead ID: ${params.lead_id}`);
    console.log(`💬 Conversation ID: ${params.conversation_id}`);
    console.log(`🏢 Site ID: ${params.site_id}`);
    console.log(`💬 Message: ${params.message?.substring(0, 100) || 'no message'}...`);
    try {
        // Step 1: Validate that notify_team_on_inbound activity is not explicitly inactive
        console.log('🔐 Step 1: Validating notify_team_on_inbound activity status...');
        // Fetch activities configuration for the site
        const activitiesMap = await (0, activityControlActivities_1.fetchActivitiesMapActivity)([params.site_id]);
        const siteActivities = activitiesMap[params.site_id];
        // If no activities configuration exists, allow execution (default behavior)
        if (!siteActivities) {
            console.log('✅ No activities configuration found - allowing execution (default behavior)');
        }
        else {
            // Check if the specific activity key exists in configuration
            const activityConfig = siteActivities['notify_team_on_inbound'];
            // If activity key doesn't exist in configuration, allow execution (default behavior)
            if (!activityConfig) {
                console.log('✅ Activity notify_team_on_inbound not configured - allowing execution (default behavior)');
            }
            else {
                // Check the status of the activity
                const activityStatus = activityConfig.status;
                console.log(`📊 Activity 'notify_team_on_inbound' status: ${activityStatus}`);
                // Only block if explicitly set to "inactive"
                if (activityStatus === 'inactive') {
                    console.log('⛔ Notify team activity blocked - explicitly set to inactive');
                    return {
                        success: false,
                        error: 'Activity notify_team_on_inbound is inactive in site settings'
                    };
                }
                // For any other status (including 'default'), allow execution
                console.log(`✅ Activity validation passed - status: ${activityStatus}`);
            }
        }
        // Step 2: Check if it's the first user message in the conversation
        console.log('🔍 Step 2: Checking if this is the first user message in conversation...');
        const { data: userMessages, error: messagesError, count } = await client_1.supabaseServiceRole
            .from('messages')
            .select('id, created_at', { count: 'exact' })
            .eq('conversation_id', params.conversation_id)
            .eq('role', 'user');
        if (messagesError) {
            console.error(`❌ Error checking user messages:`, messagesError);
            // Don't throw - return error status so workflow continues
            return {
                success: false,
                error: `Failed to check messages: ${messagesError.message}`
            };
        }
        // If there are more than 1 user messages, this is not the first message
        const userMessageCount = count || (userMessages?.length || 0);
        console.log(`📊 Found ${userMessageCount} user message(s) in conversation`);
        if (userMessageCount > 1) {
            console.log(`⏭️ Not the first user message - found ${userMessageCount} user messages in conversation`);
            return {
                success: false,
                error: 'Not the first user message in conversation'
            };
        }
        if (userMessageCount === 0) {
            console.log(`⚠️ No user messages found in conversation - this might be an error`);
            return {
                success: false,
                error: 'No user messages found in conversation'
            };
        }
        console.log('✅ This is the first user message in the conversation');
        // Step 3: Call the notification API
        console.log('📞 Step 3: Calling newInboundMessage API...');
        const startTime = Date.now();
        const requestBody = {
            lead_id: params.lead_id,
            conversation_id: params.conversation_id,
            message: params.message
        };
        console.log('📤 Sending notification request:', JSON.stringify(requestBody, null, 2));
        const response = await apiService_1.apiService.post('/api/notifications/newInboundMessage', requestBody);
        const duration = Date.now() - startTime;
        console.log(`⏱️ Notification API call completed in ${duration}ms`);
        if (!response.success) {
            console.error('❌ Notification API call failed:', response.error);
            // Don't throw - just return error status so workflow continues
            return {
                success: false,
                error: response.error?.message || 'Failed to call notification API'
            };
        }
        console.log('✅ Team notification sent successfully');
        console.log('📊 Notification response data:', JSON.stringify(response.data, null, 2));
        return {
            success: true
        };
    }
    catch (error) {
        console.error('❌ Failed to notify team on inbound message:', error);
        // Don't throw - just return error status so workflow continues
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
            success: false,
            error: errorMessage
        };
    }
}
