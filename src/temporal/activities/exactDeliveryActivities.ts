import { apiService } from '../services/apiService';

export interface ExactQueuedDeliveryResult {
  success: boolean;
  messageId?: string;
  recipient?: string;
  reason?: string;
}

/** API reads current message routing, recipient, content and voice context at every retry. */
export async function sendExactQueuedMessageActivity(request: {
  site_id: string; message_id: string; conversation_id: string; channel: string;
}): Promise<ExactQueuedDeliveryResult> {
  try {
    const response = await apiService.post<ExactQueuedDeliveryResult>('/api/agents/tools/sendExactDelivery', request);
    if (response.success && response.data?.success) return response.data;
    return { success: false, reason: 'Exact selected delivery could not be confirmed' };
  } catch {
    // Never send via the default account or invalidate a lead after an uncertain response.
    return { success: false, reason: 'Exact selected delivery could not be confirmed' };
  }
}