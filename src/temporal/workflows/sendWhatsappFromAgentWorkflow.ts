import type { AutomationSkipMetadata } from '../utils/automationSnooze';
import {
  ApplicationFailure,
  isCancellation,
  proxyActivities,
  sleep,
  patched,
  upsertSearchAttributes,
} from '@temporalio/workflow';
import type { Duration } from '@temporalio/common';
import type * as activities from '../activities';
import { ACTIVITY_TIMEOUTS, RETRY_POLICIES } from '../config/timeouts';
import { buildSendTemplateActivityParams } from './helpers/buildSendTemplateParams';
import { shouldRetrySendTemplate } from './helpers/whatsappTemplateRejection';
import { terminalWorkflowFailure } from './helpers/terminalWorkflowFailure';
import { outboundMediaFields, type OutboundMediaFields } from './helpers/outboundMedia';
import { routeSavedWhatsAppText, completeRoutedWhatsAppFollowUp } from './helpers/routeSavedWhatsAppText';
import { savedTextIdentity, type RoutedWhatsAppTextReceipt } from '../utils/routedWhatsAppText';

// Configure activity options using centralized timeouts
const {
  sendWhatsAppFromAgentActivity,
  createTemplateActivity,
  updateMessageStatusToSentActivity,
  fetchRecordByTableAndIdActivity,
  updateMessageTimestampActivity,
  updateConversationStatusAfterFollowUpActivity,
  updateTaskStatusToCompletedActivity,
  cleanupFailedFollowUpActivity,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: ACTIVITY_TIMEOUTS.WHATSAPP_OPERATIONS,
  retry: RETRY_POLICIES.NETWORK,
});

// sendTemplate: no built-in retries; workflow waits 1min then retries at 30min, 1h, 6h backoff
const { sendTemplateActivity } = proxyActivities<typeof activities>({
  startToCloseTimeout: ACTIVITY_TIMEOUTS.WHATSAPP_OPERATIONS,
  retry: { maximumAttempts: 1 },
});

const { sendWhatsAppFromAgentActivity: sendAudioOnce } = proxyActivities<typeof activities>({
  startToCloseTimeout: ACTIVITY_TIMEOUTS.WHATSAPP_OPERATIONS,
  retry: { maximumAttempts: 1 },
});

/**
 * Workflow parameters interface
 */
export interface SendWhatsAppFromAgentParams extends OutboundMediaFields {
  response_format?: 'text' | 'audio';
  phone_number?: string; // Required on legacy sends, never authoritative for routed text.
  message: string;
  site_id: string;
  from?: string;
  agent_id?: string;
  conversation_id?: string;
  lead_id?: string;
  message_id?: string;
  responseWindowEnabled?: boolean;
  /** When true, this run is from sendApprovedMessagesWorkflow; child performs conversation/task updates and cleanup on failure */
  fromApprovedWorkflow?: boolean;
  /** custom_data from the approved message (for updateConversationStatusAfterFollowUpActivity) */
  approvedWorkflowCustomData?: Record<string, unknown>;
}

/**
 * Workflow result interface
 */
export interface SendWhatsAppFromAgentResult extends AutomationSkipMetadata, Partial<RoutedWhatsAppTextReceipt> {
  success: boolean;
  messageId?: string; // Routed sends expose this legacy alias only for an accepted provider ID.
  recipient?: string; // The routed API does not return a recipient.
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
  const useOutboundMedia = patched('send-whatsapp-outbound-media-v1');
  let media: OutboundMediaFields = {};
  // Decide the version before fetching. A replay partway through an old send
  // must not start routing (or change its legacy error/cleanup behavior).
  const useTextRouter = params.message_id !== undefined && params.conversation_id !== undefined
    && (params.response_format === undefined || params.response_format === 'text')
    && params.media_url === undefined && params.mime_type === undefined
    && (params.message_type === undefined || params.message_type === 'text') && patched('whatsapp-saved-text-router-v1');
  let routed = useTextRouter ? savedTextIdentity(params) : undefined;
  if (useTextRouter && !routed) {
    // Invalid purported saved IDs are not permission to call a legacy sender.
    throw ApplicationFailure.nonRetryable('Invalid saved WhatsApp identity', 'WHATSAPP_ROUTED_TEXT_INVALID_INPUT');
  }

