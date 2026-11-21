import { channelDeliveryOutcome, isAcceptedChannelReceipt, isUnavailableChannelResult } from './helpers/channelDeliveryOutcome';
import { automationSkipMetadata, isSnoozedCustomerSupportResult, snoozedCustomerSupportResult } from '../utils/automationSnooze';
import { proxyActivities, startChild, ParentClosePolicy, ChildWorkflowCancellationType, isCancellation, patched } from '@temporalio/workflow';
import { customerSupportResponseFormat, responseFormatFields } from './helpers/responseFormat';
import { customerSupportMedia } from './helpers/outboundMedia';
import type { Activities } from '../activities';
import type { EmailData } from '../activities/customerSupportActivities';
import { sendChannelMessageFromAgentWorkflow } from './sendChannelMessageFromAgentWorkflow';
import { ACTIVITY_TIMEOUTS, RETRY_POLICIES } from '../config/timeouts';
import { runChannelGuidance } from './helpers/runChannelGuidance';
import { channelGuidanceEnabled } from './helpers/channelGuidanceVersion';
import { isDisabledCustomerSupportResult, disabledCustomerSupportResult } from './helpers/disabledCustomerSupport';

const { sendCustomerSupportMessageActivity } = proxyActivities<Activities>({
  startToCloseTimeout: ACTIVITY_TIMEOUTS.CUSTOMER_SUPPORT,
  retry: RETRY_POLICIES.CUSTOMER_SUPPORT,
});

const { sendCustomerSupportMessageActivity: generateOnce } = proxyActivities<Activities>({
  startToCloseTimeout: ACTIVITY_TIMEOUTS.CUSTOMER_SUPPORT, retry: { maximumAttempts: 1 },
});

