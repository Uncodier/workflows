import { apiService } from '../services/apiService';
import type { SendChannelMessageFromAgentParams } from '../workflows/sendChannelMessageFromAgentWorkflow';

export async function sendChannelMessageFromAgentActivity(
  params: SendChannelMessageFromAgentParams
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  console.log(`Sending ${params.channel} message via agent API to ${params.to}`);

  const response = await apiService.post('/api/agents/tools/sendChannelMessage', {
    channel: params.channel,
    to: params.to,
    message: params.message,
    site_id: params.site_id,
    subject: params.subject,
    agent_id: params.agent_id,
    conversation_id: params.conversation_id,
    lead_id: params.lead_id,
    message_id: params.message_id,
  });

  if (!response.success) {
    throw new Error(
      `Failed to send ${params.channel} message: ${response.error?.message || 'Unknown error'}`
    );
  }

  const messageId = response.data?.messageId || response.data?.message_id;
  console.log(`${params.channel} sent successfully via agent API:`, messageId);

  return {
    success: true,
    messageId,
  };
}