  let whatsappResult: any = null; // Declare in broader scope for error handling
  
  try {
    media = useOutboundMedia ? outboundMediaFields(params) : {};
    if (media.media_url && params.message === undefined) params = { ...params, message: '' };
    if (media.media_url && params.response_format === 'audio') throw ApplicationFailure.nonRetryable('Existing media cannot request generated speech', 'INVALID_OUTBOUND_MEDIA');
    if (params.response_format === 'audio' && !params.message_id?.trim()) {
      throw ApplicationFailure.nonRetryable('Explicit audio requires message_id', 'AUDIO_MESSAGE_ID_REQUIRED');
    }
    // Validate required parameters
    if (!routed && (!params.phone_number || (!params.message && !media.media_url) || !params.site_id)) {
      throw ApplicationFailure.nonRetryable(
        'Missing required WhatsApp parameters: phone_number, message and site_id are all required',
        'WHATSAPP_INVALID_INPUT'
      );
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
        if (routed) {
          if ((fetchedMessage.id !== undefined && fetchedMessage.id !== routed.message_id)
            || (fetchedMessage.conversation_id !== undefined && fetchedMessage.conversation_id !== routed.conversation_id)) {
            throw new Error('Saved WhatsApp identity mismatch');
          }
          // Caller omitted audio/media but the saved record is not plain text.
          // Explicit audio keeps its existing dispatch. Never downgrade ambiguous
          // audio or a prior native-media receipt to an unrelated text operation.
          const saved = fetchedMessage.custom_data;
          if ((saved?.response_format !== undefined && saved.response_format !== 'text') || saved?.audio_delivery
            || (saved?.native_media_delivery && !saved.media_url)) {
            throw new Error('Saved WhatsApp message is not plain text');
          }
        }
        const latestContent: string | null = typeof fetchedMessage?.content === 'string'
          ? (params.response_format === 'audio' ? fetchedMessage.content : fetchedMessage.content.trim()) : null;
        if (useOutboundMedia) {
          const savedMedia = outboundMediaFields(fetchedMessage.custom_data || {});
          if (media.media_url && !savedMedia.media_url) throw new Error('MESSAGE_DELETED');
          media = savedMedia;
          if (media.media_url && fetchedMessage.custom_data?.response_format === 'audio') throw new Error('INVALID_OUTBOUND_MEDIA');
          if (media.media_url && params.response_format === 'audio') throw new Error('INVALID_OUTBOUND_MEDIA');
        }
        if (!latestContent?.trim() && !media.media_url) {
          console.log('🛑 Message content empty or missing - aborting WhatsApp send sequence');
          throw new Error('MESSAGE_DELETED');
        }
        currentMessageContent = latestContent || '';
        console.log('✏️ Using refreshed message content for sending');
      } catch (earlyFetchErr) {
        const msg = earlyFetchErr instanceof Error ? earlyFetchErr.message : String(earlyFetchErr);
        if (routed || msg === 'MESSAGE_DELETED' || params.response_format === 'audio' || media.media_url) {
          throw earlyFetchErr; // Propagate special abort condition
        }
        // If fetch failed for other reasons (e.g., network), proceed with original content
        console.log('⚠️ Could not refresh message content, proceeding with original content', msg);
      }
    }

    if (routed && !media.media_url) {
      const receipt = await routeSavedWhatsAppText(routed);
      if (receipt.status === 'accepted' && params.fromApprovedWorkflow && params.lead_id) {
        await completeRoutedWhatsAppFollowUp(routed, params.lead_id, params.approvedWorkflowCustomData);
      }
      const endTime = new Date();
      return { ...receipt, ...(receipt.status === 'accepted' && { messageId: receipt.provider_message_id }),
        ...(receipt.status === 'skipped' && { delivered: false, conversation_id: routed.conversation_id }),
        executionTime: `${endTime.getTime() - startTime.getTime()}ms`, timestamp: endTime.toISOString() };
    }

