import { checkConversationAutomationActivity } from './automationSnoozeActivities';
import type { AutomationSkipMetadata } from '../utils/automationSnooze';
import { apiService } from '../services/apiService';
import { ApplicationFailure } from '@temporalio/common';
import { validateTemplateDelivery, type TemplateDeliveryMetadata } from '../utils/templateDelivery';

export interface ExactQueuedDeliveryResult extends TemplateDeliveryMetadata, AutomationSkipMetadata {
  success: boolean;
  messageId?: string;
  recipient?: string;
  reason?: string;
}

/** API reads current message routing, recipient, content and voice context at every retry. */
export async function sendExactQueuedMessageActivity(request: {
  site_id: string; message_id: string; conversation_id: string; channel: string;
  response_format?: 'audio';
  existing_media?: boolean;
}): Promise<ExactQueuedDeliveryResult> {
  const guard = await checkConversationAutomationActivity(request);
  if (guard.skipped) return { ...guard };

  const templateAudio = request.channel === 'whatsapp' && request.response_format === 'audio';
  try {
    // The API resolves the immutable format from the saved message. This flag
    // selects activity safety semantics only, not a new HTTP argument.
    const { response_format: _format, existing_media: _media, ...body } = request;
    const response = await apiService.post<ExactQueuedDeliveryResult>('/api/agents/tools/sendExactDelivery', body);
    if (response.success && response.data?.skipped === true) return { ...response.data, success: true };
    if (response.success && response.data?.success) {
      if (templateAudio) validateTemplateDelivery(response.data, request.message_id);
      return templateAudio
        ? { ...response.data, messageId: response.data.messageId || response.data.message_id }
        : response.data;
    }
    if (templateAudio || request.existing_media) throw new Error('Exact delivery was not confirmed');
    return { success: false, reason: 'Exact selected delivery could not be confirmed' };
  } catch {
    if (request.existing_media) throw ApplicationFailure.nonRetryable('Exact media delivery failed or is unknown; reconcile before retry', 'MEDIA_DELIVERY_FAILED_OR_UNKNOWN');
    if (templateAudio) throw ApplicationFailure.nonRetryable(
      'Exact audio delivery failed or is unknown; reconcile before retry', 'AUDIO_DELIVERY_FAILED_OR_UNKNOWN');
    // Never send via the default account or invalidate a lead after an uncertain response.
    return { success: false, reason: 'Exact selected delivery could not be confirmed' };
  }
}