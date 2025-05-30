"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendEmailFromAgentActivity = sendEmailFromAgentActivity;
const apiService_1 = require("../services/apiService");
/**
 * Activity to send email via agent API
 */
async function sendEmailFromAgentActivity(params) {
    console.log('📧 Sending email from agent:', {
        recipient: params.email,
        from: params.from,
        subject: params.subject,
        messageLength: params.message.length
    });
    try {
        const response = await apiService_1.apiService.post('/api/agents/tools/sendEmail', {
            email: params.email,
            from: params.from,
            subject: params.subject,
            message: params.message
        });
        if (!response.success) {
            throw new Error(`Failed to send email: ${response.error?.message}`);
        }
        console.log('✅ Email sent successfully:', response.data);
        return {
            success: true,
            messageId: response.data.messageId || 'unknown',
            recipient: params.email,
            timestamp: new Date().toISOString()
        };
    }
    catch (error) {
        console.error('❌ Email sending failed:', error);
        throw new Error(`Email sending failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}
