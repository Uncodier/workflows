import { automationSkipReason, type AutomationSkipMetadata } from '../utils/automationSnooze';

export interface AutomationDispatchRequest {
  site_id: string;
  conversation_id?: string;
  message_id?: string;
}

/** Read immediately before dispatch, including every activity retry/template poll.
 * Never wait out a snooze: saved assistant replies are terminally suppressed.
 * API must repeat this check at the provider boundary to close the HTTP race.
 */
export async function checkConversationAutomationActivity(request: AutomationDispatchRequest): Promise<
  { success: true } & AutomationSkipMetadata
> {
  // Non-conversation sends (e.g. billing/newsletters) have no conversation policy.
  if (!request.message_id && !request.conversation_id) return { success: true };
  const { supabaseServiceRole: db } = await import('../../lib/supabase/client');
  let message: any;
  if (request.message_id) {
    const { data, error } = await db.from('messages')
      .select('id, conversation_id, role, created_at, updated_at, custom_data').eq('id', request.message_id).maybeSingle();
    if (error || !data) throw new Error('Automation guard could not read saved message');
    message = data;
    if (request.conversation_id && message.conversation_id !== request.conversation_id) {
      throw new Error('Automation guard message/conversation mismatch');
    }
  }
  const conversationId = message?.conversation_id || request.conversation_id;
  const { data: conversation, error } = await db.from('conversations')
    .select('id, automation_paused_until, last_human_reply_at')
    .eq('id', conversationId).eq('site_id', request.site_id).maybeSingle();
  if (error || !conversation) throw new Error('Automation guard could not read conversation for site');
  // No caller-provided role can bypass policy. Legacy FromAgent calls without a
  // saved message are automatic, but cannot be checked for generation staleness.
  const reason = automationSkipReason(conversation, message || { role: 'assistant' }, Date.now());
  if (!reason) return { success: true };

  if (message?.role === 'assistant' && message.custom_data?.automation_skipped !== true &&
      !['sent', 'delivered', 'read'].includes(message.custom_data?.status)) {
    // CAS avoids overwriting concurrent approval/provider metadata. A conflict
    // retries the guard rather than dispatching with an obsolete snapshot.
    let update = db.from('messages').update({ custom_data: {
      ...message.custom_data, status: 'skipped', automation_skipped: true,
      automation_skip_reason: reason, automation_skipped_at: new Date().toISOString(),
    }, updated_at: new Date().toISOString() }).eq('id', message.id).eq('conversation_id', conversationId).eq('role', 'assistant');
    if (message.updated_at) update = update.eq('updated_at', message.updated_at);
    const { data, error: updateError } = await update.select('id');
    if (updateError || !data?.length) throw new Error('Automation guard could not persist terminal suppression');
  }
  return { success: true, skipped: true, delivered: false, reason, automation_paused: reason === 'agent_snoozed',
    automation_paused_until: conversation.automation_paused_until, conversation_id: conversationId };
}