    // A saved record refreshed as media keeps the native, single-attempt path.
    if (!params.phone_number) throw ApplicationFailure.nonRetryable('Missing WhatsApp recipient for legacy send', 'WHATSAPP_INVALID_INPUT');
    routed = undefined;
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
    whatsappResult = await (params.response_format === 'audio' || media.media_url ? sendAudioOnce : sendWhatsAppFromAgentActivity)({
      phone_number: params.phone_number,
      message: currentMessageContent,
      site_id: params.site_id,
      from: params.from,
      agent_id: params.agent_id,
      conversation_id: params.conversation_id,
      lead_id: params.lead_id,
      responseWindowEnabled: params.responseWindowEnabled,
      ...media,
      ...(params.response_format !== undefined ? { response_format: params.response_format, message_id: params.message_id } : {}),
      ...(patched('conversation-automation-snooze-v1') ? { message_id: params.message_id } : {}),
    });

    if (whatsappResult.skipped) return { ...whatsappResult, executionTime: `${Date.now() - startTime.getTime()}ms` };
    if (media.media_url && whatsappResult.template_required) throw ApplicationFailure.nonRetryable('Media cannot use a text template', 'MEDIA_TEMPLATE_REQUIRED');

    // Step 2: Check if template is required (no response window)
    if (params.response_format === 'audio' && whatsappResult.template_required) {
      throw ApplicationFailure.nonRetryable('Explicit audio cannot use a template', 'AUDIO_TEMPLATE_REQUIRED');
    }
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
        const sendTemplateParams = buildSendTemplateActivityParams({
          template_id: templateResult.template_id,
          phone_number: params.phone_number,
          site_id: params.site_id,
          message_id: whatsappResult.messageId,
          original_message: messageForTemplate,
          lead_id: params.lead_id,
        });
        await sleep('1m'); // First attempt always waits at least 1 minute
        const backoffDelays: Duration[] = ['30m', '1h', '6h'];
        let sendTemplateResult: Awaited<ReturnType<typeof sendTemplateActivity>> | null = null;
        let lastSendError: unknown = null;

        for (let attempt = 0; attempt <= backoffDelays.length; attempt++) {
          try {
            sendTemplateResult = await sendTemplateActivity(sendTemplateParams);
            lastSendError = null;
            break;
          } catch (err) {
            lastSendError = err;
            if (attempt < backoffDelays.length && shouldRetrySendTemplate(err)) {
              console.warn(`⚠️ sendTemplate attempt ${attempt + 1} failed, retrying after ${backoffDelays[attempt]}...`, err instanceof Error ? err.message : String(err));
              await sleep(backoffDelays[attempt]);
            } else {
              break;
            }
          }
        }

        if (lastSendError !== null || sendTemplateResult === null) {
          throw lastSendError ?? new Error('sendTemplate failed after 4 attempts');
        }

