import { ApplicationFailure } from '@temporalio/common';
import { apiService } from '../services/apiService';
import type { EmailData } from './customerSupportActivities';

export interface CustomerSupportMessageRequest {
  message: string;
  systemContext?: string;
  visitor_id?: string;
  lead_id?: string;
  name?: string;
  email?: string;
  phone?: string;
  userId?: string;
  conversationId?: string;
  agentId?: string;
  site_id?: string;
  lead_notification?: string;
  origin?: string;
  origin_message_id?: string;
  channel_delivery?: boolean;
  require_approval?: boolean;
  custom_data?: Record<string, unknown>;
}

type CustomerSupportApiData = {
  messages?: {
    assistant?: {
      content?: unknown;
    };
  };
};

const INVALID_RESPONSE_MARKERS = new Set(['no response generated']);
const RETRYABLE_CLIENT_STATUSES = new Set([408, 409, 425, 429]);

function normalizedContent(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function getCustomerSupportResponseContent(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined;

  const responseData = data as CustomerSupportApiData;
  return normalizedContent(responseData.messages?.assistant?.content);
}

export function isUsableCustomerSupportResponse(data: unknown): boolean {
  const content = getCustomerSupportResponseContent(data);
  if (!content) return false;

  const normalized = content.toLowerCase().replace(/[.!]+$/g, '').trim();
  return !INVALID_RESPONSE_MARKERS.has(normalized);
}

function customerSupportApiFailure(error: {
  code?: string;
  message?: string;
  status?: number;
} | undefined): ApplicationFailure {
  const message = error?.message || 'Failed to send customer support message';
  const status = error?.status;
  const nonRetryable =
    typeof status === 'number' &&
    status >= 400 &&
    status < 500 &&
    !RETRYABLE_CLIENT_STATUSES.has(status);

  return ApplicationFailure.create({
    message,
    type: nonRetryable ? 'CUSTOMER_SUPPORT_REQUEST_REJECTED' : 'CUSTOMER_SUPPORT_API_FAILURE',
    nonRetryable,
    details: [{ code: error?.code, status }],
  });
}

/**
 * Sends an inbound message to the customer-support API.
 *
 * Failures are intentionally thrown so Temporal can apply the activity retry policy.
 */
export async function sendCustomerSupportMessageActivity(
  emailData: EmailData | any,
  baseParams: {
    agentId?: string;
    origin?: string;
    origin_message_id?: string;
  }
): Promise<{
  success: boolean;
  data?: any;
  error?: string;
}> {
  console.log('📞 Sending customer support message...');

  let message: string;
  let siteId: string;
  let userId: string;
  let conversationId: string | undefined;
  let visitorId: string | undefined;
  let leadId: string | undefined;
  let contactName: string | undefined;
  let contactEmail: string | undefined;
  let contactPhone: string | undefined;
  let originMessageId: string | undefined;

  if (emailData.contact_info && typeof emailData.contact_info === 'object') {
    console.log('📧 Processing EmailData format');
    message = emailData.original_text || emailData.summary || 'Customer support interaction from analysis';
    siteId = emailData.site_id;
    userId = emailData.user_id;
    conversationId = emailData.conversation_id;
    visitorId = emailData.visitor_id;
    leadId = emailData.lead_id;
    originMessageId = emailData.origin_message_id;
    contactName = emailData.contact_info.name;
    contactEmail = emailData.contact_info.email;
    contactPhone = emailData.contact_info.phone;
  } else {
    console.log('💬 Processing website chat format');
    message = emailData.message || 'Website chat interaction';
    siteId = emailData.site_id;
    userId = emailData.user_id || '';
    conversationId = emailData.conversationId;
    visitorId = emailData.visitor_id;
    leadId = emailData.lead_id;
    originMessageId = emailData.origin_message_id;
    contactName = emailData.name;
    contactEmail = emailData.email;
    contactPhone = emailData.phone;
  }

  const now = new Date();
  const timeContext = `\n\n[System Context for Agent: The current date and time is ${now.toISOString()} (UTC). Local time hint: ${now.toLocaleString('es-MX', { timeZone: 'America/Mexico_City', weekday: 'long' })}, ${now.toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })} (America/Mexico_City). When scheduling or referencing days of the week, you MUST calculate relative to this exact date to avoid booking past dates or wrong weeks.]`;

  const messageRequest: CustomerSupportMessageRequest = {
    message,
    systemContext: timeContext,
    site_id: siteId,
    userId,
    lead_notification: 'none',
    origin: baseParams.origin,
  };

  if (baseParams.agentId) messageRequest.agentId = baseParams.agentId;
  if (conversationId) messageRequest.conversationId = conversationId;
  if (visitorId) messageRequest.visitor_id = visitorId;
  if (contactName) messageRequest.name = contactName;
  if (contactEmail) messageRequest.email = contactEmail;
  if (contactPhone) messageRequest.phone = contactPhone;
  if (leadId) messageRequest.lead_id = leadId;

  originMessageId ||= baseParams.origin_message_id;
  if (originMessageId) messageRequest.origin_message_id = originMessageId;
  if (emailData.channel_delivery === true) messageRequest.channel_delivery = true;
  if (emailData.require_approval === true) messageRequest.require_approval = true;
  if (emailData.custom_data && typeof emailData.custom_data === 'object') {
    messageRequest.custom_data = emailData.custom_data;
  }

  console.log('📤 Sending customer support message with payload:', {
    message: `${messageRequest.message.substring(0, 50)}...`,
    hasName: Boolean(messageRequest.name),
    hasEmail: Boolean(messageRequest.email),
    hasPhone: Boolean(messageRequest.phone),
    site_id: messageRequest.site_id,
    userId: messageRequest.userId,
    agentId: messageRequest.agentId || 'field_omitted',
    lead_id: messageRequest.lead_id,
    conversationId: messageRequest.conversationId,
    visitor_id: messageRequest.visitor_id,
    lead_notification: messageRequest.lead_notification,
    origin: messageRequest.origin,
    origin_message_id: messageRequest.origin_message_id,
  });

  const startTime = Date.now();
  console.log('⏱️ Starting customer support API call...');

  try {
    const response = await apiService.post('/api/agents/customerSupport/message', messageRequest);
    const duration = Date.now() - startTime;
    console.log(`⏱️ API call completed in ${duration}ms`);

    if (!response.success) {
      console.error('❌ Customer support API call failed:', response.error);
      throw customerSupportApiFailure(response.error);
    }

    if (!isUsableCustomerSupportResponse(response.data)) {
      console.error('❌ Customer support API returned no usable assistant response');
      throw ApplicationFailure.create({
        message: 'Customer support API returned no usable assistant response',
        type: 'CUSTOMER_SUPPORT_EMPTY_RESPONSE',
        nonRetryable: false,
      });
    }

    console.log('✅ Customer support message sent successfully');
    return {
      success: true,
      data: response.data,
    };
  } catch (error) {
    console.error('❌ Failed to send customer support message:', error);
    if (error instanceof ApplicationFailure) throw error;

    throw ApplicationFailure.create({
      message: error instanceof Error ? error.message : String(error),
      type: 'CUSTOMER_SUPPORT_UNEXPECTED_FAILURE',
      nonRetryable: false,
    });
  }
}
