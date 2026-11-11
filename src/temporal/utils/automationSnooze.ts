export interface AutomationSkipMetadata {
  skipped?: boolean;
  reason?: string;
  automation_paused?: boolean;
  automation_paused_until?: string | null;
  conversation_id?: string;
  delivered?: boolean;
}

export function automationSkipMetadata(data: any): AutomationSkipMetadata {
  return data?.skipped === true ? { skipped: true, reason: data.reason,
    automation_paused: data.automation_paused, automation_paused_until: data.automation_paused_until,
    conversation_id: data.conversation_id, delivered: false } : {};
}

/** The API saved the inbound message but intentionally generated no assistant. */
export function isSnoozedCustomerSupportResult(data: any): boolean {
  return data?.automation_paused === true && data?.skipped === true &&
    data?.reason === 'agent_snoozed' &&
    typeof data.conversation_id === 'string' && data.conversation_id.length > 0 &&
    (data.automation_paused_until === null || (typeof data.automation_paused_until === 'string' && Number.isFinite(Date.parse(data.automation_paused_until)))) &&
    data.messages?.user != null;
}

export function snoozedCustomerSupportResult(data: any) {
  return { success: true, data: { ...data, processed: true,
    emailSent: false, whatsappSent: false, channelMessageSent: false } };
}

/** Pure, offline-testable policy. Role and timestamps must come from persisted rows. */
export function automationSkipReason(conversation: {
  automation_paused_until?: string | null;
  last_human_reply_at?: string | null;
}, message: { role: string; created_at?: string; custom_data?: Record<string, any> | null }, now: number): string | undefined {
  if (message.role !== 'assistant') return undefined;
  if (message.custom_data?.automation_skipped === true) return message.custom_data.automation_skip_reason || 'agent_snoozed';
  const humanAt = Date.parse(conversation.last_human_reply_at || '');
  const generatedAt = Date.parse(message.custom_data?.automation_started_at || message.created_at || '');
  if (Number.isFinite(humanAt) && Number.isFinite(generatedAt) && generatedAt <= humanAt) {
    return 'stale_automatic_reply';
  }
  if (Date.parse(conversation.automation_paused_until || '') > now) return 'agent_snoozed';
  return undefined;
}