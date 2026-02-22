import { proxyActivities, startChild, ParentClosePolicy } from '@temporalio/workflow';
import type { Activities } from '../activities';
import { sendWhatsappFromAgent } from './sendWhatsappFromAgentWorkflow';

const {
  getApprovedMessagesActivity,
  markMessageAsSendingActivity,
  resetStuckSendingMessagesActivity,
  sendEmailFromAgentActivity,
  updateMessageStatusToSentActivity,
  updateMessageTimestampActivity,
  updateConversationStatusAfterFollowUpActivity,
  updateTaskStatusToCompletedActivity,
  cleanupFailedFollowUpActivity
} = proxyActivities<Activities>({
  startToCloseTimeout: '5 minutes',
  retry: {
    maximumAttempts: 3,
  },
});

export async function sendApprovedMessagesWorkflow(): Promise<any> {
  console.log('🚀 Starting sendApprovedMessagesWorkflow...');

  const resetResult = await resetStuckSendingMessagesActivity();
  if (resetResult.resetCount > 0) {
    console.log(`🔄 Recovered ${resetResult.resetCount} message(s) stuck in sending (will be retried).`);
  }
  if (resetResult.error) {
    console.warn('⚠️ resetStuckSendingMessages failed (non-fatal):', resetResult.error);
  }

  const messages = await getApprovedMessagesActivity();
  
  if (!messages || messages.length === 0) {
    console.log('✅ No approved messages to send.');
    return { processed: 0, success: 0, failed: 0 };
  }

  console.log(`Processing ${messages.length} approved messages in parallel...`);

  async function processOneMessage(msg: (typeof messages)[number]): Promise<boolean> {
    let sent = false;
    const channel = msg.custom_data?.channel || (msg.custom_data?.type === 'email' ? 'email' : 'whatsapp');
    const messageId = msg.message_id;
    let sentMessageId: string | undefined;

    try {
      if (channel === 'email') {
        if (!msg.lead_email) {
          throw new Error('No email address for lead');
        }
        console.log(`📧 Sending email to ${msg.lead_email}...`);
        const emailResult = await sendEmailFromAgentActivity({
          email: msg.lead_email,
          subject: msg.custom_data?.title || msg.custom_data?.subject || 'Follow-up',
          message: msg.content,
          site_id: msg.site_id,
          agent_id: msg.custom_data?.userId,
          lead_id: msg.lead_id,
          from: msg.custom_data?.siteName || 'Sales Agent',
        });
        if (emailResult.success) {
          sent = true;
          sentMessageId = emailResult.messageId;
          console.log(`✅ Email sent successfully.`);
        } else {
          throw new Error(`Email sending failed: ${emailResult.messageId}`);
        }
      } else {
        if (!msg.lead_phone) {
          throw new Error('No phone number for lead');
        }
        console.log(`📱 Dispatching WhatsApp to ${msg.lead_phone} (child runs in background)...`);
        const markResult = await markMessageAsSendingActivity({
          message_id: msg.message_id,
          conversation_id: msg.conversation_id,
          site_id: msg.site_id,
        });
        if (!markResult.success) {
          console.error(`❌ Cannot dispatch WhatsApp: mark as sending failed for message ${msg.message_id}: ${markResult.error ?? 'unknown'}`);
          return false; // Message stays in 'accepted'; next hourly run will retry without duplicate send
        }
        let cleanPhone = msg.lead_phone.replace(/[^\d+]/g, '');
        if (cleanPhone.startsWith('+')) {
          cleanPhone = '+' + cleanPhone.slice(1).replace(/\+/g, '');
        } else {
          cleanPhone = cleanPhone.replace(/\+/g, '');
        }
        const whatsappWorkflowId = `send-whatsapp-approved-${msg.message_id}-${Date.now()}`;
        await startChild(sendWhatsappFromAgent, {
          workflowId: whatsappWorkflowId,
          args: [{
            phone_number: cleanPhone,
            message: msg.content,
            site_id: msg.site_id,
            from: msg.custom_data?.siteName || 'Sales Agent',
            agent_id: msg.custom_data?.userId,
            lead_id: msg.lead_id,
            conversation_id: msg.conversation_id,
            message_id: msg.message_id,
            responseWindowEnabled: false,
            fromApprovedWorkflow: true,
            approvedWorkflowCustomData: msg.custom_data ?? undefined,
          }],
          parentClosePolicy: ParentClosePolicy.PARENT_CLOSE_POLICY_ABANDON,
        });
        // Do not await child result: each hourly run processes its batch and exits; child updates DB on success/failure
        sent = true;
        console.log(`✅ WhatsApp child started (workflowId: ${whatsappWorkflowId}).`);
        return true;
      }

      if (sent && channel === 'email') {
        await updateMessageStatusToSentActivity({
          message_id: messageId,
          conversation_id: msg.conversation_id,
          lead_id: msg.lead_id,
          site_id: msg.site_id,
          delivery_channel: channel,
          delivery_success: true,
          delivery_details: {
            recipient: channel === 'email' ? msg.lead_email : msg.lead_phone,
            message_id: sentMessageId,
            timestamp: new Date().toISOString()
          }
        });
        await updateMessageTimestampActivity({
          message_id: messageId,
          conversation_id: msg.conversation_id,
          lead_id: msg.lead_id,
          site_id: msg.site_id,
          delivery_timestamp: new Date().toISOString(),
          delivery_channel: channel
        });
        await updateConversationStatusAfterFollowUpActivity({
          conversation_id: msg.conversation_id,
          lead_id: msg.lead_id,
          site_id: msg.site_id,
          response_data: msg.custom_data,
          additional_data: {
            message_ids: [messageId],
            conversation_ids: [msg.conversation_id]
          }
        });
        await updateTaskStatusToCompletedActivity({
          lead_id: msg.lead_id,
          site_id: msg.site_id,
          stage: 'awareness',
          status: 'completed',
          notes: `Task completed after successful ${channel} message delivery via sendApprovedMessagesWorkflow`
        });
        return true;
      }
      return false;
    } catch (error) {
      console.error(`❌ Failed to send message ${msg.message_id}:`, error);
      if (!sent) {
        const failureReason = error instanceof Error ? error.message : String(error);
        try {
          const recipient = channel === 'email' ? msg.lead_email : msg.lead_phone;
          const delivery_details: Record<string, unknown> = {
            status: 'failed',
            error: failureReason,
            timestamp: new Date().toISOString(),
          };
          if (recipient != null && recipient !== '') {
            delivery_details.recipient = recipient;
          }
          if (channel === 'email') {
            const subject = msg.custom_data?.title || msg.custom_data?.subject || 'Follow-up';
            if (subject) delivery_details.subject = subject;
          } else if (msg.lead_phone != null && msg.lead_phone !== '') {
            delivery_details.phone_number = msg.lead_phone;
          }
          await updateMessageStatusToSentActivity({
            message_id: messageId,
            conversation_id: msg.conversation_id,
            lead_id: msg.lead_id,
            site_id: msg.site_id,
            delivery_channel: channel,
            delivery_success: false,
            delivery_details,
          });
        } catch (updateErr) {
          console.error(`⚠️ Failed to update message status to failed:`, updateErr);
        }
        try {
          const cleanupPayload: Record<string, unknown> = {
            lead_id: msg.lead_id,
            site_id: msg.site_id,
            conversation_id: msg.conversation_id,
            message_id: messageId,
            failure_reason: failureReason,
            delivery_channel: channel,
          };
          if (channel === 'email' && msg.lead_email != null && msg.lead_email !== '') {
            Object.assign(cleanupPayload, { email: msg.lead_email });
          } else if (channel !== 'email' && msg.lead_phone != null && msg.lead_phone !== '') {
            Object.assign(cleanupPayload, { phone_number: msg.lead_phone });
          }
          const cleanupResult = await cleanupFailedFollowUpActivity(cleanupPayload as Parameters<typeof cleanupFailedFollowUpActivity>[0]);
          if (cleanupResult.success) {
            console.log(`🧹 Cleanup completed for failed message ${messageId}:`, cleanupResult.cleanup_summary ?? { conversation_deleted: cleanupResult.conversation_deleted, message_deleted: cleanupResult.message_deleted });
          } else {
            console.warn(`⚠️ Cleanup failed for message ${messageId}:`, cleanupResult.error);
          }
        } catch (cleanupErr) {
          console.error(`❌ Cleanup activity failed for message ${messageId}:`, cleanupErr);
        }
      } else {
        console.error(`⚠️ Message ${messageId} was sent successfully but a post-send update failed; delivery status not changed.`, error);
        return true; // Count as success: message was delivered; only post-send updates failed
      }
      return false;
    }
  }

  const results = await Promise.allSettled(messages.map((msg) => {
    console.log(`📤 Processing message ${msg.message_id} (Lead: ${msg.lead_id})...`);
    return processOneMessage(msg);
  }));

  const successCount = results.filter((r) => r.status === 'fulfilled' && r.value === true).length;
  const failedCount = results.filter((r) => r.status === 'rejected' || (r.status === 'fulfilled' && r.value === false)).length;

  return { processed: messages.length, success: successCount, failed: failedCount };
}
