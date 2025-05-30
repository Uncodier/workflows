"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendEmailFromAgent = sendEmailFromAgent;
const workflow_1 = require("@temporalio/workflow");
// Configure activity options
const { sendEmailFromAgentActivity } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: '2 minutes',
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
        if (!params.email || !params.from || !params.subject || !params.message) {
            throw new Error('Missing required email parameters: email, from, subject, and message are all required');
        }
        console.log('📤 Sending email via agent API:', {
            recipient: params.email,
            from: params.from,
            subject: params.subject,
            messageLength: params.message.length
        });
        // Send email using the agent API
        const emailResult = await sendEmailFromAgentActivity({
            email: params.email,
            from: params.from,
            subject: params.subject,
            message: params.message
        });
        const endTime = new Date();
        const executionTime = `${endTime.getTime() - startTime.getTime()}ms`;
        console.log('✅ Email sent successfully via agent API:', {
            messageId: emailResult.messageId,
            recipient: emailResult.recipient,
            executionTime
        });
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
        throw error;
    }
}
