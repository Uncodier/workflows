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
  from?: string;
  subject: string;
  message: string;
  site_id: string;
  agent_id?: string;
  conversation_id?: string;
  lead_id?: string;
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