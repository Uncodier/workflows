import { ApplicationFailure } from '@temporalio/common';
import { apiService } from '../services/apiService';
import { createLeadFollowUpApiFailure } from './leadFollowUpFailure';
import { assertOutboundChannelAvailable, isOutboundChannelUnavailable } from './daily-prospection/outboundGate';
import { validateCommunicationChannelsActivity } from './daily-prospection/validate';
import { resolveOutreachActivity } from '../utils/outreachActivity';

export interface LeadFollowUpRequest {
  lead_id: string;
  site_id: string;
  userId?: string;
  message_status?: string;
  additionalData?: any;
}

export interface LeadFollowUpResult {
  success: boolean;
  data?: any;
  error?: string;
  followUpActions?: any[];
  nextSteps?: string[];
}

/**
 * Executes lead follow-up through the sales API.
 *
 * API and empty-result failures are thrown so Temporal applies the configured
 * activity retry policy. Permanent validation and channel failures do not retry.
 */
export async function leadFollowUpActivity(
  request: LeadFollowUpRequest
): Promise<LeadFollowUpResult> {
  console.log(`📞 Executing lead follow-up for lead: ${request.lead_id}, site: ${request.site_id}`);

  try {
    try {
      const outreachActivity = resolveOutreachActivity(request.additionalData);
      if (outreachActivity) {
        const validation = await validateCommunicationChannelsActivity({
          site_id: request.site_id, outreach_activity: outreachActivity, requireHealthyOutbound: true,
        });
        if (!validation.success) throw new Error(validation.error || 'Outreach channels unavailable');
        if (!validation.hasAnyChannel) throw ApplicationFailure.nonRetryable('No selected outbound channel', 'OUTBOUND_CHANNEL_UNAVAILABLE');
      } else {
        await assertOutboundChannelAvailable(request.site_id);
      }
    } catch (error) {
      if (isOutboundChannelUnavailable(error)) {
        throw ApplicationFailure.nonRetryable('No available outbound channel', 'OUTBOUND_CHANNEL_UNAVAILABLE');
      }
      throw error;
    }
    const requestBody = {
      ...request.additionalData,
      leadId: request.lead_id,
      siteId: request.site_id,
      userId: request.userId,
      message_status: request.message_status,
    };

    console.log('📤 Sending lead follow-up request:', JSON.stringify(requestBody, null, 2));

    const response = await apiService.post('/api/agents/sales/leadFollowUp', requestBody);

    if (!response.success) {
      console.error(`❌ Failed to execute lead follow-up for lead ${request.lead_id}:`, response.error);
      throw createLeadFollowUpApiFailure(response.error);
    }

    const data = response.data;
    const followUpActions = data?.followUpActions || data?.actions || [];
    const nextSteps = data?.nextSteps || data?.next_steps || [];

    console.log(`✅ Lead follow-up executed successfully for lead ${request.lead_id}`);
    if (followUpActions.length > 0) {
      console.log(`📋 Follow-up actions generated: ${followUpActions.length}`);
    }
    if (nextSteps.length > 0) {
      console.log(`🎯 Next steps identified: ${nextSteps.length}`);
    }

    return {
      success: true,
      data,
      followUpActions,
      nextSteps,
    };
  } catch (error) {
    console.error(
      `❌ Exception executing lead follow-up for lead ${request.lead_id}:`,
      error instanceof Error ? error.message : String(error)
    );

    if (error instanceof ApplicationFailure) throw error;

    throw ApplicationFailure.create({
      message: error instanceof Error ? error.message : String(error),
      type: 'LEAD_FOLLOW_UP_UNEXPECTED_FAILURE',
      nonRetryable: false,
    });
  }
}
