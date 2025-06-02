"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.answerWhatsappMessageWorkflow = answerWhatsappMessageWorkflow;
exports.processWhatsAppMessagesWorkflow = processWhatsAppMessagesWorkflow;
exports.whatsappCustomerSupportWorkflow = whatsappCustomerSupportWorkflow;
const workflow_1 = require("@temporalio/workflow");
/**
 * Helper function to map WhatsApp intents to EmailData intents
 */
function mapWhatsAppIntentToEmailIntent(whatsappIntent) {
    switch (whatsappIntent) {
        case 'inquiry':
            return 'inquiry';
        case 'complaint':
            return 'complaint';
        case 'purchase':
            return 'purchase';
        case 'support':
            return 'support';
        case 'greeting':
        case 'follow_up':
            return 'inquiry'; // Map greeting and follow_up to inquiry
        case 'unknown':
        default:
            return 'inquiry'; // Default to inquiry for unknown or undefined
    }
}
// Configure activity options
const { analyzeWhatsAppMessageActivity, sendWhatsAppResponseActivity, sendCustomerSupportMessageActivity } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: '2 minutes',
    retry: {
        maximumAttempts: 3,
    },
});
/**
 * Answer WhatsApp Message Workflow
 * Analyzes incoming WhatsApp messages and optionally sends automated responses
 */
async function answerWhatsappMessageWorkflow(messageData, options) {
    const workflowId = `whatsapp-message-${messageData.messageId || Date.now()}`;
    console.log('📱 Starting WhatsApp message workflow...');
    console.log(`🆔 Workflow ID: ${workflowId}`);
    console.log(`📞 From: ${messageData.senderName || messageData.phoneNumber}`);
    console.log(`💬 Message: ${messageData.messageContent?.substring(0, 100) || 'No message content'}...`);
    console.log(`🏢 Site: ${messageData.siteId}, User: ${messageData.userId}`);
    let analyzed = false;
    let responded = false;
    let customerSupportTriggered = false;
    let analysis;
    let responseData;
    let customerSupportResult;
    try {
        // Step 1: Analyze the WhatsApp message
        console.log('🔍 Step 1: Analyzing WhatsApp message...');
        const analysisResult = await analyzeWhatsAppMessageActivity(messageData);
        if (!analysisResult.success) {
            console.error('❌ WhatsApp analysis failed:', analysisResult.error);
            return {
                success: false,
                analyzed: false,
                responded: false,
                error: analysisResult.error?.message || 'Analysis failed',
                workflow_id: workflowId
            };
        }
        analyzed = true;
        analysis = analysisResult.analysis;
        console.log('✅ WhatsApp message analysis completed');
        console.log(`📊 Analysis summary:`, {
            intent: analysis?.intent,
            priority: analysis?.priority,
            response_type: analysis?.response_type,
            sentiment: analysis?.sentiment,
            requires_action: analysis?.requires_action,
            has_suggested_response: !!analysis?.suggested_response
        });
        // Step 2: Send automated response if enabled and suggested
        if (options?.autoRespond && analysis?.suggested_response && analysis?.response_type === 'automated') {
            console.log('📤 Step 2: Sending automated WhatsApp response...');
            console.log(`🤖 Suggested response: ${analysis.suggested_response?.substring(0, 100) || 'No response content'}...`);
            try {
                const sendResult = await sendWhatsAppResponseActivity({
                    phone: messageData.phoneNumber,
                    message: analysis.suggested_response,
                    conversation_id: messageData.conversationId,
                    site_id: messageData.siteId,
                    user_id: messageData.userId,
                    agent_id: options.agentId,
                    message_type: 'text'
                });
                if (sendResult.success) {
                    responded = true;
                    responseData = {
                        message_id: sendResult.message_id,
                        sent_message: analysis.suggested_response
                    };
                    console.log('✅ Automated WhatsApp response sent successfully');
                    console.log(`📨 Message ID: ${sendResult.message_id}`);
                }
                else {
                    console.log('⚠️ Failed to send automated response:', sendResult.error);
                }
            }
            catch (responseError) {
                console.error('❌ WhatsApp response failed:', responseError);
                // Don't fail the entire workflow if response fails
            }
        }
        else if (analysis?.response_type === 'human_required') {
            console.log('👨‍💼 Human response required - skipping automated response');
        }
        else if (!options?.autoRespond) {
            console.log('🔇 Auto-respond disabled - skipping automated response');
        }
        else if (!analysis?.suggested_response) {
            console.log('💭 No suggested response available - skipping automated response');
        }
        else {
            console.log(`📋 Response type "${analysis?.response_type}" - skipping automated response`);
        }
        // Step 3: Trigger Customer Support workflow
        console.log('🎯 Step 3: Triggering Customer Support workflow...');
        if (analysis && (analysis.requires_action || analysis.priority === 'high' || analysis.intent === 'complaint')) {
            console.log('📞 Triggering customer support - message requires attention');
            try {
                const customerSupportWorkflowId = `whatsapp-customer-support-${messageData.messageId || Date.now()}`;
                // Start WhatsApp-specific customer support workflow as child workflow
                const customerSupportHandle = await (0, workflow_1.startChild)(whatsappCustomerSupportWorkflow, {
                    workflowId: customerSupportWorkflowId,
                    args: [
                        messageData,
                        analysis,
                        {
                            agentId: options?.agentId
                        }
                    ],
                    parentClosePolicy: workflow_1.ParentClosePolicy.PARENT_CLOSE_POLICY_ABANDON,
                });
                customerSupportTriggered = true;
                console.log(`✅ WhatsApp customer support workflow started: ${customerSupportWorkflowId}`);
                console.log(`🚀 Parent close policy: ABANDON - customer support workflow will continue independently`);
                // Wait for customer support workflow to complete
                const csResult = await customerSupportHandle.result();
                customerSupportResult = {
                    success: csResult.success,
                    processed: csResult.processed,
                    workflowId: customerSupportWorkflowId
                };
                if (csResult.success) {
                    console.log('✅ WhatsApp customer support workflow completed successfully');
                    if (csResult.processed) {
                        console.log(`📋 Customer support processed: ${csResult.reason}`);
                    }
                    else {
                        console.log(`⏭️ Customer support skipped: ${csResult.reason}`);
                    }
                }
                else {
                    console.log('⚠️ WhatsApp customer support workflow failed, but WhatsApp workflow continues');
                }
            }
            catch (customerSupportError) {
                console.error('❌ WhatsApp customer support workflow failed:', customerSupportError);
                customerSupportResult = {
                    success: false,
                    processed: false,
                    workflowId: `whatsapp-customer-support-${messageData.messageId || Date.now()}`
                };
                // Don't fail the entire WhatsApp workflow if customer support fails
            }
        }
        else {
            console.log('⏭️ Skipping customer support - message does not require immediate attention');
            console.log(`📊 Analysis: requires_action=${analysis?.requires_action}, priority=${analysis?.priority}, intent=${analysis?.intent}`);
        }
        console.log('✅ WhatsApp message workflow completed successfully');
        return {
            success: true,
            analyzed,
            responded,
            customerSupportTriggered,
            analysis,
            response: responseData,
            customerSupportResult,
            workflow_id: workflowId
        };
    }
    catch (error) {
        console.error('❌ WhatsApp message workflow failed:', error);
        return {
            success: false,
            analyzed,
            responded,
            error: error instanceof Error ? error.message : String(error),
            workflow_id: workflowId
        };
    }
}
/**
 * Batch WhatsApp Messages Workflow
 * Processes multiple WhatsApp messages with intervals
 */
