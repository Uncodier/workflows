import { proxyActivities, startChild, ParentClosePolicy } from '@temporalio/workflow';
import type { Activities } from '../activities';
import { sendWhatsappFromAgent } from './sendWhatsappFromAgentWorkflow';

const {
  getApprovedMessagesActivity,
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
  
  const messages = await getApprovedMessagesActivity();
  
  if (!messages || messages.length === 0) {
    console.log('✅ No approved messages to send.');
    return { processed: 0, success: 0, failed: 0 };
  }

  console.log(`Processing ${messages.length} approved messages...`);

  let successCount = 0;
  let failedCount = 0;

  for (const msg of messages) {
    console.log(`📤 Processing message ${msg.message_id} (Lead: ${msg.lead_id})...`);
    
    let sent = false;
    let channel = msg.custom_data?.channel || (msg.custom_data?.type === 'email' ? 'email' : 'whatsapp');
    let messageId = msg.message_id;
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
            // We might not have agent_id easily if not in custom_data. 
            // Maybe fallback to site owner? But activity usually handles missing agent_id or site_id is enough?
            // checking leadFollowUpWorkflow: agent_id: options.userId || site.user_id
            // We'll use custom_data.userId if available.
            agent_id: msg.custom_data?.userId,
            lead_id: msg.lead_id,
            from: msg.custom_data?.siteName || 'Sales Agent', // Fallback
        });

        if (emailResult.success) {
            sent = true;
            sentMessageId = emailResult.messageId;
            console.log(`✅ Email sent successfully.`);
        } else {
            throw new Error(`Email sending failed: ${emailResult.messageId}`);
        }

      } else {
        // WhatsApp
        if (!msg.lead_phone) {
            throw new Error('No phone number for lead');
        }

        console.log(`📱 Sending WhatsApp to ${msg.lead_phone}...`);
        
        // Format phone
        let cleanPhone = msg.lead_phone.replace(/[^\d+]/g, '');
        if (cleanPhone.startsWith('+')) {
            cleanPhone = '+' + cleanPhone.slice(1).replace(/\+/g, '');
        } else {
            cleanPhone = cleanPhone.replace(/\+/g, '');
        }

        const whatsappWorkflowId = `send-whatsapp-approved-${msg.message_id}-${Date.now()}`;
        const whatsappHandle = await startChild(sendWhatsappFromAgent, {
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
            }],
            parentClosePolicy: ParentClosePolicy.PARENT_CLOSE_POLICY_TERMINATE,
        });

        const whatsappResult = await whatsappHandle.result();
        sent = true;
        sentMessageId = whatsappResult.messageId;
        console.log(`✅ WhatsApp sent successfully.`);
      }

      if (sent) {
        // Update Status
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

        // Update Timestamp
        await updateMessageTimestampActivity({
            message_id: messageId,
            conversation_id: msg.conversation_id,
            lead_id: msg.lead_id,
            site_id: msg.site_id,
            delivery_timestamp: new Date().toISOString(),
            delivery_channel: channel
        });

        // Activate Conversation
        await updateConversationStatusAfterFollowUpActivity({
            conversation_id: msg.conversation_id,
            lead_id: msg.lead_id,
            site_id: msg.site_id,
            response_data: msg.custom_data, // Passing custom_data as response data
            additional_data: {
                message_ids: [messageId],
                conversation_ids: [msg.conversation_id]
            }
        });

        // Complete Task
        await updateTaskStatusToCompletedActivity({
            lead_id: msg.lead_id,
            site_id: msg.site_id,
            stage: 'awareness',
            status: 'completed',
            notes: `Task completed after successful ${channel} message delivery via sendApprovedMessagesWorkflow`
        });

        successCount++;

      }
    } catch (error) {
        console.error(`❌ Failed to send message ${msg.message_id}:`, error);
        failedCount++;
        
        // Cleanup? or just leave it for retry?
        // Maybe update status to failed?
        // Or if it's 'accepted' and failed, we might want to flag it.
        // For now, logging error.
    }
  }

  return { processed: messages.length, success: successCount, failed: failedCount };
}
