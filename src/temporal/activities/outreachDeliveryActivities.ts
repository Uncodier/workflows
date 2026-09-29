import { apiService } from '../services/apiService';
import { resolveOutreachActivity } from '../utils/outreachActivity';

export interface OutreachDeliveryResult {
  success: boolean;
  deferred?: boolean;
  reason?: string;
  retryAt?: string;
  messageId?: string;
  alreadySent?: boolean;
  recipient?: string;
}

/** The API owns account selection, the shared daily budget, and send idempotency. */
export async function sendOutreachMessageActivity(request: {
  site_id: string;
  message_id: string;
}): Promise<OutreachDeliveryResult> {
  try {
    const response = await apiService.post<OutreachDeliveryResult>(
      '/api/agents/tools/sendOutreachMessage', request
    );
    if (response.success && response.data) return response.data;
    return {
      success: false,
      deferred: true,
      reason: response.error?.message || 'Outreach delivery could not be confirmed',
    };
  } catch (error) {
    // Never invalidate a lead or switch accounts after an ambiguous provider response.
    return { success: false, deferred: true, reason: error instanceof Error ? error.message : String(error) };
  }
}

export async function deferOutreachMessageActivity(request: {
  site_id: string;
  conversation_id: string;
  message_id: string;
  reason: string;
  retryAt?: string;
}): Promise<void> {
  const { supabaseServiceRole } = await import('../../lib/supabase/client');
  const { data: conversation, error: conversationError } = await supabaseServiceRole
    .from('conversations').select('id').eq('id', request.conversation_id)
    .eq('site_id', request.site_id).maybeSingle();
  if (conversationError || !conversation) throw new Error('Outreach conversation not found for site');

  const { data: message, error } = await supabaseServiceRole
    .from('messages').select('custom_data').eq('id', request.message_id)
    .eq('conversation_id', request.conversation_id).eq('custom_data->>status', 'sending').maybeSingle();
  if (error) throw new Error(`Could not read deferred outreach message: ${error.message}`);
  if (!message) return; // Already sent, revoked, or deferred by another run.

  const now = Date.now();
  const retryAt = request.retryAt ? Date.parse(request.retryAt) : NaN;
  const { error: updateError } = await supabaseServiceRole.from('messages').update({
    custom_data: {
      ...message.custom_data,
      status: 'accepted',
      outreach_activity: message.custom_data?.outreach_activity ?? resolveOutreachActivity(message.custom_data),
      outreach_deferred_reason: request.reason,
      outreach_deferred_until: new Date(Number.isFinite(retryAt) && retryAt > now ? retryAt : now + 60 * 60 * 1000).toISOString(),
    },
    updated_at: new Date(now).toISOString(),
  }).eq('id', request.message_id).eq('conversation_id', request.conversation_id)
    .eq('custom_data->>status', 'sending');
  if (updateError) throw new Error(`Could not defer outreach message: ${updateError.message}`);
}