async function processWhatsAppMessagesWorkflow(messages, options) {
    console.log('📱 Starting batch WhatsApp messages workflow...');
    const startTime = new Date();
    const totalMessages = messages.length;
    const intervalMinutes = options?.intervalMinutes || 1;
    console.log(`📊 Processing ${totalMessages} WhatsApp messages...`);
    console.log(`⏰ Interval: ${intervalMinutes} minute(s) between messages`);
    console.log(`🤖 Auto-respond: ${options?.autoRespond ? 'enabled' : 'disabled'}`);
    const results = [];
    let processed = 0;
    let analyzed = 0;
    let responded = 0;
    let failed = 0;
    try {
        // Process each message with intervals
        for (let i = 0; i < messages.length; i++) {
            const messageData = messages[i];
            const workflowId = `batch-whatsapp-${i}-${Date.now()}`;
            console.log(`📱 Processing WhatsApp message ${i + 1}/${totalMessages}`);
            console.log(`📞 From: ${messageData.senderName || messageData.phoneNumber}`);
            console.log(`💬 Message preview: ${messageData.messageContent?.substring(0, 50) || 'No message content'}...`);
            try {
                const result = await answerWhatsappMessageWorkflow(messageData, options);
                processed++;
                if (result.analyzed)
                    analyzed++;
                if (result.responded)
                    responded++;
                if (!result.success) {
                    failed++;
                }
                results.push({
                    index: i,
                    phone: messageData.phoneNumber,
                    success: result.success,
                    analyzed: result.analyzed,
                    responded: result.responded,
                    error: result.error,
                    workflowId: result.workflow_id
                });
                console.log(`✅ Processed message ${i + 1}: ${result.success ? 'success' : 'failed'}`);
                // Wait interval before processing next message (except for the last one)
                if (i < messages.length - 1 && intervalMinutes > 0) {
                    console.log(`⏰ Waiting ${intervalMinutes} minute(s) before next message...`);
                    await new Promise(resolve => setTimeout(resolve, intervalMinutes * 60 * 1000));
                }
            }
            catch (error) {
                failed++;
                const errorMessage = error instanceof Error ? error.message : String(error);
                console.error(`❌ Failed to process message ${i + 1}:`, errorMessage);
                results.push({
                    index: i,
                    phone: messageData.phoneNumber,
                    success: false,
                    analyzed: false,
                    responded: false,
                    error: errorMessage,
                    workflowId: workflowId
                });
            }
        }
        const endTime = new Date();
        const executionTime = `${endTime.getTime() - startTime.getTime()}ms`;
        console.log('🎉 Batch WhatsApp messages workflow completed');
        console.log(`📊 Summary: ${processed} processed, ${analyzed} analyzed, ${responded} responded, ${failed} failed`);
        return {
            totalMessages,
            processed,
            analyzed,
            responded,
            failed,
            results,
            executionTime
        };
    }
    catch (error) {
        console.error('❌ Batch WhatsApp messages workflow failed:', error);
        throw error;
    }
}
/**
 * WhatsApp Customer Support Workflow
 * Workflow específico para manejar el customer support de mensajes de WhatsApp
 */
