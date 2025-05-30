import { proxyActivities } from '@temporalio/workflow';
import type * as activities from '../activities';

// Configure activity options
const { sendEmailFromAgentActivity } = proxyActivities<typeof activities>({
  startToCloseTimeout: '2 minutes',
});

/**
 * Workflow parameters interface
 */
export interface SendEmailFromAgentParams {
  email: string;
  from: string;
  subject: string;
  message: string;
}

/**
 * Workflow result interface
 */
export interface SendEmailFromAgentResult {
  success: boolean;
  messageId: string;
  recipient: string;
  executionTime: string;
  timestamp: string;
}

/**
 * Send Email From Agent Workflow
 * Sends an email via the agent API endpoint
 */
export async function sendEmailFromAgent(params: SendEmailFromAgentParams): Promise<SendEmailFromAgentResult> {
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

  } catch (error) {
    const endTime = new Date();
    const executionTime = `${endTime.getTime() - startTime.getTime()}ms`;
    
    console.error('❌ Send email from agent workflow failed:', {
      error: error instanceof Error ? error.message : String(error),
      executionTime
    });
    
    throw error;
  }
} 