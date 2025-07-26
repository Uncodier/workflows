import { proxyActivities } from '@temporalio/workflow';
import type * as activities from '../activities';
import { ACTIVITY_TIMEOUTS, RETRY_POLICIES } from '../config/timeouts';

// Configure activity options using centralized timeouts
const { 
  sendWhatsAppFromAgentActivity,
  createTemplateActivity,
  sendTemplateActivity,
  updateMessageStatusToSentActivity
} = proxyActivities<typeof activities>({
  startToCloseTimeout: ACTIVITY_TIMEOUTS.WHATSAPP_OPERATIONS, // ✅ Using centralized config (2 minutes)
  retry: RETRY_POLICIES.NETWORK, // ✅ Using appropriate retry policy for WhatsApp operations
});

/**
 * Workflow parameters interface
 */
export interface SendWhatsAppFromAgentParams {
  phone_number: string;
  message: string;
  site_id: string;
  from?: string;
  agent_id?: string;
  conversation_id?: string;
  lead_id?: string;
}

/**
 * Workflow result interface
 */
export interface SendWhatsAppFromAgentResult {
  success: boolean;
  messageId: string;
  recipient: string;
  executionTime: string;
  timestamp: string;
}

/**
 * Send WhatsApp From Agent Workflow
 * Sends a WhatsApp message via the agent API endpoint
 * Handles both direct messages (when there's response window) and template messages (when no response window)
 */
