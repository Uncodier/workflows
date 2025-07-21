"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.emailCustomerSupportMessageWorkflow = emailCustomerSupportMessageWorkflow;
exports.customerSupportMessageWorkflow = customerSupportMessageWorkflow;
const workflow_1 = require("@temporalio/workflow");
const sendEmailFromAgentWorkflow_1 = require("./sendEmailFromAgentWorkflow");
const sendWhatsappFromAgentWorkflow_1 = require("./sendWhatsappFromAgentWorkflow");
const timeouts_1 = require("../config/timeouts");
/**
 * Helper function to map WhatsApp intents to EmailData intents
 * Currently not used but kept for future WhatsApp integration
 */
// function mapWhatsAppIntentToEmailIntent(
//   whatsappIntent?: 'inquiry' | 'complaint' | 'purchase' | 'support' | 'greeting' | 'follow_up' | 'unknown'
// ): 'inquiry' | 'complaint' | 'purchase' | 'support' | 'partnership' | 'demo_request' | undefined {
//   switch (whatsappIntent) {
//     case 'inquiry':
//       return 'inquiry';
//     case 'complaint':
//       return 'complaint';
//     case 'purchase':
//       return 'purchase';
//     case 'support':
//       return 'support';
//     case 'greeting':
//     case 'follow_up':
//       return 'inquiry'; // Map greeting and follow_up to inquiry
//     case 'unknown':
//     default:
//       return 'inquiry'; // Default to inquiry for unknown or undefined
//   }
// }
// Configure activity options using centralized timeouts
const { sendCustomerSupportMessageActivity, processAnalysisDataActivity, startLeadAttentionWorkflowActivity, updateTaskStatusToCompletedActivity } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: timeouts_1.ACTIVITY_TIMEOUTS.CUSTOMER_SUPPORT, // ✅ Using centralized config (5 minutes)
    retry: timeouts_1.RETRY_POLICIES.CUSTOMER_SUPPORT, // ✅ Using appropriate retry policy for customer support
});
// Note: sendWhatsAppResponseActivity available if needed in the future
// const { sendWhatsAppResponseActivity } = proxyActivities<Activities>({...});
/**
 * Email Customer Support Message Workflow
 * Processes one email and sends a customer support message
 * If successful, triggers sendEmailFromAgent for better traceability
 */
