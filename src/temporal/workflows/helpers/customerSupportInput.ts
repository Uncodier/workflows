import type { EmailData } from '../../activities/customerSupportActivities';
import type { WhatsAppMessageData } from '../../activities/whatsappActivities';

export interface CustomerSupportBaseParams {
  origin?: string;
  agentId?: string;
  origin_message_id?: string;
}

/** Resolve the existing root-level parameter fallbacks without scheduling commands. */
export function customerSupportBaseParams(messageData: any, baseParams?: CustomerSupportBaseParams) {
  let origin = baseParams?.origin;
  let agentId = baseParams?.agentId;
  let originMessageId = baseParams?.origin_message_id;
  if (!origin && messageData && typeof messageData === 'object' && 'origin' in messageData) {
    origin = messageData.origin;
  }
  if (typeof origin === 'string') origin = origin.trim().toLowerCase();
  if (!agentId && messageData && typeof messageData === 'object' && 'agentId' in messageData) {
    agentId = messageData.agentId;
  }
  if (!originMessageId && messageData && typeof messageData === 'object' && 'origin_message_id' in messageData) {
    originMessageId = messageData.origin_message_id;
  }
  return { origin: origin || 'not specified', agentId, origin_message_id: originMessageId };
}

/** Keep the legacy WhatsApp send envelope; stable inbound IDs are patch-only. */
export function whatsappCustomerSupportData(
  whatsappData: WhatsAppMessageData,
  analysisId: string,
  useChannelGuidance: boolean,
  originMessageId?: string,
): EmailData & { origin_message_id?: string } {
  return {
    summary: whatsappData.messageContent || 'No message content',
    original_text: whatsappData.messageContent,
    original_subject: whatsappData.senderName || whatsappData.phoneNumber,
    contact_info: {
      name: whatsappData.senderName || 'WhatsApp Contact',
      email: '',
      phone: whatsappData.phoneNumber,
      company: '',
    },
    site_id: whatsappData.siteId,
    user_id: whatsappData.userId,
    lead_notification: 'none',
    analysis_id: analysisId,
    ...(useChannelGuidance ? { origin_message_id: originMessageId || whatsappData.messageId } : {}),
    priority: 'medium',
    intent: 'inquiry',
    potential_value: 'medium',
    conversation_id: whatsappData.conversationId,
    visitor_id: undefined,
  };
}