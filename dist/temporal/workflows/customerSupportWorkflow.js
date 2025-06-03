"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.emailCustomerSupportMessageWorkflow = emailCustomerSupportMessageWorkflow;
exports.customerSupportMessageWorkflow = customerSupportMessageWorkflow;
const workflow_1 = require("@temporalio/workflow");
const sendEmailFromAgentWorkflow_1 = require("./sendEmailFromAgentWorkflow");
const sendWhatsappFromAgentWorkflow_1 = require("./sendWhatsappFromAgentWorkflow");
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
// Configure activity options
const { sendCustomerSupportMessageActivity, processAnalysisDataActivity } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: '2 minutes',
    retry: {
        maximumAttempts: 3,
    },
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
                processed: false,
                reason: processResult.reason,
                emailSent: false
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
                processed: true,
                reason: 'Customer support message failed',
                error: response?.error || 'Customer support call was not successful',
                emailSent: false
            };
        }
        console.log('✅ Customer support message sent successfully');
        console.log(`📋 Customer support response:`, JSON.stringify(response.data, null, 2));
        // 🌟 NEW: Call sendEmailFromAgent workflow ONLY if customer support was successful
        let emailWorkflowId;
        let emailSent = false;
        try {
            // Check if we have contact email and original lead_notification indicates email should be sent
            if (emailData.contact_info.email && emailData.lead_notification === 'email') {
                console.log('📧 Starting sendEmailFromAgent workflow - customer support was successful...');
                console.log(`🔄 Original lead_notification: ${emailData.lead_notification} - proceeding with follow-up email`);
                // ✅ FIXED: Manejar analysis_id opcional para el workflowId
                const emailWorkflowSuffix = emailData.analysis_id || `temp-${Date.now()}`;
                emailWorkflowId = `send-email-agent-${emailWorkflowSuffix}`;
                // Prepare email parameters
                const emailParams = {
                    email: emailData.contact_info.email,
                    subject: response.data?.data?.conversation_title || `Re: ${emailData.original_subject || 'Your inquiry'}`, // ✅ FIXED: Usar conversation_title para el subject
                    // ✅ FIXED: Usar la respuesta real del agente desde messages.assistant.content
                    message: response.data?.data?.messages?.assistant?.content ||
                        `Thank you for your message. We have received your inquiry and our customer support team has been notified. We will get back to you shortly.`,
                    site_id: emailData.site_id,
                    agent_id: baseParams.agentId,
                    // ✅ FIXED: Solo enviar lead_id si hay un analysis_id real
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
            else if (!emailData.contact_info.email) {
                console.log('📭 No email address available for follow-up');
            }
            else if (emailData.lead_notification !== 'email') {
                console.log(`📋 lead_notification = "${emailData.lead_notification}" - skipping follow-up email`);
            }
        }
        catch (emailError) {
            console.error('❌ Email workflow failed, but customer support was successful:', emailError);
            // Don't fail the entire workflow if email fails
        }
        console.log('✅ Email customer support message workflow completed successfully');
        return {
            success: true,
            processed: true,
            reason: processResult.reason,
            response,
            emailSent,
            emailWorkflowId
        };
    }
    catch (error) {
        console.error('❌ Email customer support message workflow failed:', error);
        return {
            success: false,
            processed: false,
            reason: 'Workflow execution failed',
            error: error instanceof Error ? error.message : String(error),
            emailSent: false
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
    console.log(`🔄 Origin: ${baseParams.origin || 'not specified'}`);
    try {
        // Detectar si es WhatsApp o Email basado en el origen o estructura de datos
        if (baseParams.origin === 'whatsapp' && 'whatsappData' in messageData) {
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
            const response = await sendCustomerSupportMessageActivity(emailDataForCS, baseParams);
            if (!response || !response.success) {
                console.error('❌ WhatsApp customer support message failed:', response?.error || 'Unknown error');
                return {
                    success: false,
                    processed: true,
                    reason: 'WhatsApp customer support message failed',
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
                    message: response.data?.data?.messages?.assistant?.content ||
                        `Thank you for your message. We have received your inquiry and our customer support team has been notified. We will get back to you shortly.`,
                    site_id: whatsappData.siteId,
                    from: 'Customer Support',
                    agent_id: baseParams.agentId,
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
            console.log('✅ WhatsApp customer support message workflow completed successfully');
            return {
                success: true,
                processed: true,
                reason: 'WhatsApp message processed for customer support',
                response,
                whatsappSent,
                whatsappWorkflowId
            };
        }
        else {
            console.log('📧 Detected email message - delegating to email workflow');
            // Usar el workflow específico para emails
            return await emailCustomerSupportMessageWorkflow(messageData, baseParams);
        }
    }
    catch (error) {
        console.error('❌ Customer support workflow failed:', error);
        return {
            success: false,
            processed: false,
            reason: 'Workflow execution failed',
            error: error instanceof Error ? error.message : String(error),
            emailSent: false,
            whatsappSent: false
        };
    }
}