export async function channelCustomerSupportMessageWorkflow(
  messageData: any,
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
  const useChannelGuidance = channelGuidanceEnabled();
  const useResponseFormat = patched('customer-support-response-format-v1');
  const useOutboundMedia = patched('customer-support-outbound-media-v1');
  const useConversationFifo = patched('conversation-turn-fifo-v1');
  const pinnedReply = messageData.custom_data?.source === 'zavu_inbound_message' && patched('zavu-saved-channel-reply-v1');
  const strict = pinnedReply && patched('zavu-channel-delivery-outcome-v1');
  const channel = baseParams.origin || 'telegram';
  const isEmail = channel === 'email';
  const recipient = isEmail ? messageData.email : messageData.phone;
  console.log(`Detected ${channel} message - processing via channel delivery`);

  const requireApproval = messageData.require_approval === true;
  const emailDataForCS: EmailData & {
    channel_delivery?: boolean;
    require_approval?: boolean;
    custom_data?: Record<string, unknown>;
    origin_message_id?: string;
  } = {
    summary: messageData.message || 'No message content',
    original_text: messageData.message,
    original_subject: messageData.name || `${channel} Contact`,
    contact_info: {
      name: messageData.name || `${channel} Contact`,
      email: messageData.email || '',
      phone: messageData.phone || '',
      company: '',
    },
    site_id: messageData.site_id,
    user_id: messageData.userId || '',
    lead_notification: 'none',
    analysis_id: `${channel}-${messageData.origin_message_id || Date.now()}`,
    priority: 'medium',
    intent: 'inquiry',
    potential_value: 'medium',
    conversation_id: messageData.conversation_id || undefined,
    visitor_id: messageData.visitor_id || undefined,
    channel_delivery: true,
    ...(useResponseFormat ? responseFormatFields(messageData.response_format) : {}),
    require_approval: requireApproval,
    custom_data: messageData.custom_data,
    origin_message_id: useChannelGuidance
      ? baseParams.origin_message_id || messageData.origin_message_id || messageData.messageId
      : messageData.origin_message_id || baseParams.origin_message_id,
  };

  const requestData = useChannelGuidance
    ? { ...emailDataForCS, channel_guidance_run_plan_ids: await runChannelGuidance(messageData, baseParams) }
    : emailDataForCS;
  let response;
  try { response = await (strict ? generateOnce : sendCustomerSupportMessageActivity)(requestData, baseParams); }
  catch (error) {
    if (!strict || isCancellation(error)) throw error;
    return channelDeliveryOutcome('unknown', 'generation', 'generation_unconfirmed');
  }
  if (!response?.success) {
    if (strict) return channelDeliveryOutcome('failed', 'generation', 'generation_rejected');
    throw new Error(response?.error || 'Customer support call was not successful');
  }
  if (isSnoozedCustomerSupportResult(response.data)) return strict
    ? channelDeliveryOutcome('suppressed', 'generation', 'agent_snoozed', response.data) : snoozedCustomerSupportResult(response.data);
  if (isDisabledCustomerSupportResult(response.data)) return strict
    ? channelDeliveryOutcome('suppressed', 'generation', 'agent_disabled', response.data) : disabledCustomerSupportResult(response.data);
  if (strict && isUnavailableChannelResult(response.data)) return channelDeliveryOutcome('suppressed', 'generation', 'channel_unavailable', response.data);

  let channelWorkflowId: string | undefined;
  let channelMessageSent = false;

  try {
    const assistantMessage = response.data?.messages?.assistant?.content || response.data?.message;
    const assistantMessageId = response.data?.messages?.assistant?.message_id;
    const media = useOutboundMedia ? customerSupportMedia(response.data) : {};
    const subject = isEmail
      ? response.data?.conversation_title || `Re: ${emailDataForCS.original_subject || 'Your inquiry'}`
      : undefined;

    if (requireApproval || (useOutboundMedia && response.data?.require_approval === true)) {
      if (strict) return assistantMessageId && response.data?.conversation_id
        ? channelDeliveryOutcome('draft', 'delivery', 'approval_required', response.data)
        : channelDeliveryOutcome('unknown', 'generation', 'saved_draft_unverified', response.data);
      console.log(`Skipping ${channel} instant send - require_approval=true, waiting for Accept`);
    } else if (!assistantMessage && !media.media_url) {
      console.log(`Skipping ${channel} send - no assistant message content from customer support`);
    } else if (!recipient) {
      console.log(`Skipping ${channel} send - no recipient provided in inbound messageData`);
    } else if (pinnedReply && (!assistantMessageId || !response.data?.conversation_id || !messageData.site_id || !messageData.origin_message_id
      || (response.data.site_id && response.data.site_id !== messageData.site_id))) {
      console.warn('Skipping channel delivery without a matching saved reply identity');
    } else {
      // The saved reply ID is already scoped to the site, connection and provider message.
      channelWorkflowId = pinnedReply ? `send-channel-reply-${assistantMessageId}`
        : `send-${channel}-agent-${messageData.origin_message_id || Date.now()}`;

      const channelHandle = await startChild(sendChannelMessageFromAgentWorkflow, {
        workflowId: channelWorkflowId,
        args: [
          {
            channel,
            ...(strict ? { delivery_receipt_required: true } : {}),
            to: recipient,
            message: assistantMessage || '',
            ...media,
            site_id: response.data?.site_id || emailDataForCS.site_id,
            subject,
            agent_id: pinnedReply ? response.data?.agent_id : baseParams.agentId,
            conversation_id: response.data?.conversation_id,
            lead_id: response.data?.lead_id,
            message_id: assistantMessageId,
            ...(useResponseFormat ? responseFormatFields(customerSupportResponseFormat(response.data, messageData.response_format)) : {}),
            custom_data: pinnedReply ? { ...messageData.custom_data, origin_message_id: messageData.origin_message_id } : messageData.custom_data,
          },
        ],
        parentClosePolicy: useConversationFifo ? ParentClosePolicy.PARENT_CLOSE_POLICY_REQUEST_CANCEL : ParentClosePolicy.PARENT_CLOSE_POLICY_ABANDON,
        ...(useConversationFifo ? { cancellationType: ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED } : {}),
      });

      const channelResult = await channelHandle.result();
      if (strict) {
        if (channelResult.success === true && channelResult.skipped === true && channelResult.delivered === false
          && ['agent_snoozed', 'stale_automatic_reply'].includes(channelResult.reason || '')) {
          return channelDeliveryOutcome('suppressed', 'delivery', channelResult.reason!, response.data, channelWorkflowId);
        }
        return isAcceptedChannelReceipt(channelResult)
          ? channelDeliveryOutcome('accepted', 'delivery', 'provider_accepted', response.data, channelWorkflowId, channelResult)
          : channelDeliveryOutcome(channelResult.status === 'failed' ? 'failed' : 'unknown', 'delivery', 'receipt_unconfirmed', response.data, channelWorkflowId);
      }
      if (channelResult.skipped) return snoozedCustomerSupportResult({ ...response.data, ...automationSkipMetadata(channelResult) });
      channelMessageSent = Boolean(channelResult.success && !channelResult.skipped);
    }
  } catch (channelError) {
    if ((strict || useConversationFifo || useChannelGuidance) && isCancellation(channelError)) throw channelError;
    if (strict) return channelDeliveryOutcome('unknown', 'delivery', 'send_unconfirmed', response.data, channelWorkflowId);
    console.error(`${channel} send workflow failed, but customer support was successful:`, channelError);
  }

  if (strict) return channelDeliveryOutcome('failed', 'delivery', 'saved_destination_unavailable', response.data, channelWorkflowId);
  return {
    success: true,
    data: {
      ...response.data,
      processed: true,
      reason: `${channel} message processed for customer support`,
      channelMessageSent,
      channelWorkflowId,
    },
  };
}
