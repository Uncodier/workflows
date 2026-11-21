const present = (v: unknown): v is string => typeof v === 'string' && !!v.trim() && v !== 'unknown';
const accepted = new Set(['queued', 'sending', 'sent', 'delivered', 'read']);
export const isAcceptedChannelReceipt = (r: any) => r?.success === true && present(r.messageId) && accepted.has(r.status)
  && !r.skipped && !r.template_pending && !r.needs_reconciliation;
export const isUnavailableChannelResult = (r: any) => r?.success === true && r.skipped === 'channel_unavailable'
  && present(r.conversation_id) && present(r.messages?.user?.message_id) && !r.messages?.assistant;

export function channelDeliveryOutcome(state: 'accepted'|'suppressed'|'draft'|'failed'|'unknown', stage: 'generation'|'delivery',
  reason: string, data?: any, sendWorkflowId?: string, provider?: {messageId?: string; status?: string}) {
  const proven = ['accepted', 'suppressed', 'draft'].includes(state);
  return { success: proven, data: { ...data, processed: proven, channelMessageSent: state === 'accepted',
    ...(sendWorkflowId ? {channelWorkflowId: sendWorkflowId} : {}),
    deliveryOutcome: { version: 1, state, stage, reason,
      ...(present(data?.messages?.assistant?.message_id) ? {messageId:data.messages.assistant.message_id} : {}),
      ...(present(data?.conversation_id) ? {conversationId:data.conversation_id} : {}),
      ...(sendWorkflowId ? {sendWorkflowId} : {}),
      ...(provider ? {providerMessageId:provider.messageId, status:provider.status} : {}),
    },
  } };
}
