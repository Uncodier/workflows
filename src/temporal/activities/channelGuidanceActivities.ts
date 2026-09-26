import { apiService } from '../services/apiService';

export interface ChannelGuidanceContext {
  siteId: string;
  messageId: string;
  channel: string;
  conversationId?: string;
  message: string;
}

export interface PreparedChannelGuidance {
  runs: Array<{ runPlanId: string; status: string }>;
}

export interface AdvancedChannelGuidance {
  status: 'in_progress' | 'completed' | 'failed' | 'already_running';
}

// One bounded request per turn; Temporal, not a serverless HTTP handler, owns polling.
const HTTP_TIMEOUT_MS = 12_000;
const ADVANCE_HTTP_TIMEOUT_MS = 105_000;

async function channelGuidanceRequest<T>(endpoint: string, body: object, timeout = HTTP_TIMEOUT_MS): Promise<T> {
  const response = await apiService.request<T>(endpoint, {
    method: 'POST',
    body,
    timeout,
  });
  if (!response.success || !response.data) {
    throw new Error(`Channel guidance request failed: ${endpoint}`);
  }
  return response.data;
}

export function prepareChannelGuidanceActivity(context: ChannelGuidanceContext): Promise<PreparedChannelGuidance> {
  return channelGuidanceRequest('/api/workflows/channel-message/prepare', context);
}

export function advanceChannelGuidanceActivity(
  context: Pick<ChannelGuidanceContext, 'siteId' | 'messageId'> & { runPlanId: string }
): Promise<AdvancedChannelGuidance> {
  return channelGuidanceRequest('/api/workflows/channel-message/advance', context, ADVANCE_HTTP_TIMEOUT_MS);
}

export function resultChannelGuidanceActivity(
  context: Pick<ChannelGuidanceContext, 'siteId' | 'messageId' | 'channel'> & { runPlanIds: string[] }
): Promise<{ guidance: string }> {
  return channelGuidanceRequest('/api/workflows/channel-message/result', context);
}
