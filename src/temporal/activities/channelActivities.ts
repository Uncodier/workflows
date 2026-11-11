import { checkConversationAutomationActivity } from './automationSnoozeActivities';
import { automationSkipMetadata, type AutomationSkipMetadata } from '../utils/automationSnooze';
import { ApplicationFailure } from '@temporalio/common';
import { apiService } from '../services/apiService';
import type { SendChannelMessageFromAgentParams } from '../workflows/sendChannelMessageFromAgentWorkflow';
import type { SendVoiceCallFromAgentParams } from '../workflows/sendVoiceCallFromAgentWorkflow';
import { templateDeliveryMetadata, validateTemplateDelivery, type TemplateDeliveryMetadata, type TemplateRecoveryRequest, type TemplateRecoveryResult } from '../utils/templateDelivery';

const RETRYABLE_CLIENT_STATUSES = new Set([408, 409, 425, 429]);

/** Read-only reconciliation. Retrying this activity can never send to a provider. */
export async function reconcileTemplateDeliveryActivity(request: TemplateRecoveryRequest): Promise<TemplateRecoveryResult> {
  if (!request.site_id || !request.conversation_id || !request.message_id) {
    throw ApplicationFailure.nonRetryable('Missing saved template identity', 'TEMPLATE_RECONCILIATION_INVALID');
  }
  const query = new URLSearchParams({ site_id: request.site_id,
    conversation_id: request.conversation_id, message_id: request.message_id });
  // request uses exactly the same API base and x-api-key as apiService.get;
  // specify a shorter HTTP timeout than the bounded read activity timeout.
  const response = await apiService.request<TemplateRecoveryResult>(
    `/api/agents/tools/templateDeliveryStatus?${query}`, { method: 'GET', timeout: 15_000 });
  if (!response.success) {
    const status = response.error?.status;
    throw ApplicationFailure.create({ message: 'Template reconciliation unavailable',
      type: 'TEMPLATE_RECONCILIATION_UNAVAILABLE',
      nonRetryable: typeof status === 'number' && status >= 400 && status < 500 && !RETRYABLE_CLIENT_STATUSES.has(status),
    });
  }
  const result = response.data;
  if (!result?.success || (result.local_message_id || result.message_id) !== request.message_id || !result.template_id
    || result.delivery_format !== 'template' || !['resume', 'complete', 'stop'].includes(result.recovery_action)) {
    throw ApplicationFailure.nonRetryable('Invalid template reconciliation receipt', 'TEMPLATE_RECONCILIATION_INVALID');
  }
  return result;
}

/** Idempotent control action, NOT a send. API CAS preserves the durable receipt. */
export async function markTemplateReconciliationRequiredActivity(request: TemplateRecoveryRequest & { template_id: string }): Promise<void> {
  if (!request.site_id || !request.conversation_id || !request.message_id || !request.template_id) {
    throw ApplicationFailure.nonRetryable('Missing saved template identity', 'TEMPLATE_RECONCILIATION_INVALID');
  }
  const response = await apiService.request('/api/agents/tools/templateDeliveryStatus', {
    method: 'POST', timeout: 15_000, body: { ...request, action: 'mark_reconciliation_required' },
  });
  if (!response.success || response.data?.success !== true) {
    const status = response.error?.status;
    throw ApplicationFailure.create({ message: 'Could not persist template reconciliation requirement',
      type: 'TEMPLATE_RECONCILIATION_MARK_UNAVAILABLE',
      nonRetryable: typeof status === 'number' && status >= 400 && status < 500 && !RETRYABLE_CLIENT_STATUSES.has(status) });
  }
}

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
): Promise<{ success: boolean; messageId?: string; error?: string } & TemplateDeliveryMetadata & AutomationSkipMetadata> {
  const guard = await checkConversationAutomationActivity(params);
  if (guard.skipped) return { ...guard };

  console.log(`Sending ${params.channel} message via agent API to ${params.to}`);

  if (params.response_format === 'audio' && !params.message_id?.trim()) {
    throw ApplicationFailure.nonRetryable('Explicit audio requires message_id', 'AUDIO_MESSAGE_ID_REQUIRED');
  }
  try {
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
      ...(params.response_format !== undefined ? { response_format: params.response_format } : {}),
    });

    if (!response.success) {
      throw createChannelApiFailure(params.channel, response.error);
    }
    if (response.data?.skipped === true) return { success: true, ...automationSkipMetadata(response.data) };
    if (params.response_format === 'audio' && response.data?.template_required) {
      throw ApplicationFailure.nonRetryable('Explicit audio cannot use a template', 'AUDIO_TEMPLATE_REQUIRED');
    }

    const templateAudio = params.channel === 'whatsapp' && params.response_format === 'audio';
    if (templateAudio) validateTemplateDelivery(response.data || {}, params.message_id!);

    const messageId = response.data?.messageId || response.data?.message_id;
    console.log(`${params.channel} API delivery status:`, response.data?.status || 'sent');

    return {
      success: true,
      messageId,
      ...(templateAudio ? templateDeliveryMetadata(response.data || {}) : {}),
    };
  } catch (error) {
    if (params.response_format === 'audio') {
      if (error instanceof ApplicationFailure && error.nonRetryable) throw error;
      throw ApplicationFailure.nonRetryable(
        `Audio delivery failed or is unknown; reconcile before retry: ${error instanceof Error ? error.message : String(error)}`,
        'AUDIO_DELIVERY_FAILED_OR_UNKNOWN'
      );
    }
    throw error;
  }
}

export async function placeVoiceCallFromAgentActivity(
  params: SendVoiceCallFromAgentParams
): Promise<{ success: true; callId: string; status: string; deliveryId?: string } & AutomationSkipMetadata> {
  const guard = await checkConversationAutomationActivity(params);
  if (guard.skipped) return { ...guard, callId: '', status: 'skipped' };
  const response = await apiService.post<{
    skipped?: boolean;
    success: true;
    callId: string;
    status: string;
    deliveryId?: string;
  }>('/api/agents/tools/placeVoiceCall', {
    to: params.to,
    message: params.message,
    site_id: params.site_id,
    agent_id: params.agent_id,
    conversation_id: params.conversation_id,
    lead_id: params.lead_id,
    message_id: params.message_id,
    audience_id: params.audience_id,
    language: params.language,
    max_duration_minutes: params.max_duration_minutes,
  });

  if (response.success && response.data?.skipped === true) return {
    success: true, callId: '', status: 'skipped', ...automationSkipMetadata(response.data),
  };
  if (!response.success || !response.data?.callId) {
    const status = response.error?.status;
    const capacityReached = status === 429;
    const placementUnknown =
      status === undefined || status === 408 || status === 425 || status >= 500;
    throw ApplicationFailure.create({
      message: response.error?.message || 'Failed to place Voice call',
      type: capacityReached
        ? 'VOICE_CALL_CAPACITY_REACHED'
        : placementUnknown
          ? 'VOICE_CALL_PLACEMENT_UNKNOWN'
          : 'VOICE_CALL_REQUEST_REJECTED',
      nonRetryable: !capacityReached,
      details: [{ status, code: response.error?.code }],
    });
  }

  return response.data;
}
