"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendEmailFromAgentActivity = sendEmailFromAgentActivity;
exports.syncSentEmailsActivity = syncSentEmailsActivity;
exports.deliveryStatusActivity = deliveryStatusActivity;
const apiService_1 = require("../services/apiService");
/**
 * Activity to send email via agent API
 */
async function sendEmailFromAgentActivity(params) {
    console.log('📧 Sending email from agent:', {
        recipient: params.email,
        from: params.from,
        subject: params.subject,
        messageLength: params.message.length,
        site_id: params.site_id,
        agent_id: params.agent_id,
        conversation_id: params.conversation_id,
        lead_id: params.lead_id
    });
    try {
        const response = await apiService_1.apiService.post('/api/agents/tools/sendEmail', {
            email: params.email,
            from: params.from,
            subject: params.subject,
            message: params.message,
            site_id: params.site_id,
            agent_id: params.agent_id,
            conversation_id: params.conversation_id,
            lead_id: params.lead_id
        });
        if (!response.success) {
            throw new Error(`Failed to send email: ${response.error?.message}`);
        }
        console.log('✅ Email sent successfully:', response.data);
        return {
            success: true,
            messageId: response.data.messageId || 'unknown',
            recipient: params.email,
            timestamp: new Date().toISOString(),
            external_message_id: response.data.external_message_id // Capturar el ID externo si está presente
        };
    }
    catch (error) {
        console.error('❌ Email sending failed:', error);
        throw new Error(`Email sending failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}
/**
 * Activity to sync sent emails via API
 */
async function syncSentEmailsActivity(params) {
    console.log('📨 Syncing sent emails:', {
        site_id: params.site_id,
        limit: params.limit || 10,
        since_date: params.since_date || 'not specified'
    });
    try {
        const requestBody = {
            site_id: params.site_id,
            limit: params.limit || 10,
            ...(params.since_date && { since_date: params.since_date })
        };
        console.log('📤 Sending sync sent emails request:', JSON.stringify(requestBody, null, 2));
        const response = await apiService_1.apiService.post('/api/agents/email/sync', requestBody);
        if (!response.success) {
            console.error('❌ Sent emails sync failed:', response.error);
            return {
                success: false,
                error: response.error?.message || 'Failed to sync sent emails'
            };
        }
        console.log('✅ Sent emails sync completed successfully');
        console.log('📊 Sync response data:', JSON.stringify(response.data, null, 2));
        return {
            success: true,
            data: response.data
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('❌ Sent emails sync failed:', errorMessage);
        return {
            success: false,
            error: errorMessage
        };
    }
}
/**
 * Activity to check email delivery status via API
 */
async function deliveryStatusActivity(params) {
    console.log('📋 Checking email delivery status:', {
        site_id: params.site_id
    });
    try {
        const requestBody = {
            site_id: params.site_id
        };
        console.log('📤 Sending delivery status request:', JSON.stringify(requestBody, null, 2));
        const response = await apiService_1.apiService.post('/api/agents/email/deliveryStatus', requestBody);
        if (!response.success) {
            console.error('❌ Email delivery status check failed:', response.error);
            return {
                success: false,
                error: response.error?.message || 'Failed to check email delivery status'
            };
        }
        console.log('✅ Email delivery status check completed successfully');
        console.log('📊 Delivery status response data:', JSON.stringify(response.data, null, 2));
        return {
            success: true,
            data: response.data
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('❌ Email delivery status check failed:', errorMessage);
        return {
            success: false,
            error: errorMessage
        };
    }
}
