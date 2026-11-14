export interface ConversationTurn {
  workflowId: string;
  runId: string;
}

export const CONVERSATION_TURN_READY = 'conversationTurnReady';
export const CONVERSATION_TURN_ENQUEUE = 'enqueueConversationTurn';

export function conversationQueueId(siteId: string, conversationId: string): string {
  return `conversation-turns-${siteId}-${conversationId}`;
}

/** Never serialize unrelated sites together, or guess a conversation from a lead. */
export function conversationTurnScope(input: any): { siteId: string; conversationId: string } | undefined {
  const data = input?.whatsappData || input;
  const siteId = data?.site_id || data?.siteId;
  const conversationId = data?.conversation_id || data?.conversationId;
  if (typeof siteId !== 'string' || !siteId) return;
  // Zavu creates/resolves the CRM conversation inside the support API, after this gate.
  // Use its trusted inbound routing tuple consistently even after a CRM ID is known.
  const routing = data?.custom_data;
  if (routing?.source === 'zavu_inbound_message' && data.channel_delivery === true &&
      routing.channel === data.origin &&
      [routing.channel, routing.connection_id, routing.zavu_sender_id, routing.zavu_from]
        .every(value => typeof value === 'string' && value.length > 0)) {
    return { siteId, conversationId: JSON.stringify(['zavu', routing.channel,
      routing.connection_id, routing.zavu_sender_id, routing.zavu_from]) };
  }
  if (typeof conversationId !== 'string' || !conversationId) return;
  return { siteId, conversationId };
}