"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendEmailFromAgent = sendEmailFromAgent;
const workflow_1 = require("@temporalio/workflow");
const timeouts_1 = require("../config/timeouts");
// Configure activity options using centralized timeouts
const { sendEmailFromAgentActivity, updateMessageStatusToSentActivity } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: timeouts_1.ACTIVITY_TIMEOUTS.EMAIL_OPERATIONS, // ✅ Using centralized config (3 minutes)
    retry: timeouts_1.RETRY_POLICIES.NETWORK, // ✅ Using appropriate retry policy for email operations
});
/**
 * Send Email From Agent Workflow
 * Sends an email via the agent API endpoint
 */
async function sendEmailFromAgent(params) {
    console.log('📧 Starting send email from agent workflow...');
    const startTime = new Date();
    try {
        // Validate required parameters
        if (!params.email || !params.subject || !params.message || !params.site_id) {
            throw new Error('Missing required email parameters: email, subject, message and site_id are all required');
        }
        console.log('📤 Sending email via agent API:', {
            recipient: params.email,
            from: params.from || 'not-provided',
            subject: params.subject,
            messageLength: params.message.length,
            site_id: params.site_id,
            agent_id: params.agent_id || 'not-provided',
            conversation_id: params.conversation_id || 'not-provided',
            lead_id: params.lead_id || 'not-provided'
        });
        // Send email using the agent API
        const emailResult = await sendEmailFromAgentActivity({
            email: params.email,
            from: params.from,
            subject: params.subject,
            message: params.message,
            site_id: params.site_id,
            agent_id: params.agent_id,
            conversation_id: params.conversation_id,
            lead_id: params.lead_id
        });
        const endTime = new Date();
        const executionTime = `${endTime.getTime() - startTime.getTime()}ms`;
        console.log('✅ Email sent successfully via agent API:', {
            messageId: emailResult.messageId,
            recipient: emailResult.recipient,
            executionTime
        });
        // Actualizar custom_data.channel = "email" solo si tenemos message_id o conversation_id
        // (significa que hay un mensaje existente en BD para actualizar)
        if (params.message_id || params.conversation_id) {
            try {
                console.log('📝 Updating message custom_data with channel = email...', {
                    message_id: params.message_id || 'not-provided',
                    conversation_id: params.conversation_id || 'not-provided',
                    api_messageId: emailResult.messageId // Para logging
                });
                const updateResult = await updateMessageStatusToSentActivity({
                    message_id: params.message_id,
                    conversation_id: params.conversation_id,
                    lead_id: params.lead_id || '',
                    site_id: params.site_id,
                    delivery_channel: 'email',
                    delivery_success: true,
                    delivery_details: {
                        channel: 'email',
                        api_messageId: emailResult.messageId, // ID retornado por la API
                        recipient: emailResult.recipient,
                        timestamp: emailResult.timestamp
                    }
                });
                if (updateResult.success) {
                    console.log('✅ Message custom_data updated successfully with channel = email');
                }
                else {
                    console.log('⚠️ Failed to update message custom_data:', updateResult.error);
                }
            }
            catch (updateError) {
                console.log('⚠️ Error updating message custom_data:', updateError instanceof Error ? updateError.message : String(updateError));
                // No fallar el workflow por error de actualización
            }
        }
        else {
            console.log('ℹ️ No message_id or conversation_id provided - skipping custom_data update');
        }
        return {
            success: emailResult.success,
            messageId: emailResult.messageId,
            recipient: emailResult.recipient,
            executionTime,
            timestamp: emailResult.timestamp
        };
    }
    catch (error) {
        const endTime = new Date();
        const executionTime = `${endTime.getTime() - startTime.getTime()}ms`;
        console.error('❌ Send email from agent workflow failed:', {
            error: error instanceof Error ? error.message : String(error),
            executionTime
        });
        // Actualizar status = "failed" solo si tenemos message_id o conversation_id
        if (params.message_id || params.conversation_id) {
            try {
                console.log('📝 Updating message status to failed...', {
                    message_id: params.message_id || 'not-provided',
                    conversation_id: params.conversation_id || 'not-provided'
                });
                const updateResult = await updateMessageStatusToSentActivity({
                    message_id: params.message_id,
                    conversation_id: params.conversation_id,
                    lead_id: params.lead_id || '',
                    site_id: params.site_id,
                    delivery_channel: 'email',
                    delivery_success: false,
                    delivery_details: {
                        status: 'failed',
                        error: error instanceof Error ? error.message : String(error),
                        timestamp: new Date().toISOString(),
                        executionTime
                    }
                });
                if (updateResult.success) {
                    console.log('✅ Message status updated to failed');
                }
                else {
                    console.log('⚠️ Failed to update message status to failed:', updateResult.error);
                }
            }
            catch (updateError) {
                console.log('⚠️ Error updating message status to failed:', updateError instanceof Error ? updateError.message : String(updateError));
                // No fallar el workflow por error de actualización
            }
        }
        else {
            console.log('ℹ️ No message_id or conversation_id provided - skipping status update');
        }
        throw error;
    }
}