async function emailCustomerSupportMessageWorkflow(emailData, baseParams) {
    console.log('🎯 Starting email customer support message workflow...');
    console.log(`📋 Processing email ID: ${emailData.analysis_id}`);
    console.log(`🏢 Site: ${emailData.site_id}, User: ${emailData.user_id}`);
    console.log(`🔄 Origin: ${baseParams.origin || 'not specified'}`);
    try {
        // First, process the email to determine if action is needed
        const processResult = await processAnalysisDataActivity(emailData);
        if (!processResult.shouldProcess) {
            console.log('⏭️ Skipping email - not requiring immediate action');
            return {
                success: true,
                data: {
                    processed: false,
                    reason: processResult.reason,
                    emailSent: false
                }
            };
        }
        console.log('📞 Processing email - sending customer support message');
        // Send the customer support message using data from emailData
        const response = await sendCustomerSupportMessageActivity(emailData, baseParams);
        // ✅ Verificar que la llamada a customer support fue exitosa antes de continuar
        if (!response || !response.success) {
            console.error('❌ Customer support message failed:', response?.error || 'Unknown error');
            return {
                success: false,
                error: response?.error || 'Customer support call was not successful'
            };
        }
        console.log('✅ Customer support message sent successfully');
        console.log(`📋 Customer support response:`, JSON.stringify(response.data, null, 2));
        // 🌟 Call sendEmailFromAgent workflow ONLY if customer support was successful and origin is email
        let emailWorkflowId;
        let emailSent = false;
        try {
            // Simple validation: if origin is email and we have an email address, send the email
            if (baseParams.origin === 'email' && emailData.contact_info.email) {
                console.log('📧 Starting sendEmailFromAgent workflow - customer support was successful...');
                console.log(`🔄 Origin: ${baseParams.origin} - proceeding with follow-up email`);
                const emailWorkflowSuffix = emailData.analysis_id || `temp-${Date.now()}`;
                emailWorkflowId = `send-email-agent-${emailWorkflowSuffix}`;
                // Prepare email parameters with agent response
                const emailParams = {
                    email: emailData.contact_info.email,
                    subject: response.data?.conversation_title || `Re: ${emailData.original_subject || 'Your inquiry'}`,
                    message: response.data?.messages?.assistant?.content ||
                        `Thank you for your message. We have received your inquiry and our customer support team has been notified. We will get back to you shortly.`,
                    site_id: emailData.site_id,
                    agent_id: baseParams.agentId,
                    lead_id: emailData.analysis_id || undefined
                };
                // Start sendEmailFromAgent as child workflow
                const emailHandle = await (0, workflow_1.startChild)(sendEmailFromAgentWorkflow_1.sendEmailFromAgent, {
                    workflowId: emailWorkflowId,
                    args: [emailParams],
                    parentClosePolicy: workflow_1.ParentClosePolicy.PARENT_CLOSE_POLICY_ABANDON,
                });
                console.log(`📨 Started sendEmailFromAgent workflow: ${emailWorkflowId}`);
                console.log(`🚀 Parent close policy: ABANDON - email workflow will continue independently`);
                // Wait for email workflow to complete
                const emailResult = await emailHandle.result();
                if (emailResult.success) {
                    emailSent = true;
                    console.log('✅ Follow-up email sent successfully');
                }
                else {
                    console.log('⚠️ Follow-up email failed, but customer support was successful');
                }
            }
            else if (baseParams.origin !== 'email') {
                console.log(`📋 Origin: ${baseParams.origin} - skipping follow-up email`);
            }
            else if (!emailData.contact_info.email) {
                console.log('📭 No email address available for follow-up');
            }
        }
        catch (emailError) {
            console.error('❌ Email workflow failed, but customer support was successful:', emailError);
            // Don't fail the entire workflow if email fails
        }
        // Mark first_contact task as completed after successful email delivery
        if (emailSent) {
            console.log(`📝 Marking first_contact task as completed after successful email delivery...`);
            try {
                // Use lead_id from customer support response or fallback to analysis_id
                const leadId = response.data?.lead_id || emailData.analysis_id;
                if (leadId) {
                    const taskUpdateResult = await updateTaskStatusToCompletedActivity({
                        lead_id: leadId,
                        site_id: emailData.site_id,
                        stage: 'awareness', // First contact tasks are typically in awareness stage
                        status: 'completed',
                        notes: `Task completed after successful email delivery via emailCustomerSupportMessageWorkflow`
                    });
                    if (taskUpdateResult.success) {
                        if (taskUpdateResult.updated_task_id) {
                            console.log(`✅ First_contact task ${taskUpdateResult.updated_task_id} marked as completed`);
                        }
                        else {
                            console.log(`✅ First_contact task completion update completed (${taskUpdateResult.task_found ? 'no task to update' : 'no task found'})`);
                        }
                    }
                    else {
                        console.error(`⚠️ Failed to mark first_contact task as completed: ${taskUpdateResult.error}`);
                        // Note: We don't throw here as the main operation was successful
                    }
                }
                else {
                    console.log(`⚠️ No lead_id available for task completion update`);
                }
            }
            catch (taskError) {
                console.error('❌ Task completion update failed:', taskError);
                // Don't fail the entire workflow if task update fails
            }
        }
        else {
            console.log(`⚠️ Skipping first_contact task completion - no successful email delivery`);
        }
        // 🔔 Start independent leadAttentionWorkflow if we have a lead_id
        let leadAttentionWorkflowId;
        try {
            // Use lead_id from customer support response, not from input data
            const leadId = response.data?.lead_id || emailData.analysis_id;
            if (leadId) {
                console.log('🔔 Starting independent leadAttentionWorkflow...');
                console.log(`📋 Lead ID: ${leadId} - will check for assignee_id before sending notification`);
                console.log(`🎯 Lead source: ${response.data?.lead_id ? 'customer support response' : 'input data'}`);
                // Extract message content from customer support response
                const userMessage = response.data?.messages?.user?.content ||
                    emailData.original_text ||
                    emailData.summary ||
                    'Customer inquiry';
                const systemMessage = response.data?.messages?.assistant?.content ||
                    response.data?.message ||
                    'Customer support notification';
                // Start independent workflow (fire and forget - no blocking)
                const startResult = await startLeadAttentionWorkflowActivity({
                    lead_id: leadId,
                    user_message: userMessage,
                    system_message: systemMessage
                });
                if (startResult.success) {
                    leadAttentionWorkflowId = startResult.workflowId;
                    console.log(`✅ Independent leadAttentionWorkflow started: ${leadAttentionWorkflowId}`);
                    console.log(`🚀 Workflow will run independently and check assignee_id`);
                }
                else {
                    console.error('❌ Failed to start independent leadAttentionWorkflow:', startResult.error);
                    throw new Error(`Lead attention workflow failed to start: ${startResult.error}`);
                }
            }
            else {
                console.log('⚠️ No lead_id available for lead attention notification');
                console.log('🔍 Checked: response.data.lead_id and emailData.analysis_id');
            }
        }
        catch (leadAttentionError) {
            console.error('❌ Lead attention workflow failed to start - failing entire workflow:', leadAttentionError);
            throw leadAttentionError; // Re-throw to fail the entire workflow
        }
        console.log('✅ Email customer support message workflow completed successfully');
        return {
            success: true,
            data: {
                ...response.data, // ✅ Extract data directly to root level
                processed: true,
                reason: processResult.reason,
                emailSent,
                emailWorkflowId,
                leadAttentionWorkflowId
            }
        };
    }
    catch (error) {
        console.error('❌ Email customer support message workflow failed:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : String(error)
        };
    }
}
/**
 * Customer Support Message Workflow
 * Detecta el origen (email vs whatsapp) y delega al workflow específico
 * Este es el workflow principal que debe ser llamado desde el API
 */