        if (sendTemplateResult.skipped) return { ...sendTemplateResult, recipient: params.phone_number, executionTime: `${Date.now() - startTime.getTime()}ms` };

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
            if (params.fromApprovedWorkflow && params.message_id && params.conversation_id && params.lead_id) {
              await updateMessageTimestampActivity({
                message_id: params.message_id,
                conversation_id: params.conversation_id,
                lead_id: params.lead_id,
                site_id: params.site_id,
                delivery_timestamp: new Date().toISOString(),
                delivery_channel: 'whatsapp',
              });
              await updateConversationStatusAfterFollowUpActivity({
                conversation_id: params.conversation_id,
                lead_id: params.lead_id,
                site_id: params.site_id,
                response_data: params.approvedWorkflowCustomData ?? {},
                additional_data: {
                  message_ids: [params.message_id],
                  conversation_ids: [params.conversation_id],
                },
              });
              await updateTaskStatusToCompletedActivity({
                lead_id: params.lead_id,
                site_id: params.site_id,
                stage: 'awareness',
                status: 'completed',
                notes: 'Task completed after successful whatsapp message delivery via sendApprovedMessagesWorkflow',
              });
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
            if (params.message_id && params.conversation_id && params.lead_id) {
              const failureReason = templateError instanceof Error ? templateError.message : String(templateError);
              await cleanupFailedFollowUpActivity({
                lead_id: params.lead_id,
                site_id: params.site_id,
                conversation_id: params.conversation_id,
                message_id: params.message_id,
                failure_reason: failureReason,
                delivery_channel: 'whatsapp',
                phone_number: params.phone_number,
              });
            }
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
          if (params.fromApprovedWorkflow && params.message_id && params.conversation_id && params.lead_id) {
            await updateMessageTimestampActivity({
              message_id: params.message_id,
              conversation_id: params.conversation_id,
              lead_id: params.lead_id,
              site_id: params.site_id,
              delivery_timestamp: new Date().toISOString(),
              delivery_channel: 'whatsapp',
            });
            await updateConversationStatusAfterFollowUpActivity({
              conversation_id: params.conversation_id,
              lead_id: params.lead_id,
              site_id: params.site_id,
              response_data: params.approvedWorkflowCustomData ?? {},
              additional_data: {
                message_ids: [params.message_id],
                conversation_ids: [params.conversation_id],
              },
            });
            await updateTaskStatusToCompletedActivity({
              lead_id: params.lead_id,
              site_id: params.site_id,
              stage: 'awareness',
              status: 'completed',
              notes: 'Task completed after successful whatsapp message delivery via sendApprovedMessagesWorkflow',
            });
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
    if (routed) {
      if (isCancellation(error)) throw error;
      throw ApplicationFailure.nonRetryable('Cannot verify saved WhatsApp text delivery; reconcile before retry',
        'WHATSAPP_ROUTED_TEXT_UNCONFIRMED');
    }
    if (useOutboundMedia && params.media_url !== undefined && !media.media_url) throw ApplicationFailure.nonRetryable('Invalid outbound media', 'INVALID_OUTBOUND_MEDIA');
    const endTime = new Date();
    const executionTime = `${endTime.getTime() - startTime.getTime()}ms`;
    
    console.error('❌ Send WhatsApp from agent workflow failed:', {
      error: error instanceof Error ? error.message : String(error),
      executionTime
    });
    
    // Try to update message status to failed for initial send failures
    // (template failures are handled separately above)
    // The HTTP audio delivery owns its receipt/status, including uncertain sends.
    // Never overwrite it or delete the message/cache after a timeout.
    if (params.response_format !== 'audio' && !media.media_url && (params.message_id || params.conversation_id)) {
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
        if (params.message_id && params.conversation_id && params.lead_id) {
          const failureReason = error instanceof Error ? error.message : String(error);
          await cleanupFailedFollowUpActivity({
            lead_id: params.lead_id,
            site_id: params.site_id,
            conversation_id: params.conversation_id,
            message_id: params.message_id,
            failure_reason: failureReason,
            delivery_channel: 'whatsapp',
            phone_number: params.phone_number,
          });
        }
      } catch (updateError) {
        console.error('❌ Failed to update message status for workflow error:', updateError);
      }
    } else {
      console.log('ℹ️ No message_id or conversation_id provided - skipping status update');
    }
    
    if (media.media_url) throw ApplicationFailure.nonRetryable('Media delivery failed or is unknown; reconcile before retry', 'MEDIA_DELIVERY_FAILED_OR_UNKNOWN');
    if (params.response_format === 'audio') {
      if (error instanceof ApplicationFailure && error.nonRetryable) throw error;
      throw ApplicationFailure.nonRetryable('Audio delivery failed or is unknown; reconcile before retry', 'AUDIO_DELIVERY_FAILED_OR_UNKNOWN');
    }
    throw terminalWorkflowFailure(
      error,
      'Send WhatsApp from agent workflow failed',
      'WHATSAPP_WORKFLOW_FAILED'
    );
  }
} 