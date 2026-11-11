import { automationSkipMetadata, type AutomationSkipMetadata } from '../utils/automationSnooze';
import {
  ApplicationFailure,
  proxyActivities,
  patched,
  upsertSearchAttributes,
} from '@temporalio/workflow';
import type * as activities from '../activities';
import { ACTIVITY_TIMEOUTS, RETRY_POLICIES } from '../config/timeouts';
import { terminalWorkflowFailure } from './helpers/terminalWorkflowFailure';
import { pollTemplateDelivery } from './helpers/pollTemplateDelivery';
import { isTemplatePending, templateDeliveryMetadata, type TemplateDeliveryMetadata } from '../utils/templateDelivery';

// Configure activity options
const {
  sendChannelMessageFromAgentActivity
} = proxyActivities<typeof activities>({
  startToCloseTimeout: ACTIVITY_TIMEOUTS.WHATSAPP_OPERATIONS, // Reusing timeout config
  retry: RETRY_POLICIES.NETWORK,
});

export interface SendChannelMessageFromAgentParams {
  response_format?: 'text' | 'audio';
  channel: string;
  to: string;
  message: string;
  site_id: string;
  subject?: string;
  agent_id?: string;
  conversation_id?: string;
  lead_id?: string;
  message_id?: string;
  custom_data?: Record<string, any>;
}

export interface SendChannelMessageFromAgentResult extends TemplateDeliveryMetadata, AutomationSkipMetadata {
  success: boolean;
  messageId: string;
  recipient: string;
  executionTime: string;
  timestamp: string;
}

// Audio sends may have reached the provider even if the activity times out.
const { sendChannelMessageFromAgentActivity: sendAudioOnce } = proxyActivities<typeof activities>({
  startToCloseTimeout: ACTIVITY_TIMEOUTS.WHATSAPP_OPERATIONS,
  retry: { maximumAttempts: 1 },
});

/**
 * Send Channel Message From Agent Workflow
 * Sends a generic channel message (like telegram or messenger) via the API endpoint
 */
export async function sendChannelMessageFromAgentWorkflow(params: SendChannelMessageFromAgentParams): Promise<SendChannelMessageFromAgentResult> {
  console.log(`📤 Starting send ${params.channel} from agent workflow...`);
  const startTime = new Date();

  try {
    if (!params.channel || !params.to || !params.message || !params.site_id) {
      throw ApplicationFailure.nonRetryable(
        'Missing required parameters: channel, to, message and site_id are required',
        'CHANNEL_MESSAGE_INVALID_INPUT'
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

    console.log(`📞 Executing activity to send ${params.channel} message...`);
    if (params.response_format === 'audio' && !params.message_id?.trim()) {
      throw ApplicationFailure.nonRetryable('Explicit audio requires message_id', 'AUDIO_MESSAGE_ID_REQUIRED');
    }
    const templateAudio = params.channel === 'whatsapp' && params.response_format === 'audio'
      && patched('channel-audio-template-polling-v1');
    const result = templateAudio
      ? await pollTemplateDelivery(() => sendAudioOnce(params), params.message_id!, {
        site_id: params.site_id, conversation_id: params.conversation_id, message_id: params.message_id! })
      : await (params.response_format === 'audio' ? sendAudioOnce : sendChannelMessageFromAgentActivity)(params);

    if (!result.success && !(templateAudio && (isTemplatePending(result) || result.needs_reconciliation !== undefined))) {
      throw new Error(result.error || `Failed to send ${params.channel} message`);
    }

    const endTime = new Date();
    const executionTimeMs = endTime.getTime() - startTime.getTime();

    console.log(`${params.channel} message workflow finished in ${executionTimeMs}ms: ${result.status || 'sent'}`);

    return {
      success: result.success,
      ...automationSkipMetadata(result),
      messageId: result.messageId || 'unknown',
      recipient: params.to,
      executionTime: `${executionTimeMs}ms`,
      timestamp: endTime.toISOString(),
      ...(templateAudio ? templateDeliveryMetadata(result) : {}),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Send ${params.channel} from agent workflow failed:`, errorMessage);

    if (params.response_format === 'audio') {
      if (error instanceof ApplicationFailure && error.nonRetryable) throw error;
      throw ApplicationFailure.nonRetryable('Audio delivery failed or is unknown; reconcile before retry', 'AUDIO_DELIVERY_FAILED_OR_UNKNOWN');
    }
    throw terminalWorkflowFailure(
      error,
      `Send ${params.channel} from agent workflow failed`,
      'CHANNEL_MESSAGE_WORKFLOW_FAILED'
    );
  }
}