async function customerSupportMessageWorkflow(messageData, baseParams) {
    console.log('🎯 Starting customer support message workflow...');
    // ✅ NEW: Support for parameters in root of request
    // If baseParams is undefined or missing values, look for them in messageData
    let origin = baseParams?.origin;
    let agentId = baseParams?.agentId;
    // If not found in baseParams, check messageData root level
    if (!origin && messageData && typeof messageData === 'object' && 'origin' in messageData) {
        origin = messageData.origin;
        console.log(`🔍 Found origin in messageData root: ${origin}`);
    }
    if (!agentId && messageData && typeof messageData === 'object' && 'agentId' in messageData) {
        agentId = messageData.agentId;
        console.log(`🔍 Found agentId in messageData root: ${agentId}`);
    }
    // Create effective baseParams for internal use
    const effectiveBaseParams = {
        origin: origin || 'not specified',
        agentId: agentId
    };
    console.log(`🔄 Origin: ${effectiveBaseParams.origin}`);
    console.log(`🤖 Agent ID: ${effectiveBaseParams.agentId || 'not specified'}`);
    try {
        // ✅ NEW: If messageData has website_chat origin, process as-is without transformation
        if (effectiveBaseParams.origin === 'website_chat' && 'message' in messageData) {
            console.log('💬 Detected website chat message - processing original data without transformation');
            console.log('📞 Processing website chat message - sending customer support message');
            // Send customer support message with original data (no transformation to EmailData)
            const response = await sendCustomerSupportMessageActivity(messageData, effectiveBaseParams);
            if (!response || !response.success) {
                console.error('❌ Website chat customer support message failed:', response?.error || 'Unknown error');
                return {
                    success: false,
                    error: response?.error || 'Customer support call was not successful'
                };
            }
            console.log('✅ Website chat customer support message sent successfully');
            console.log(`📋 Customer support response:`, JSON.stringify(response.data, null, 2));
            // ✅ FIXED: For website_chat, DON'T automatically send follow-up emails
            // Website chat interactions should only use the chat medium unless explicitly requested
            console.log('💬 Website chat completed - no email follow-up needed (chat is the primary communication channel)');
            // 🔔 Start independent leadAttentionWorkflow if we have a lead_id
            let leadAttentionWorkflowId;
            try {
                // Use lead_id from customer support response, not from input data
                const leadId = response.data?.lead_id || messageData.lead_id || messageData.analysis_id;
                if (leadId) {
                    console.log('🔔 Starting independent leadAttentionWorkflow...');
                    console.log(`📋 Lead ID: ${leadId} - will check for assignee_id before sending notification`);
                    console.log(`🎯 Lead source: ${response.data?.lead_id ? 'customer support response' : 'input data'}`);
                    // Extract message content from customer support response
                    const userMessage = response.data?.messages?.user?.content ||
                        messageData.message ||
                        'Website chat inquiry';
                    const systemMessage = response.data?.messages?.assistant?.content ||
                        response.data?.message ||
                        'Website chat customer support notification';
                    // Start independent workflow (fire and forget - no blocking)
                    const startResult = await startLeadAttentionWorkflowActivity({
                        lead_id: leadId,
                        user_message: userMessage,
                        system_message: systemMessage
                    });
                    if (startResult.success) {
                        leadAttentionWorkflowId = startResult.workflowId;
                        console.log(`✅ Independent leadAttentionWorkflow started: ${leadAttentionWorkflowId}`);
                        console.log(`🚀 Workflow will run independently and check assignee_id`);
                    }
                    else {
                        console.error('❌ Failed to start independent leadAttentionWorkflow:', startResult.error);
                        throw new Error(`Lead attention workflow failed to start: ${startResult.error}`);
                    }
                }
                else {
                    console.log('⚠️ No lead_id available for lead attention notification');
                    console.log('🔍 Checked: response.data.lead_id, messageData.lead_id and messageData.analysis_id');
                }
            }
            catch (leadAttentionError) {
                console.error('❌ Lead attention workflow failed to start - failing entire workflow:', leadAttentionError);
                throw leadAttentionError; // Re-throw to fail the entire workflow
            }
            console.log('✅ Website chat customer support message workflow completed successfully');
            return {
                success: true,
                data: {
                    ...response.data, // ✅ Extract data directly to root level
                    processed: true,
                    reason: 'Website chat message processed for customer support',
                    emailSent: false, // Website chat doesn't send follow-up emails
                    emailWorkflowId: undefined,
                    leadAttentionWorkflowId
                }
            };
        }
        // Detectar si es WhatsApp o Email basado en el origen o estructura de datos
        if (effectiveBaseParams.origin === 'whatsapp' && 'whatsappData' in messageData) {
            console.log('📱 Detected WhatsApp message - processing directly');
            const whatsappData = messageData.whatsappData;
            // Preparar EmailData compatible para la activity existente
            const emailDataForCS = {
                summary: `WhatsApp message from ${whatsappData.senderName || whatsappData.phoneNumber}: ${whatsappData.messageContent || 'No message content'}`,
                original_subject: `WhatsApp Message from ${whatsappData.senderName || whatsappData.phoneNumber}`,
                contact_info: {
                    name: whatsappData.senderName || 'WhatsApp Contact',
                    email: '', // WhatsApp no tiene email
                    phone: whatsappData.phoneNumber,
                    company: ''
                },
                site_id: whatsappData.siteId,
                user_id: whatsappData.userId,
                lead_notification: "none", // Evitar duplicar notificaciones
                analysis_id: `whatsapp-${whatsappData.messageId || Date.now()}`,
                priority: 'medium', // Default priority for WhatsApp
                intent: 'inquiry', // Default intent for WhatsApp  
                potential_value: 'medium', // Default value for WhatsApp
                // Agregar campos específicos de WhatsApp
                conversation_id: whatsappData.conversationId, // Pasar conversation ID a la activity
                visitor_id: undefined // WhatsApp normalmente no tiene visitor_id, se maneja por phone
            };
            // ✅ FIXED: Para WhatsApp siempre procesar - eliminar filtro innecesario
            console.log('📞 Processing WhatsApp message - sending customer support message directly');
            // Enviar mensaje de customer support
            const response = await sendCustomerSupportMessageActivity(emailDataForCS, effectiveBaseParams);
            if (!response || !response.success) {
                console.error('❌ WhatsApp customer support message failed:', response?.error || 'Unknown error');
                return {
                    success: false,
                    error: response?.error || 'Customer support call was not successful'
                };
            }
            console.log('✅ WhatsApp customer support message sent successfully');
            console.log(`📋 Customer support response:`, JSON.stringify(response.data, null, 2));
            // 🌟 NEW: Call sendWhatsappFromAgent workflow ONLY if customer support was successful
            let whatsappWorkflowId;
            let whatsappSent = false;
            try {
                console.log('📱 Starting sendWhatsappFromAgent workflow - customer support was successful...');
                whatsappWorkflowId = `send-whatsapp-agent-${whatsappData.messageId || Date.now()}`;
                // Prepare WhatsApp parameters from customer support response
                const whatsappParams = {
                    phone_number: whatsappData.phoneNumber,
                    message: response.data?.messages?.assistant?.content ||
                        `Thank you for your message. We have received your inquiry and our customer support team has been notified. We will get back to you shortly.`,
                    site_id: whatsappData.siteId,
                    from: 'Customer Support',
                    agent_id: effectiveBaseParams.agentId,
                    conversation_id: whatsappData.conversationId,
                    // ✅ REMOVED: lead_id - API can obtain it from phone number
                };
                // Start sendWhatsappFromAgent as child workflow
                const whatsappHandle = await (0, workflow_1.startChild)(sendWhatsappFromAgentWorkflow_1.sendWhatsappFromAgent, {
                    workflowId: whatsappWorkflowId,
                    args: [whatsappParams],
                    parentClosePolicy: workflow_1.ParentClosePolicy.PARENT_CLOSE_POLICY_ABANDON,
                });
                console.log(`📨 Started sendWhatsappFromAgent workflow: ${whatsappWorkflowId}`);
                console.log(`🚀 Parent close policy: ABANDON - WhatsApp workflow will continue independently`);
                // Wait for WhatsApp workflow to complete
                const whatsappResult = await whatsappHandle.result();
                if (whatsappResult.success) {
                    whatsappSent = true;
                    console.log('✅ Follow-up WhatsApp sent successfully');
                    console.log(`📨 Message ID: ${whatsappResult.messageId}`);
                }
                else {
                    console.log('⚠️ Follow-up WhatsApp failed, but customer support was successful');
                }
            }
            catch (whatsappError) {
                console.error('❌ WhatsApp workflow failed, but customer support was successful:', whatsappError);
                // Don't fail the entire workflow if WhatsApp fails
            }
            // Mark first_contact task as completed after successful WhatsApp delivery
            if (whatsappSent) {
                console.log(`📝 Marking first_contact task as completed after successful WhatsApp delivery...`);
                try {
                    // Use lead_id from customer support response or fallback to analysis_id
                    const leadId = response.data?.lead_id || emailDataForCS.analysis_id;
                    if (leadId) {
                        const taskUpdateResult = await updateTaskStatusToCompletedActivity({
                            lead_id: leadId,
                            site_id: emailDataForCS.site_id,
                            stage: 'awareness', // First contact tasks are typically in awareness stage
                            status: 'completed',
                            notes: `Task completed after successful WhatsApp delivery via customerSupportMessageWorkflow`
                        });
                        if (taskUpdateResult.success) {
                            if (taskUpdateResult.updated_task_id) {
                                console.log(`✅ First_contact task ${taskUpdateResult.updated_task_id} marked as completed`);
                            }
                            else {
                                console.log(`✅ First_contact task completion update completed (${taskUpdateResult.task_found ? 'no task to update' : 'no task found'})`);
                            }
                        }
                        else {
                            console.error(`⚠️ Failed to mark first_contact task as completed: ${taskUpdateResult.error}`);
                            // Note: We don't throw here as the main operation was successful
                        }
                    }
                    else {
                        console.log(`⚠️ No lead_id available for task completion update`);
                    }
                }
                catch (taskError) {
                    console.error('❌ Task completion update failed:', taskError);
                    // Don't fail the entire workflow if task update fails
                }
            }
            else {
                console.log(`⚠️ Skipping first_contact task completion - no successful WhatsApp delivery`);
            }
            // 🔔 Start independent leadAttentionWorkflow if we have a lead_id
            let leadAttentionWorkflowId;
            try {
                // Use lead_id from customer support response, not from input data
                const leadId = response.data?.lead_id || emailDataForCS.analysis_id;
                if (leadId) {
                    console.log('🔔 Starting independent leadAttentionWorkflow...');
                    console.log(`📋 Lead ID: ${leadId} - will check for assignee_id before sending notification`);
                    console.log(`🎯 Lead source: ${response.data?.lead_id ? 'customer support response' : 'input data'}`);
                    // Extract message content from customer support response
                    const userMessage = response.data?.messages?.user?.content ||
                        whatsappData.messageContent ||
                        'WhatsApp inquiry';
                    const systemMessage = response.data?.messages?.assistant?.content ||
                        response.data?.message ||
                        'WhatsApp customer support notification';
                    // Start independent workflow (fire and forget - no blocking)
                    const startResult = await startLeadAttentionWorkflowActivity({
                        lead_id: leadId,
                        user_message: userMessage,
                        system_message: systemMessage
                    });
                    if (startResult.success) {
                        leadAttentionWorkflowId = startResult.workflowId;
                        console.log(`✅ Independent leadAttentionWorkflow started: ${leadAttentionWorkflowId}`);
                        console.log(`🚀 Workflow will run independently and check assignee_id`);
                    }
                    else {
                        console.error('❌ Failed to start independent leadAttentionWorkflow:', startResult.error);
                        throw new Error(`Lead attention workflow failed to start: ${startResult.error}`);
                    }
                }
                else {
                    console.log('⚠️ No lead_id available for lead attention notification');
                    console.log('🔍 Checked: response.data.lead_id and emailDataForCS.analysis_id');
                }
            }
            catch (leadAttentionError) {
                console.error('❌ Lead attention workflow failed to start - failing entire workflow:', leadAttentionError);
                throw leadAttentionError; // Re-throw to fail the entire workflow
            }
            console.log('✅ WhatsApp customer support message workflow completed successfully');
            return {
                success: true,
                data: {
                    ...response.data, // ✅ Extract data directly to root level
                    processed: true,
                    reason: 'WhatsApp message processed for customer support',
                    whatsappSent,
                    whatsappWorkflowId,
                    leadAttentionWorkflowId
                }
            };
        }
        else {
            console.log('📧 Detected email message - delegating to email workflow');
            // Usar el workflow específico para emails
            return await emailCustomerSupportMessageWorkflow(messageData, effectiveBaseParams);
        }
    }
    catch (error) {
        console.error('❌ Customer support workflow failed:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : String(error)
        };
    }
}
