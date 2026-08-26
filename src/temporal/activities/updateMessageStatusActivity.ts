import { getSupabaseService } from '../services/supabaseService';
import {
  buildDeliveryStatusCustomData,
  shouldSkipDeliveryStatusUpdate,
  type MessageDeliveryStatusRequest,
} from './updateMessageStatusMapping';

export type { MessageDeliveryStatusRequest };

/**
 * Update message status after follow-up delivery.
 * Chat UI reads custom_data.command_status (failed/success) in addition to status.
 */
export async function updateMessageStatusToSentActivity(request: MessageDeliveryStatusRequest): Promise<{
  success: boolean;
  error?: string;
  updated_message_id?: string;
}> {
  console.log(`📝 Updating message status to 'sent' after follow-up delivery...`);
  console.log(`📋 Message ID: ${request.message_id}, Channel: ${request.delivery_channel}, Success: ${request.delivery_success}`);

  try {
    const supabaseService = getSupabaseService();

    console.log('🔍 Checking database connection...');
    const isConnected = await supabaseService.getConnectionStatus();

    if (!isConnected) {
      console.log('⚠️  Database not available, cannot update message status');
      return {
        success: false,
        error: 'Database not available'
      };
    }

    console.log('✅ Database connection confirmed, updating message status...');

    const { supabaseServiceRole } = await import('../../lib/supabase/client');

    let messageId = request.message_id;

    if (!messageId && request.conversation_id) {
      console.log(`🔍 No message ID provided, searching for recent message in conversation ${request.conversation_id}...`);

      const { data: recentMessage, error: findError } = await supabaseServiceRole
        .from('messages')
        .select('id, custom_data')
        .eq('conversation_id', request.conversation_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (findError && findError.code !== 'PGRST116') {
        console.error(`❌ Error finding recent message:`, findError);
        return {
          success: false,
          error: `Failed to find recent message: ${findError.message}`
        };
      }

      if (recentMessage) {
        messageId = recentMessage.id;
        console.log(`✅ Found recent message in conversation: ${messageId}`);
      }
    }

    if (!messageId) {
      console.log(`🔍 No message ID from conversation, searching for pending messages for lead ${request.lead_id}...`);

      const { data: pendingMessages, error: findPendingError } = await supabaseServiceRole
        .from('messages')
        .select('id, conversation_id, custom_data, created_at')
        .eq('site_id', request.site_id)
        .eq('role', 'assistant')
        .order('created_at', { ascending: false })
        .limit(10);

      if (findPendingError) {
        console.error(`❌ Error finding pending messages:`, findPendingError);
        return {
          success: false,
          error: `Failed to find pending messages: ${findPendingError.message}`
        };
      }

      if (pendingMessages && pendingMessages.length > 0) {
        for (const msg of pendingMessages) {
          const customData = msg.custom_data || {};
          const messageStatus = customData.status;

          if (messageStatus === 'pending') {
            const { data: conversation, error: convError } = await supabaseServiceRole
              .from('conversations')
              .select('lead_id')
              .eq('id', msg.conversation_id)
              .single();

            if (!convError && conversation && conversation.lead_id === request.lead_id) {
              messageId = msg.id;
              console.log(`✅ Found pending message for lead ${request.lead_id}: ${messageId}`);
              break;
            }
          }
        }
      }
    }

    if (!messageId) {
      console.log(`⚠️ No message found to update for lead ${request.lead_id} - this may indicate the message was not properly created`);
      return {
        success: true,
        error: 'No message found to update'
      };
    }

    console.log(`📝 Reloading and updating message ${messageId} status...`);

    const { data: currentMessage, error: getCurrentError } = await supabaseServiceRole
      .from('messages')
      .select('id, conversation_id, content, role, custom_data, created_at, updated_at')
      .eq('id', messageId)
      .single();

    if (getCurrentError) {
      console.error(`❌ Error reloading current message data:`, getCurrentError);
      return {
        success: false,
        error: `Failed to reload message: ${getCurrentError.message}`
      };
    }

    if (request.conversation_id && currentMessage.conversation_id !== request.conversation_id) {
      console.error(`❌ Message ${messageId} conversation mismatch:`);
      console.error(`   - Expected: ${request.conversation_id}`);
      console.error(`   - Actual: ${currentMessage.conversation_id}`);
      return {
        success: false,
        error: 'Message conversation mismatch - possible data corruption'
      };
    }

    const currentCustomData = currentMessage.custom_data || {};
    const currentStatus = currentCustomData.status;

    if (shouldSkipDeliveryStatusUpdate(currentCustomData, request.delivery_success)) {
      console.log(`⚠️ Message ${messageId} was already processed and marked as 'sent'`);
      console.log(`   - Current status: ${currentStatus}`);
      console.log(`   - Processed at: ${currentCustomData.follow_up?.processed_at}`);
      console.log(`   - Skipping duplicate processing`);
      return {
        success: true,
        updated_message_id: messageId,
        error: 'Message already processed'
      };
    }

    if (currentStatus && currentStatus !== 'pending' && currentStatus !== 'sent' && currentStatus !== 'accepted') {
      console.log(`⚠️ Message ${messageId} has unexpected status: ${currentStatus}`);
      console.log(`   - Expected: 'pending', 'sent', or 'accepted'`);
      console.log(`   - Proceeding with update anyway`);
    }

    const targetStatus = request.delivery_success ? 'sent' : 'failed';
    console.log(`📝 Updating message status from '${currentStatus || 'undefined'}' to '${targetStatus}'`);

    const updatedCustomData = buildDeliveryStatusCustomData(currentCustomData, request);

    const { data, error } = await supabaseServiceRole
      .from('messages')
      .update({
        custom_data: updatedCustomData,
        updated_at: new Date().toISOString()
      })
      .eq('id', messageId)
      .select()
      .single();

    if (error) {
      console.error(`❌ Error updating message ${messageId}:`, error);
      return {
        success: false,
        error: error.message
      };
    }

    if (!data) {
      return {
        success: false,
        error: `Message ${messageId} not found or update failed`
      };
    }

    console.log(`✅ Successfully updated message ${messageId} status to '${targetStatus}'`);
    console.log(`📊 Message now marked as processed via ${request.delivery_channel}`);

    if (request.delivery_success && targetStatus === 'sent') {
      console.log(`👤 Updating lead ${request.lead_id} status to 'contacted' after successful message delivery...`);

      const leadUpdateData = {
        status: 'contacted',
        updated_at: new Date().toISOString(),
        last_contact: new Date().toISOString()
      };

      const { error: leadError } = await supabaseServiceRole
        .from('leads')
        .update(leadUpdateData)
        .eq('id', request.lead_id)
        .eq('site_id', request.site_id);

      if (leadError) {
        console.error(`❌ Warning: Failed to update lead status to 'contacted':`, leadError);
      } else {
        console.log(`✅ Successfully updated lead ${request.lead_id} status to 'contacted'`);
      }
    }

    return {
      success: true,
      updated_message_id: messageId
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Exception updating message status:`, errorMessage);

    return {
      success: false,
      error: errorMessage
    };
  }
}
