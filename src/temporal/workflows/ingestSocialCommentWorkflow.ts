import { patched, proxyActivities } from '@temporalio/workflow';
import type { Activities } from '../activities';
import { ACTIVITY_TIMEOUTS, RETRY_POLICIES } from '../config/timeouts';
import { customerSupportMessageWorkflow } from './customerSupportWorkflow';
import { terminalWorkflowFailure } from './helpers/terminalWorkflowFailure';

const { finishSyncedObjectClaimActivity, assertSocialCommentPersistedActivity, hasSocialCommentPersistedActivity } = proxyActivities<Activities>({
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
  const verifyPersistence = patched('ingest-social-comment-confirm-persistence-v1');
  try {
    // A previous attempt may have saved the inbound comment before losing the
    // API response. Do not create another draft just to recover its claim.
    const alreadyPersisted = verifyPersistence && await hasSocialCommentPersistedActivity(params.siteId, params.externalId);
    const result = alreadyPersisted
      ? { success: true }
      : await customerSupportMessageWorkflow(params.messageData, params.baseParams);
    if (verifyPersistence) {
      if (!result.success) throw new Error('Social comment ingestion did not succeed');
      await assertSocialCommentPersistedActivity(params.siteId, params.externalId);
    }

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

    if (verifyPersistence) throw terminalWorkflowFailure(error, 'Social comment ingestion failed', 'SOCIAL_COMMENT_INGESTION_FAILED');
    throw error;
  }
}
