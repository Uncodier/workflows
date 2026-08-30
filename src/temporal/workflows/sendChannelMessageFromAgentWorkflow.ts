import { proxyActivities, upsertSearchAttributes } from '@temporalio/workflow';
import type * as activities from '../activities';
import { ACTIVITY_TIMEOUTS, RETRY_POLICIES } from '../config/timeouts';

// Configure activity options
const {
  sendChannelMessageFromAgentActivity
} = proxyActivities<typeof activities>({
  startToCloseTimeout: ACTIVITY_TIMEOUTS.WHATSAPP_OPERATIONS, // Reusing timeout config
  retry: RETRY_POLICIES.NETWORK,
});

export interface SendChannelMessageFromAgentParams {
  channel: string;
  to: string;
  message: string;
  site_id: string;
  subject?: string;
  agent_id?: string;
  conversation_id?: string;
  lead_id?: string;
  message_id?: string;
}

export interface SendChannelMessageFromAgentResult {
  success: boolean;
  messageId: string;
  recipient: string;
  executionTime: string;
  timestamp: string;
}

/**
 * Send Channel Message From Agent Workflow
 * Sends a generic channel message (like telegram or messenger) via the API endpoint
 */
export async function sendChannelMessageFromAgentWorkflow(params: SendChannelMessageFromAgentParams): Promise<SendChannelMessageFromAgentResult> {
  console.log(`📤 Starting send ${params.channel} from agent workflow...`);
  const startTime = new Date();

  try {
    if (!params.channel || !params.to || !params.message || !params.site_id) {
      throw new Error(`Missing required parameters: channel, to, message and site_id are required`);
    }

    const searchAttributes: Record<string, string[]> = {
      site_id: [params.site_id],
    };
    if (params.agent_id) {
      searchAttributes.user_id = [params.agent_id];
    }
    if (params.lead_id) {
      searchAttributes.lead_id = [params.lead_id];
    }
    upsertSearchAttributes(searchAttributes);

    console.log(`📞 Executing activity to send ${params.channel} message...`);
    const result = await sendChannelMessageFromAgentActivity(params);

    if (!result.success) {
      throw new Error(result.error || `Failed to send ${params.channel} message`);
    }

    const endTime = new Date();
    const executionTimeMs = endTime.getTime() - startTime.getTime();

    console.log(`✅ ${params.channel} message workflow completed successfully in ${executionTimeMs}ms`);

    return {
      success: true,
      messageId: result.messageId || 'unknown',
      recipient: params.to,
      executionTime: `${executionTimeMs}ms`,
      timestamp: endTime.toISOString()
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Send ${params.channel} from agent workflow failed:`, errorMessage);
    
    throw new Error(errorMessage);
  }
}
