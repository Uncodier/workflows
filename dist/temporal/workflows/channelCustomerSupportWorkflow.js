"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.channelCustomerSupportMessageWorkflow = channelCustomerSupportMessageWorkflow;
const workflow_1 = require("@temporalio/workflow");
const sendChannelMessageFromAgentWorkflow_1 = require("./sendChannelMessageFromAgentWorkflow");
const timeouts_1 = require("../config/timeouts");
const { sendCustomerSupportMessageActivity } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: timeouts_1.ACTIVITY_TIMEOUTS.CUSTOMER_SUPPORT,
    retry: timeouts_1.RETRY_POLICIES.CUSTOMER_SUPPORT,
});
async function channelCustomerSupportMessageWorkflow(messageData, baseParams) {
    const channel = baseParams.origin || 'telegram';
    const isEmail = channel === 'email';
    const recipient = isEmail ? messageData.email : messageData.phone;
    console.log(`Detected ${channel} message - processing via channel delivery`);
    const requireApproval = messageData.require_approval === true;
    const emailDataForCS = {
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
    let channelWorkflowId;
    let channelMessageSent = false;
    try {
        const assistantMessage = response.data?.messages?.assistant?.content || response.data?.message;
        const assistantMessageId = response.data?.messages?.assistant?.message_id;
        const subject = isEmail
            ? response.data?.conversation_title || `Re: ${emailDataForCS.original_subject || 'Your inquiry'}`
            : undefined;
        if (requireApproval) {
            console.log(`Skipping ${channel} instant send - require_approval=true, waiting for Accept`);
        }
        else if (!assistantMessage) {
            console.log(`Skipping ${channel} send - no assistant message content from customer support`);
        }
        else if (!recipient) {
            console.log(`Skipping ${channel} send - no recipient provided in inbound messageData`);
        }
        else {
            channelWorkflowId = `send-${channel}-agent-${messageData.origin_message_id || Date.now()}`;
            const channelHandle = await (0, workflow_1.startChild)(sendChannelMessageFromAgentWorkflow_1.sendChannelMessageFromAgentWorkflow, {
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
                parentClosePolicy: workflow_1.ParentClosePolicy.PARENT_CLOSE_POLICY_ABANDON,
            });
            const channelResult = await channelHandle.result();
            channelMessageSent = Boolean(channelResult.success);
        }
    }
    catch (channelError) {
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
