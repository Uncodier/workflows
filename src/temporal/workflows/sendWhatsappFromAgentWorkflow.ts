import { proxyActivities } from '@temporalio/workflow';
import type * as activities from '../activities';

// Configure activity options
const { sendWhatsAppFromAgentActivity } = proxyActivities<typeof activities>({
  startToCloseTimeout: '2 minutes',
});

/**
 * Workflow parameters interface
 */
export interface SendWhatsAppFromAgentParams {
  phone_number: string;
  message: string;
  site_id: string;
  from?: string;
  agent_id?: string;
  conversation_id?: string;
  lead_id?: string;
}

/**
 * Workflow result interface
 */
export interface SendWhatsAppFromAgentResult {
  success: boolean;
  messageId: string;
  recipient: string;
  executionTime: string;
  timestamp: string;
}

/**
 * Send WhatsApp From Agent Workflow
 * Sends a WhatsApp message via the agent API endpoint
 */
export async function sendWhatsappFromAgent(params: SendWhatsAppFromAgentParams): Promise<SendWhatsAppFromAgentResult> {
  console.log('📱 Starting send WhatsApp from agent workflow...');
  const startTime = new Date();

  try {
    // Validate required parameters
    if (!params.phone_number || !params.message || !params.site_id) {
      throw new Error('Missing required WhatsApp parameters: phone_number, message and site_id are all required');
    }

    console.log('📤 Sending WhatsApp via agent API:', {
      recipient: params.phone_number,
      from: params.from || 'AI Assistant',
      messageLength: params.message.length,
      site_id: params.site_id,
      agent_id: params.agent_id || 'not-provided',
      conversation_id: params.conversation_id || 'not-provided',
      lead_id: params.lead_id || 'not-provided'
    });

    // Send WhatsApp using the agent API
    const whatsappResult = await sendWhatsAppFromAgentActivity({
      phone_number: params.phone_number,
      message: params.message,
      site_id: params.site_id,
      from: params.from,
      agent_id: params.agent_id,
      conversation_id: params.conversation_id,
      lead_id: params.lead_id
    });

    const endTime = new Date();
    const executionTime = `${endTime.getTime() - startTime.getTime()}ms`;

    console.log('✅ WhatsApp sent successfully via agent API:', {
      messageId: whatsappResult.messageId,
      recipient: whatsappResult.recipient,
      executionTime
    });

    return {
      success: whatsappResult.success,
      messageId: whatsappResult.messageId,
      recipient: whatsappResult.recipient,
      executionTime,
      timestamp: whatsappResult.timestamp
    };

  } catch (error) {
    const endTime = new Date();
    const executionTime = `${endTime.getTime() - startTime.getTime()}ms`;
    
    console.error('❌ Send WhatsApp from agent workflow failed:', {
      error: error instanceof Error ? error.message : String(error),
      executionTime
    });
    
    throw error;
  }
} 