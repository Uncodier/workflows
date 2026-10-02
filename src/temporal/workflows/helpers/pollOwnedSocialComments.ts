import { isCancellation, ParentClosePolicy, proxyActivities, startChild } from '@temporalio/workflow';
import type { Activities } from '../../activities';
import { ACTIVITY_TIMEOUTS, RETRY_POLICIES } from '../../config/timeouts';
import { ingestSocialCommentWorkflow } from '../ingestSocialCommentWorkflow';
import { normalizeOutstandNetwork, SUPPORTED_COMMENT_NETWORKS } from './outstandPoll';
import { socialCommentCandidates } from './socialCommentPayload';
import { shouldSyncSocialComments } from './socialCommentCadence';
import { commentScopeKey, commentsAfterBoundary, scopedCommentExternalId } from './socialCommentScope';

const {
  initializeSocialCommentScopeActivity, findLegacySocialCommentClaimsActivity,
  fetchOutstandPostRepliesActivity, claimSyncedObjectsBatchActivity,
  finishSyncedObjectClaimActivity, verifySocialCommentIngestionActivity,
  recordSocialCommentSyncSuccessActivity,
} = proxyActivities<Activities>({
  startToCloseTimeout: ACTIVITY_TIMEOUTS.NETWORK, retry: RETRY_POLICIES.NETWORK,
});

/** New command sequence is gated by poll-social-comments-owned-account-scope-v2. */
export async function pollOwnedSocialComments(
  siteId: string, post: any, accounts: any[], contentId: string, nowMs: number
): Promise<{ processed: number; failed: number }> {
  let processed = 0;
  let failed = 0;
  const seen = new Set<string>();
  for (const account of accounts) {
    const network = normalizeOutstandNetwork(account.network);
    if (!SUPPORTED_COMMENT_NETWORKS.some(value => value === network)) continue;
    try {
      const scope = { siteId, postId: post.id, network, accountId: account.id };
      const syncKey = commentScopeKey(scope);
      if (seen.has(syncKey)) continue;
      seen.add(syncKey);
      const inheritLegacy = accounts.filter(value => normalizeOutstandNetwork(value.network) === network).length === 1;
      const state = await initializeSocialCommentScopeActivity(scope, inheritLegacy);
      if (!shouldSyncSocialComments(post.publishedAt || post.createdAt, state.lastSuccessAt, nowMs)) continue;
      const comments = await fetchOutstandPostRepliesActivity(siteId, post.id, network, {
        durableIdentity: true, accountId: account.id,
        ...(typeof account.username === 'string' && account.username.trim() ? { username: account.username.trim() } : {}),
      });
      if (!Array.isArray(comments)) throw new Error('Invalid scoped social comments response');
      // Filter only against the immutable rollout boundary, not last success.
      const candidates = socialCommentCandidates(commentsAfterBoundary(comments, state.boundary).map(comment => ({
        ...comment, id: comment.id || comment.reply_id || comment.platform_comment_id,
        platform_specific: { ...comment.platform_specific,
          ...(comment.platform_comment_id ? { commentUrn: comment.platform_comment_id } : {}) },
      })), network, true, true);
      const legacy = new Set(await findLegacySocialCommentClaimsActivity(scope, [...candidates.keys()], inheritLegacy));
      const requests = [...candidates.values()].filter(candidate => !legacy.has(candidate.externalId)).map(candidate => ({
        siteId, objectType: 'social_comment' as const,
        externalId: scopedCommentExternalId(scope, candidate.stableCommentId), provider: network,
        metadata: { publisher_account_id: account.id, outstand_post_id: post.id, platform_comment_id: candidate.stableCommentId },
      }));
      const claims = await claimSyncedObjectsBatchActivity(requests);
      const byId = new Map(claims.map(claim => [claim.externalId, claim]));
      const results: Array<Promise<boolean>> = [];
      let startFailed = false;
      for (const candidate of candidates.values()) {
        if (legacy.has(candidate.externalId)) continue;
        const externalId = scopedCommentExternalId(scope, candidate.stableCommentId);
        const claim = byId.get(externalId);
        if (!claim?.claimed || !claim.claimToken) continue;
        const { comment, commentText, authorName, handle, authorId, profileUrl } = candidate;
        try {
          // Keep the full scoped identity: sanitizing punctuation can collide.
          const workflowId = `social-comment-${externalId}`;
          if (workflowId.length > 1000) throw new Error('Scoped social comment workflow ID exceeds Temporal limit');
          const child = await startChild(ingestSocialCommentWorkflow, {
            workflowId, parentClosePolicy: ParentClosePolicy.PARENT_CLOSE_POLICY_ABANDON,
            args: [{
              siteId, externalId, claimToken: claim.claimToken,
              baseParams: { origin: network, origin_message_id: externalId },
              messageData: {
                site_id: siteId, message: commentText, name: authorName || handle || 'Social User',
                origin: network, origin_message_id: externalId, channel_delivery: true, require_approval: true,
                custom_data: {
                  source: 'comment', channel: network, network,
                  publisher_account_id: account.id, publisher_username: account.username,
                  outstand_post_id: post.id, content_id: contentId,
                  platform_post_id: account.platformPostId || account.platform_post_id || comment.platformPostId || comment.platform_post_id,
                  platform_post_url: account.platformPostUrl || account.platform_post_url || comment.platformPostUrl || comment.platform_post_url || post.url,
                  platform_comment_id: candidate.stableCommentId,
                  parent_comment_id: comment.parentCommentId || comment.parent_comment_id,
                  root_comment_id: comment.rootCommentId || comment.root_comment_id,
                  ...(authorId ? { author_id: authorId } : {}), author_name: authorName,
                  author_username: handle, social_handle: handle, account_username: handle, profile_url: profileUrl,
                  author_identity_status: network === 'linkedin' ? 'resolve_on_read'
                    : authorName || handle ? 'available' : 'unavailable',
                },
              },
            }],
          });
          results.push(child.result().then(result => result.success === true, () => false));
          processed++;
        } catch (error) {
          if (isCancellation(error)) throw error;
          startFailed = true;
          await finishSyncedObjectClaimActivity({ siteId, objectType: 'social_comment', externalId,
            claimToken: claim.claimToken, status: 'error', errorMessage: String(error) });
        }
      }
      const completed = await Promise.all(results);
      if (startFailed || completed.some(success => !success)) throw new Error('Social comment ingestion did not complete');
      await verifySocialCommentIngestionActivity(siteId, requests.map(request => request.externalId));
      // Only this database key is namespaced. Provider IDs in requests stay literal.
      await recordSocialCommentSyncSuccessActivity(siteId, syncKey, network);
    } catch (error) {
      if (isCancellation(error)) throw error;
      failed++;
      console.error(`Social comment sync failed for ${post.id}/${network}/${account.id}:`, error);
    }
  }
  return { processed, failed };
}