export type MessageDeliveryStatusRequest = {
  message_id?: string;
  conversation_id?: string;
  lead_id: string;
  site_id: string;
  delivery_channel: 'email' | 'whatsapp';
  delivery_success: boolean;
  delivery_details?: {
    error?: unknown;
    error_message?: unknown;
    [key: string]: unknown;
  };
  sequence_stage?: string;
};

export function shouldSkipDeliveryStatusUpdate(
  currentCustomData: Record<string, any>,
  deliverySuccess: boolean
): boolean {
  const currentStatus = currentCustomData.status;
  const alreadyProcessed = Boolean(currentCustomData.follow_up?.processed);

  if (alreadyProcessed && currentStatus === 'sent') {
    return true;
  }

  if (currentStatus === 'sent' && !deliverySuccess) {
    return true;
  }

  return false;
}

export type DeliveryMessageCandidate = {
  id: string;
  role?: string | null;
  custom_data?: Record<string, any> | null;
};

function isUnsentAssistantMessage(message: DeliveryMessageCandidate): boolean {
  if (message.role !== 'assistant') {
    return false;
  }

  const customData = message.custom_data || {};
  if (customData.status === 'sent') {
    return false;
  }
  if (customData.delivery?.success === true) {
    return false;
  }

  return true;
}

/**
 * Fallback when message_id is missing: only update if there is exactly one
 * unsent assistant message. Never guess among several (parallel turns).
 */
export function selectUnsentAssistantForDeliveryUpdate(
  messages: DeliveryMessageCandidate[]
): string | undefined {
  const candidates = messages.filter(isUnsentAssistantMessage);
  if (candidates.length !== 1) {
    return undefined;
  }
  return candidates[0].id;
}

function deliveryErrorMessage(details?: MessageDeliveryStatusRequest['delivery_details']): string | undefined {
  if (!details) return undefined;
  const raw = details.error ?? details.error_message;
  if (raw === undefined || raw === null) return undefined;
  return typeof raw === 'string' ? raw : String(raw);
}

export function buildDeliveryStatusCustomData(
  currentCustomData: Record<string, any>,
  request: Pick<
    MessageDeliveryStatusRequest,
    'delivery_channel' | 'delivery_success' | 'delivery_details' | 'sequence_stage' | 'lead_id' | 'site_id'
  >
): Record<string, any> {
  const targetStatus = request.delivery_success ? 'sent' : 'failed';
  const updatedCustomData: Record<string, any> = {
    ...currentCustomData,
    status: targetStatus,
    command_status: request.delivery_success ? 'success' : 'failed',
    sequence_stage: request.sequence_stage || currentCustomData.sequence_stage,
    delivery: {
      channel: request.delivery_channel,
      success: request.delivery_success,
      timestamp: new Date().toISOString(),
      details: request.delivery_details || {}
    },
    follow_up: {
      processed: true,
      processed_at: new Date().toISOString(),
      lead_id: request.lead_id,
      site_id: request.site_id
    }
  };

  if (request.delivery_success) {
    delete updatedCustomData.error_message;
  } else {
    const errorMessage = deliveryErrorMessage(request.delivery_details);
    if (errorMessage) {
      updatedCustomData.error_message = errorMessage;
    }
  }

  return updatedCustomData;
}
