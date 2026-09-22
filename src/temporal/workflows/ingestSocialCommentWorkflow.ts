import { proxyActivities } from '@temporalio/workflow';
import type { Activities } from '../activities';
import { ACTIVITY_TIMEOUTS, RETRY_POLICIES } from '../config/timeouts';
import { customerSupportMessageWorkflow } from './customerSupportWorkflow';

const { finishSyncedObjectClaimActivity } = proxyActivities<Activities>({
  startToCloseTimeout: ACTIVITY_TIMEOUTS.DATABASE_OPERATIONS,
  retry: RETRY_POLICIES.DATABASE,
});

export interface IngestSocialCommentParams {
  siteId: string;
  externalId: string;
  claimToken: string;
  messageData: Record<string, unknown>;
  baseParams: {
    origin: string;
    origin_message_id: string;
  };
}

export async function ingestSocialCommentWorkflow(
  params: IngestSocialCommentParams
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  try {
    const result = await customerSupportMessageWorkflow(
      params.messageData,
      params.baseParams
    );

    await finishSyncedObjectClaimActivity({
      siteId: params.siteId,
      objectType: 'social_comment',
      externalId: params.externalId,
      claimToken: params.claimToken,
      status: 'completed',
    });

    return result;
  } catch (error) {
    try {
      await finishSyncedObjectClaimActivity({
        siteId: params.siteId,
        objectType: 'social_comment',
        externalId: params.externalId,
        claimToken: params.claimToken,
        status: 'error',
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    } catch (claimError) {
      console.error(
        `Failed to release social comment claim ${params.externalId}:`,
        claimError
      );
    }

    throw error;
  }
}