async function whatsappCustomerSupportWorkflow(messageData, analysis, options) {
    const workflowId = `whatsapp-customer-support-${messageData.messageId || Date.now()}`;
    console.log('🎯 Starting WhatsApp Customer Support workflow...');
    console.log(`🆔 Workflow ID: ${workflowId}`);
    console.log(`📞 From: ${messageData.senderName || messageData.phoneNumber}`);
    console.log(`🏢 Site: ${messageData.siteId}, User: ${messageData.userId}`);
    try {
        // Prepare customer support message request specifically for WhatsApp
        const customerSupportRequest = {
            message: analysis?.summary || `WhatsApp message from ${messageData.senderName || messageData.phoneNumber}: ${messageData.messageContent || 'No message content'}`,
            messageIds: [messageData.messageId || `whatsapp-${Date.now()}`], // Array of message IDs as required
            agentId: options?.agentId || 'whatsapp-agent',
            conversation_id: messageData.conversationId || 'whatsapp-conversation', // Provide default if null
            site_id: messageData.siteId,
            user_id: messageData.userId,
            name: messageData.senderName,
            phone: messageData.phoneNumber,
            lead_notification: "none", // Evitar duplicar notificaciones
            origin: "whatsapp"
        };
        console.log('📤 Sending WhatsApp customer support request:', {
            messageIds: customerSupportRequest.messageIds,
            agentId: customerSupportRequest.agentId,
            conversation_id: customerSupportRequest.conversation_id,
            hasName: !!customerSupportRequest.name,
            hasPhone: !!customerSupportRequest.phone,
            site_id: customerSupportRequest.site_id,
            user_id: customerSupportRequest.user_id,
            origin: customerSupportRequest.origin
        });
        // Crear un EmailData compatible para la activity existente
        const emailDataForCS = {
            summary: customerSupportRequest.message,
            original_subject: `WhatsApp: ${analysis?.intent || 'Message'} from ${messageData.senderName || messageData.phoneNumber}`,
            contact_info: {
                name: messageData.senderName || 'WhatsApp Contact',
                email: '', // WhatsApp no tiene email
                phone: messageData.phoneNumber,
                company: ''
            },
            site_id: messageData.siteId,
            user_id: messageData.userId,
            lead_notification: "none",
            analysis_id: `whatsapp-${messageData.messageId || Date.now()}`,
            priority: analysis?.priority || 'medium',
            intent: mapWhatsAppIntentToEmailIntent(analysis?.intent),
            potential_value: analysis?.priority === 'high' ? 'high' : 'medium'
        };
        const baseParams = {
            agentId: options?.agentId,
            origin: "whatsapp"
        };
        const result = await sendCustomerSupportMessageActivity(emailDataForCS, baseParams);
        if (!result.success) {
            console.error('❌ WhatsApp customer support failed:', result.error);
            return {
                success: false,
                processed: false,
                workflowId,
                error: result.error
            };
        }
        console.log('✅ WhatsApp customer support completed successfully');
        return {
            success: true,
            processed: true,
            workflowId,
            reason: 'WhatsApp message processed for customer support'
        };
    }
    catch (error) {
        console.error('❌ WhatsApp customer support workflow failed:', error);
        return {
            success: false,
            processed: false,
            workflowId,
            error: error instanceof Error ? error.message : String(error)
        };
    }
}
