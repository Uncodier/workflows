import { ApplicationFailure } from '@temporalio/common';
import { apiService } from '../services/apiService';
import type { SendChannelMessageFromAgentParams } from '../workflows/sendChannelMessageFromAgentWorkflow';

const RETRYABLE_CLIENT_STATUSES = new Set([408, 409, 425, 429]);

export function createChannelApiFailure(
  channel: string,
  error: { code?: string; message?: string; status?: number } | undefined
): ApplicationFailure {
  const status = error?.status;
  const nonRetryable =
    typeof status === 'number' &&
    status >= 400 &&
    status < 500 &&
    !RETRYABLE_CLIENT_STATUSES.has(status);

  return ApplicationFailure.create({
    message: `Failed to send ${channel} message: ${error?.message || 'Unknown error'}`,
    type: nonRetryable ? 'CHANNEL_REQUEST_REJECTED' : 'CHANNEL_API_FAILURE',
    nonRetryable,
    details: [{ channel, code: error?.code, status }],
  });
}

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
    custom_data: params.custom_data,
  });

  if (!response.success) {
    throw createChannelApiFailure(params.channel, response.error);
  }

  const messageId = response.data?.messageId || response.data?.message_id;
  console.log(`${params.channel} sent successfully via agent API:`, messageId);

  return {
    success: true,
    messageId,
  };
}
