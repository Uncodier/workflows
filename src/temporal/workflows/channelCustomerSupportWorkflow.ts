import { proxyActivities, startChild, ParentClosePolicy } from '@temporalio/workflow';
import type { Activities } from '../activities';
import type { EmailData } from '../activities/customerSupportActivities';
import { sendChannelMessageFromAgentWorkflow } from './sendChannelMessageFromAgentWorkflow';
import { ACTIVITY_TIMEOUTS, RETRY_POLICIES } from '../config/timeouts';

const { sendCustomerSupportMessageActivity } = proxyActivities<Activities>({
  startToCloseTimeout: ACTIVITY_TIMEOUTS.CUSTOMER_SUPPORT,
  retry: RETRY_POLICIES.CUSTOMER_SUPPORT,
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
      email: isEmail ? messageData.email || '' : '',
      phone: isEmail ? '' : messageData.phone,
      company: '',
    },
    site_id: messageData.site_id,
    user_id: messageData.userId || '',
    lead_notification: 'none',
    analysis_id: `${channel}-${messageData.origin_message_id || Date.now()}`,
    priority: 'medium',
    intent: 'inquiry',
    potential_value: 'medium',
    conversation_id: undefined,
    visitor_id: undefined,
    channel_delivery: true,
    require_approval: requireApproval,
    custom_data: messageData.custom_data,
    origin_message_id: messageData.origin_message_id || baseParams.origin_message_id,
  };

  const response = await sendCustomerSupportMessageActivity(emailDataForCS, baseParams);

  if (!response || !response.success) {
    console.error(`${channel} customer support message failed:`, response?.error || 'Unknown error');
    throw new Error(response?.error || 'Customer support call was not successful');
  }

  let channelWorkflowId: string | undefined;
  let channelMessageSent = false;

  try {
    const assistantMessage = response.data?.messages?.assistant?.content || response.data?.message;
    const assistantMessageId = response.data?.messages?.assistant?.message_id;
    const subject = isEmail
      ? response.data?.conversation_title || `Re: ${emailDataForCS.original_subject || 'Your inquiry'}`
      : undefined;

    if (requireApproval) {
      console.log(`Skipping ${channel} instant send - require_approval=true, waiting for Accept`);
    } else if (!assistantMessage) {
      console.log(`Skipping ${channel} send - no assistant message content from customer support`);
    } else if (!recipient) {
      console.log(`Skipping ${channel} send - no recipient provided in inbound messageData`);
    } else {
      channelWorkflowId = `send-${channel}-agent-${messageData.origin_message_id || Date.now()}`;

      const channelHandle = await startChild(sendChannelMessageFromAgentWorkflow, {
        workflowId: channelWorkflowId,
        args: [
          {
            channel,
            to: recipient,
            message: assistantMessage,
            site_id: response.data?.site_id || emailDataForCS.site_id,
            subject,
            agent_id: baseParams.agentId,
            conversation_id: response.data?.conversation_id,
            lead_id: response.data?.lead_id,
            message_id: assistantMessageId,
          },
        ],
        parentClosePolicy: ParentClosePolicy.PARENT_CLOSE_POLICY_ABANDON,
      });

      const channelResult = await channelHandle.result();
      channelMessageSent = Boolean(channelResult.success);
    }
  } catch (channelError) {
    console.error(`${channel} send workflow failed, but customer support was successful:`, channelError);
  }

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