export async function sendWhatsappFromAgent(params: SendWhatsAppFromAgentParams): Promise<SendWhatsAppFromAgentResult> {
  console.log('📱 Starting send WhatsApp from agent workflow...');
  const startTime = new Date();

  let whatsappResult: any = null; // Declare in broader scope for error handling
  
  try {
    // Validate required parameters
    if (!params.phone_number || !params.message || !params.site_id) {
      throw new Error('Missing required WhatsApp parameters: phone_number, message and site_id are all required');
    }

    console.log('📤 Sending WhatsApp via agent API:', {
      recipient: params.phone_number,
      from: params.from || 'AI Assistant',
      messageLength: params.message.length,
      site_id: params.site_id,
      agent_id: params.agent_id || 'not-provided',
      conversation_id: params.conversation_id || 'not-provided',
      lead_id: params.lead_id || 'not-provided'
    });

    // Step 1: Send WhatsApp using the agent API
    whatsappResult = await sendWhatsAppFromAgentActivity({
      phone_number: params.phone_number,
      message: params.message,
      site_id: params.site_id,
      from: params.from,
      agent_id: params.agent_id,
      conversation_id: params.conversation_id,
      lead_id: params.lead_id
    });

    // Step 2: Check if template is required (no response window)
    if (whatsappResult.template_required) {
      console.log('📄 Template required - no response window available. Creating template...');
      
      try {
        // Step 3: Create template using the message_id and required parameters
        const templateResult = await createTemplateActivity({
          message_id: whatsappResult.messageId, // messageId from workflow interface maps to API's message_id
          phone_number: params.phone_number,
          message: params.message,
          site_id: params.site_id
        });

        console.log('✅ Template created successfully:', {
          template_id: templateResult.template_id
        });

        // Step 4: Send template with all required parameters
        const sendTemplateResult = await sendTemplateActivity({
          template_id: templateResult.template_id,
          phone_number: params.phone_number,
          site_id: params.site_id,
          message_id: whatsappResult.messageId, // Para tracking - messageId from workflow interface
          original_message: params.message      // Para logging
        });

        const endTime = new Date();
        const executionTime = `${endTime.getTime() - startTime.getTime()}ms`;

        console.log('✅ WhatsApp template sent successfully:', {
          messageId: sendTemplateResult.messageId,
          recipient: whatsappResult.recipient,
          executionTime,
          templateFlow: true
        });

        // Actualizar custom_data.channel = "whatsapp" para template exitoso
        try {
          console.log('📝 Updating message custom_data with channel = whatsapp...');
          const updateResult = await updateMessageStatusToSentActivity({
            message_id: sendTemplateResult.messageId,
            conversation_id: params.conversation_id,
            lead_id: params.lead_id || '',
            site_id: params.site_id,
            delivery_channel: 'whatsapp',
            delivery_success: true,
            delivery_details: {
              channel: 'whatsapp',
              messageId: sendTemplateResult.messageId,
              recipient: whatsappResult.recipient,
              timestamp: sendTemplateResult.timestamp,
              templateFlow: true
            }
          });

          if (updateResult.success) {
            console.log('✅ Message custom_data updated successfully with channel = whatsapp');
          } else {
            console.log('⚠️ Failed to update message custom_data:', updateResult.error);
          }
        } catch (updateError) {
          console.log('⚠️ Error updating message custom_data:', updateError instanceof Error ? updateError.message : String(updateError));
          // No fallar el workflow por error de actualización
        }

        return {
          success: sendTemplateResult.success,
          messageId: sendTemplateResult.messageId,
          recipient: whatsappResult.recipient,
          executionTime,
          timestamp: sendTemplateResult.timestamp
        };

      } catch (templateError) {
        // Update message status to failed when template flow fails
        console.error('❌ Template flow failed:', templateError);
        
        try {
          await updateMessageStatusToSentActivity({
            message_id: whatsappResult.messageId,
            conversation_id: params.conversation_id,
            lead_id: params.lead_id || '',
            site_id: params.site_id,
            delivery_channel: 'whatsapp',
            delivery_success: false,
            delivery_details: {
              status: 'failed',
              error: templateError instanceof Error ? templateError.message : String(templateError),
              timestamp: new Date().toISOString(),
              templateFlow: true
            }
          });
          console.log('📊 Message status updated to failed for template error');
        } catch (updateError) {
          console.error('❌ Failed to update message status:', updateError);
        }
        
        throw templateError; // Re-throw the original error
      }

    } else {
      // Scenario A: Direct message (response window available)
      const endTime = new Date();
      const executionTime = `${endTime.getTime() - startTime.getTime()}ms`;

      console.log('✅ WhatsApp sent successfully via direct message:', {
        messageId: whatsappResult.messageId,
        recipient: whatsappResult.recipient,
        executionTime,
        templateFlow: false
      });

      // Actualizar custom_data.channel = "whatsapp" para mensaje directo exitoso
      try {
        console.log('📝 Updating message custom_data with channel = whatsapp...');
        const updateResult = await updateMessageStatusToSentActivity({
          message_id: whatsappResult.messageId,
          conversation_id: params.conversation_id,
          lead_id: params.lead_id || '',
          site_id: params.site_id,
          delivery_channel: 'whatsapp',
          delivery_success: true,
          delivery_details: {
            channel: 'whatsapp',
            messageId: whatsappResult.messageId,
            recipient: whatsappResult.recipient,
            timestamp: whatsappResult.timestamp,
            templateFlow: false
          }
        });

        if (updateResult.success) {
          console.log('✅ Message custom_data updated successfully with channel = whatsapp');
        } else {
          console.log('⚠️ Failed to update message custom_data:', updateResult.error);
        }
      } catch (updateError) {
        console.log('⚠️ Error updating message custom_data:', updateError instanceof Error ? updateError.message : String(updateError));
        // No fallar el workflow por error de actualización
      }

      return {
        success: whatsappResult.success,
        messageId: whatsappResult.messageId,
        recipient: whatsappResult.recipient,
        executionTime,
        timestamp: whatsappResult.timestamp
      };
    }

  } catch (error) {
    const endTime = new Date();
    const executionTime = `${endTime.getTime() - startTime.getTime()}ms`;
    
    console.error('❌ Send WhatsApp from agent workflow failed:', {
      error: error instanceof Error ? error.message : String(error),
      executionTime
    });
    
    // Try to update message status to failed for initial send failures
    // (template failures are handled separately above)
    try {
      // Only update if we have a messageId from the initial call
      const messageId = whatsappResult?.messageId;
      if (messageId) {
        await updateMessageStatusToSentActivity({
          message_id: messageId,
          conversation_id: params.conversation_id,
          lead_id: params.lead_id || '',
          site_id: params.site_id,
          delivery_channel: 'whatsapp',
          delivery_success: false,
          delivery_details: {
            status: 'failed',
            error: error instanceof Error ? error.message : String(error),
            timestamp: new Date().toISOString()
          }
        });
        console.log('📊 Message status updated to failed for workflow error');
      }
    } catch (updateError) {
      console.error('❌ Failed to update message status for workflow error:', updateError);
    }
    
    throw error;
  }
} 