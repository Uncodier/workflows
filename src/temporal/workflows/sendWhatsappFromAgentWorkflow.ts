import { proxyActivities, sleep, upsertSearchAttributes } from '@temporalio/workflow';
import type * as activities from '../activities';
import { ACTIVITY_TIMEOUTS, RETRY_POLICIES } from '../config/timeouts';

// Configure activity options using centralized timeouts
const {
  sendWhatsAppFromAgentActivity,
  createTemplateActivity,
  updateMessageStatusToSentActivity,
  fetchRecordByTableAndIdActivity
} = proxyActivities<typeof activities>({
  startToCloseTimeout: ACTIVITY_TIMEOUTS.WHATSAPP_OPERATIONS,
  retry: RETRY_POLICIES.NETWORK,
});

// sendTemplate: no built-in retries; workflow waits 1min then retries at 30min, 1h, 6h backoff
const { sendTemplateActivity } = proxyActivities<typeof activities>({
  startToCloseTimeout: ACTIVITY_TIMEOUTS.WHATSAPP_OPERATIONS,
  retry: { maximumAttempts: 1 },
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
  message_id?: string; // ID del mensaje en la base de datos para actualizar custom_data
  responseWindowEnabled?: boolean;
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

    const searchAttributes: Record<string, string[]> = {
      site_id: [params.site_id],
    };
    if (params.agent_id) {
      searchAttributes.user_id = [params.agent_id];
    }
    if (params.lead_id) {
      searchAttributes.lead_id = [params.lead_id];
    }
    upsertSearchAttributes(searchAttributes);

    // If we have a message_id, ensure the message still exists and fetch the latest content
    let currentMessageContent = params.message;
    if (params.message_id) {
      try {
        console.log('🔍 Checking message existence and refreshing content before sending...', { message_id: params.message_id });
        const fetchedMessage: any = await fetchRecordByTableAndIdActivity({ table: 'messages', id: params.message_id });
        if (!fetchedMessage) {
          console.log('🛑 Message not found - aborting WhatsApp send sequence');
          throw new Error('MESSAGE_DELETED');
        }
        const latestContent: string | null = typeof fetchedMessage?.content === 'string' ? fetchedMessage.content.trim() : null;
        if (!latestContent) {
          console.log('🛑 Message content empty or missing - aborting WhatsApp send sequence');
          throw new Error('MESSAGE_DELETED');
        }
        currentMessageContent = latestContent;
        console.log('✏️ Using refreshed message content for sending');
      } catch (earlyFetchErr) {
        const msg = earlyFetchErr instanceof Error ? earlyFetchErr.message : String(earlyFetchErr);
        if (msg === 'MESSAGE_DELETED') {
          throw earlyFetchErr; // Propagate special abort condition
        }
        // If fetch failed for other reasons (e.g., network), proceed with original content
        console.log('⚠️ Could not refresh message content, proceeding with original content', msg);
      }
    }

    console.log('📤 Sending WhatsApp via agent API:', {
      recipient: params.phone_number,
      from: params.from || 'AI Assistant',
      messageLength: currentMessageContent.length,
      site_id: params.site_id,
      agent_id: params.agent_id || 'not-provided',
      conversation_id: params.conversation_id || 'not-provided',
      lead_id: params.lead_id || 'not-provided'
    });

    // Step 1: Send WhatsApp using the agent API
    whatsappResult = await sendWhatsAppFromAgentActivity({
      phone_number: params.phone_number,
      message: currentMessageContent,
      site_id: params.site_id,
      from: params.from,
      agent_id: params.agent_id,
      conversation_id: params.conversation_id,
      lead_id: params.lead_id,
      responseWindowEnabled: params.responseWindowEnabled
    });

    // Step 2: Check if template is required (no response window)
    if (whatsappResult.template_required) {
      console.log('📄 Template required - no response window available. Creating template...');
      
      try {
        const messageForTemplate = currentMessageContent;
        // Step 3: Create template using the message_id and required parameters
        const templateResult = await createTemplateActivity({
          message_id: whatsappResult.messageId, // messageId from workflow interface maps to API's message_id
          phone_number: params.phone_number,
          message: messageForTemplate,
          site_id: params.site_id
        });

        console.log('✅ Template created successfully:', {
          template_id: templateResult.template_id
        });

        // Step 4: Send template; first attempt after 1min, then retries at 30min, 1h, 6h
        const sendTemplateParams = {
          template_id: templateResult.template_id,
          phone_number: params.phone_number,
          site_id: params.site_id,
          message_id: whatsappResult.messageId,
          original_message: messageForTemplate
        };
        await sleep('1m'); // First attempt always waits at least 1 minute
        const backoffDelays: (string | number)[] = ['30m', '1h', '6h'];
        let sendTemplateResult: Awaited<ReturnType<typeof sendTemplateActivity>> | null = null;
        let lastSendError: unknown = null;

        for (let attempt = 0; attempt <= backoffDelays.length; attempt++) {
          try {
            sendTemplateResult = await sendTemplateActivity(sendTemplateParams);
            lastSendError = null;
            break;
          } catch (err) {
            lastSendError = err;
            if (attempt < backoffDelays.length) {
              console.warn(`⚠️ sendTemplate attempt ${attempt + 1} failed, retrying after ${backoffDelays[attempt]}...`, err instanceof Error ? err.message : String(err));
              await sleep(backoffDelays[attempt]);
            }
          }
        }

        if (lastSendError !== null || sendTemplateResult === null) {
          throw lastSendError ?? new Error('sendTemplate failed after 4 attempts');
        }

        const endTime = new Date();
        const executionTime = `${endTime.getTime() - startTime.getTime()}ms`;

        console.log('✅ WhatsApp template sent successfully:', {
          messageId: sendTemplateResult.messageId,
          recipient: whatsappResult.recipient,
          executionTime,
          templateFlow: true
        });

        // Actualizar custom_data.channel = "whatsapp" solo si tenemos message_id o conversation_id
        if (params.message_id || params.conversation_id) {
          try {
            console.log('📝 Updating message custom_data with channel = whatsapp...', {
              message_id: params.message_id || 'not-provided',
              conversation_id: params.conversation_id || 'not-provided',
              templateFlow: true
            });
            const updateResult = await updateMessageStatusToSentActivity({
              message_id: params.message_id,
              conversation_id: params.conversation_id,
              lead_id: params.lead_id || '',
              site_id: params.site_id,
              delivery_channel: 'whatsapp',
              delivery_success: true,
              delivery_details: {
                channel: 'whatsapp',
                phone_number: params.phone_number, // Número de teléfono de destino
                recipient: whatsappResult.recipient,
                timestamp: sendTemplateResult.timestamp,
                templateFlow: true,
                messageLength: (messageForTemplate || '').length
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
        } else {
          console.log('ℹ️ No message_id or conversation_id provided - skipping custom_data update');
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
        
        if (params.message_id || params.conversation_id) {
          try {
            console.log('📝 Updating message status to failed for template error...', {
              message_id: params.message_id || 'not-provided',
              conversation_id: params.conversation_id || 'not-provided'
            });
            await updateMessageStatusToSentActivity({
              message_id: params.message_id,
              conversation_id: params.conversation_id,
              lead_id: params.lead_id || '',
              site_id: params.site_id,
              delivery_channel: 'whatsapp',
              delivery_success: false,
              delivery_details: {
                status: 'failed',
                phone_number: params.phone_number, // Número de teléfono para contexto
                error: templateError instanceof Error ? templateError.message : String(templateError),
                timestamp: new Date().toISOString(),
                templateFlow: true,
                messageLength: params.message.length
              }
            });
            console.log('📊 Message status updated to failed for template error');
          } catch (updateError) {
            console.error('❌ Failed to update message status:', updateError);
          }
        } else {
          console.log('ℹ️ No message_id or conversation_id provided - skipping status update');
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

      // Actualizar custom_data.channel = "whatsapp" solo si tenemos message_id o conversation_id
      if (params.message_id || params.conversation_id) {
        try {
          console.log('📝 Updating message custom_data with channel = whatsapp...', {
            message_id: params.message_id || 'not-provided',
            conversation_id: params.conversation_id || 'not-provided',
            templateFlow: false
          });
          const updateResult = await updateMessageStatusToSentActivity({
            message_id: params.message_id,
            conversation_id: params.conversation_id,
            lead_id: params.lead_id || '',
            site_id: params.site_id,
            delivery_channel: 'whatsapp',
            delivery_success: true,
            delivery_details: {
              channel: 'whatsapp',
              phone_number: params.phone_number, // Número de teléfono de destino
              recipient: whatsappResult.recipient,
              timestamp: whatsappResult.timestamp,
              templateFlow: false,
              messageLength: params.message.length
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
      } else {
        console.log('ℹ️ No message_id or conversation_id provided - skipping custom_data update');
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
    if (params.message_id || params.conversation_id) {
      try {
        console.log('📝 Updating message status to failed for workflow error...', {
          message_id: params.message_id || 'not-provided',
          conversation_id: params.conversation_id || 'not-provided'
        });
        await updateMessageStatusToSentActivity({
          message_id: params.message_id,
          conversation_id: params.conversation_id,
          lead_id: params.lead_id || '',
          site_id: params.site_id,
          delivery_channel: 'whatsapp',
          delivery_success: false,
          delivery_details: {
            status: 'failed',
            phone_number: params.phone_number, // Número de teléfono para contexto
            error: error instanceof Error ? error.message : String(error),
            timestamp: new Date().toISOString(),
            messageLength: params.message.length
          }
        });
        console.log('📊 Message status updated to failed for workflow error');
      } catch (updateError) {
        console.error('❌ Failed to update message status for workflow error:', updateError);
      }
    } else {
      console.log('ℹ️ No message_id or conversation_id provided - skipping status update');
    }
    
    throw error;
  }
} 