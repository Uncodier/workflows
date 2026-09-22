import {
  ApplicationFailure,
  proxyActivities,
  upsertSearchAttributes,
} from '@temporalio/workflow';
import type { Activities } from '../activities';
import { ACTIVITY_TIMEOUTS, RETRY_POLICIES } from '../config/timeouts';
import { hasApplicationFailureType } from './helpers/applicationFailureType';
import { terminalWorkflowFailure } from './helpers/terminalWorkflowFailure';

export interface SendVoiceCallFromAgentParams {
  to: string;
  message: string;
  site_id: string;
  message_id: string;
  conversation_id: string;
  agent_id?: string;
  lead_id: string;
  audience_id?: string;
  language?: string;
  max_duration_minutes?: number;
}

export interface SendVoiceCallFromAgentResult {
  success: true;
  callId: string;
  status: string;
  deliveryId?: string;
}

const { placeVoiceCallFromAgentActivity } = proxyActivities<Activities>({
  startToCloseTimeout: ACTIVITY_TIMEOUTS.NETWORK,
  retry: RETRY_POLICIES.VOICE_CALL_PLACEMENT,
});

const { updateMessageStatusToSentActivity } = proxyActivities<Activities>({
  startToCloseTimeout: ACTIVITY_TIMEOUTS.DATABASE_OPERATIONS,
  retry: RETRY_POLICIES.DATABASE,
});

export async function sendVoiceCallFromAgentWorkflow(
  params: SendVoiceCallFromAgentParams
): Promise<SendVoiceCallFromAgentResult> {
  if (
    !params.to
    || !params.message
    || !params.site_id
    || !params.message_id
    || !params.conversation_id
  ) {
    throw ApplicationFailure.nonRetryable(
      'Voice call requires to, message, site_id, message_id, and conversation_id',
      'VOICE_CALL_INVALID_INPUT'
    );
  }

  upsertSearchAttributes({
    site_id: [params.site_id],
    ...(params.agent_id ? { user_id: [params.agent_id] } : {}),
    ...(params.lead_id ? { lead_id: [params.lead_id] } : {}),
  });

  try {
    return await placeVoiceCallFromAgentActivity(params);
  } catch (error) {
    const placementUnknown = hasApplicationFailureType(
      error,
      'VOICE_CALL_PLACEMENT_UNKNOWN'
    );
    const failureReason = error instanceof Error ? error.message : String(error);

    await updateMessageStatusToSentActivity({
      message_id: params.message_id,
      conversation_id: params.conversation_id,
      lead_id: params.lead_id,
      site_id: params.site_id,
      delivery_channel: 'voice',
      delivery_success: false,
      delivery_details: {
        status: placementUnknown ? 'placement_unknown' : 'failed',
        voice_mode: 'agent_call',
        recipient: params.to,
        error: failureReason,
        timestamp: new Date().toISOString(),
      },
    });

    throw terminalWorkflowFailure(
      error,
      placementUnknown
        ? 'Voice call placement outcome is unknown'
        : 'Voice call placement failed',
      placementUnknown
        ? 'VOICE_CALL_PLACEMENT_UNKNOWN'
        : 'VOICE_CALL_WORKFLOW_FAILED'
    );
  }
}
