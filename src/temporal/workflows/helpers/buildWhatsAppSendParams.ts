export type CustomerSupportWhatsAppResponse = {
  messages?: {
    assistant?: {
      content?: string;
      message_id?: string;
    };
  };
  conversation_id?: string | null;
  lead_id?: string | null;
};

export type InboundWhatsAppData = {
  phoneNumber: string;
  siteId: string;
  conversationId?: string | null;
};

export type BuiltWhatsAppSendParams = {
  phone_number: string;
  message: string;
  site_id: string;
  from: string;
  agent_id?: string;
  conversation_id?: string;
  lead_id?: string;
  message_id?: string;
  responseWindowEnabled: true;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function optionalUuid(value?: string | null): string | undefined {
  if (!value || typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return UUID_RE.test(trimmed) ? trimmed : undefined;
}

function nonEmpty(value?: string | null): string | undefined {
  if (!value || typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Build sendWhatsappFromAgent params from the customer support API response.
 * Returns null when there is no assistant content (do not send a generic fallback).
 */
export function buildWhatsAppSendParams(params: {
  csResponse: CustomerSupportWhatsAppResponse | null | undefined;
  whatsappData: InboundWhatsAppData;
  agentId?: string;
}): BuiltWhatsAppSendParams | null {
  const { csResponse, whatsappData, agentId } = params;
  const message = nonEmpty(csResponse?.messages?.assistant?.content);
  if (!message) {
    return null;
  }

  if (!whatsappData.phoneNumber || !whatsappData.siteId) {
    return null;
  }

  const result: BuiltWhatsAppSendParams = {
    phone_number: whatsappData.phoneNumber,
    message,
    site_id: whatsappData.siteId,
    from: 'Customer Support',
    responseWindowEnabled: true,
  };

  if (agentId) {
    result.agent_id = agentId;
  }

  const conversationId =
    optionalUuid(csResponse?.conversation_id) || optionalUuid(whatsappData.conversationId);
  if (conversationId) {
    result.conversation_id = conversationId;
  }

  const messageId = optionalUuid(csResponse?.messages?.assistant?.message_id);
  if (messageId) {
    result.message_id = messageId;
  }

  const leadId = optionalUuid(csResponse?.lead_id);
  if (leadId) {
    result.lead_id = leadId;
  }

  return result;
}
