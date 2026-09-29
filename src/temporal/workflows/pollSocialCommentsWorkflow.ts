import {
  ParentClosePolicy,
  isCancellation,
  patched,
  proxyActivities,
  startChild,
} from '@temporalio/workflow';
import type { Activities } from '../activities';
import { ingestSocialCommentWorkflow } from './ingestSocialCommentWorkflow';
import { ACTIVITY_TIMEOUTS, RETRY_POLICIES } from '../config/timeouts';
import {
  buildSocialCommentWorkflowId,
  getPostSiteOwnerships,
  getUnambiguousPostSiteOwnerships,
  getUnambiguousSocialPostSiteOwnerships,
  isImportAccountOwnedBySite,
  isOutstandDraftPost,
  normalizeOutstandNetwork,
  SUPPORTED_COMMENT_NETWORKS,
  supportsHistoricalImport,
  shouldPollPostForComments,
} from './helpers/outstandPoll';
import { terminalWorkflowFailure } from './helpers/terminalWorkflowFailure';
import { socialCommentCandidates } from './helpers/socialCommentPayload';
import { shouldSyncSocialComments } from './helpers/socialCommentCadence';

const {
  fetchSitesWithSocialCommentsActivity,
  fetchOutstandPostsActivity,
  fetchOutstandPostRepliesActivity,
  upsertContentFromOutstandPostActivity,
  logWorkflowExecutionActivity,
  fetchOutstandAccountsActivity,
  importOutstandPostsActivity,
  fetchOutstandImportJobsActivity,
  startInitialOutstandImportActivity,
  recordInitialOutstandImportActivity,
  checkIfImportTriggeredActivity,
  markImportTriggeredActivity,
  claimSyncedObjectActivity,
  claimSyncedObjectsBatchActivity,
  finishSyncedObjectClaimActivity,
  getSocialCommentSyncStatesActivity,
  recordSocialCommentSyncSuccessActivity,
  verifySocialCommentIngestionActivity,
} = proxyActivities<Activities>({
  startToCloseTimeout: ACTIVITY_TIMEOUTS.NETWORK,
  retry: RETRY_POLICIES.NETWORK, // Handle API flakiness properly, don't retry forever on 400s
});

export async function pollSocialCommentsWorkflow(): Promise<any> {
  const workflowId = 'pollSocialCommentsWorkflow';
  const useAgeFiltering = patched('poll-social-comments-age-filter-v1');
  const useBucketCadence = patched('poll-social-comments-bucket-cadence-v2');
  const useBatchClaims = patched('poll-social-comments-batch-claims-v1');
  patched('poll-social-comments-safe-identifiers-v1');
  // Both ownership filters can remove activity/child-workflow commands. Keep
  // the old decisions for histories that predate this marker.
  const useStrictSiteOwnership = patched('poll-social-comments-strict-site-ownership-v1');
  const useSocialPostNetworks = patched('poll-social-comments-tiktok-posts-v1');
  const useImportJobStatus = patched('poll-social-comments-import-job-status-v1');
  const useAutomaticInitialImport = patched('poll-social-comments-auto-initial-import-v1');
  const useDurableCommentSync = patched('poll-social-comments-durable-sync-v1');
  
  await logWorkflowExecutionActivity({
    workflowId,
    workflowType: 'pollSocialCommentsWorkflow',
    status: 'STARTED',
    input: {},
  });
  
  let processedPosts = 0;
  let processedComments = 0;
  let failedCommentSyncs = 0;

  try {
    const sites = await fetchSitesWithSocialCommentsActivity();
    
    for (const site of sites) {
      try {
        const siteId = site.site_id;
        
        // Fetch posts for the site
        const limit = 100;
        let offset = 0;
        let hasMore = true;
        const nowMs = useAgeFiltering ? Date.now() : 0;
        
        while (hasMore) {
          const result = await fetchOutstandPostsActivity(siteId, limit, offset);
          
          const posts = Array.isArray(result) ? result : (result?.posts || result?.data || []);
          const syncStates = useDurableCommentSync
            ? await getSocialCommentSyncStatesActivity(siteId, posts.map((post: any) => post.id))
            : [];
          // Older activity histories may contain only an array with no total.
          // Only the new branch continues on full pages; preserve the command
          // sequence for older Temporal histories.
          const pagination = Array.isArray(result)
            ? { total: useSocialPostNetworks && useImportJobStatus && posts.length === limit
              ? offset + posts.length + 1
              : posts.length }
            : (result?.pagination || { total: posts.length });
          
          if (offset === 0 && (useSocialPostNetworks && useImportJobStatus
            ? useAutomaticInitialImport || posts.length === 0
            : useSocialPostNetworks || posts.length === 0)) {
            try {
              const alreadyTriggered = useSocialPostNetworks
                ? false // New branch checks each connected account separately below.
                : await checkIfImportTriggeredActivity(siteId);
              if (!alreadyTriggered) {
                const accounts = await fetchOutstandAccountsActivity(siteId);
                let importStarted = false;
                let importFailed = false;
                for (const account of accounts) {
                  const canImport = useStrictSiteOwnership
                    ? isImportAccountOwnedBySite(account, site.social_media) &&
                      sites.filter((candidate) =>
                        isImportAccountOwnedBySite(account, candidate.social_media)
                      ).length === 1
                    : Boolean(account.id);
                  if (canImport) {
                    try {
                      if (useImportJobStatus && useSocialPostNetworks) {
                        const jobs = await fetchOutstandImportJobsActivity(siteId, account.id);
                        // Prefer the oldest job for an account that predates
                        // this ledger; it is the initial historical import.
                        const latestJob = useAutomaticInitialImport
                          ? jobs[jobs.length - 1]
                          : jobs[0]; // Legacy branch keeps its old command flow.
                        if (latestJob) {
                          if (useAutomaticInitialImport && latestJob.socialAccountId &&
                            latestJob.socialAccountId !== account.id) {
                            console.error(`Outstand import job ${latestJob.id} belongs to another account; skipping ${account.id}`);
                            continue;
                          }
                          if (useAutomaticInitialImport && latestJob.id &&
                            ['queued', 'running', 'completed', 'partial', 'failed'].includes(latestJob.status)) {
                            await recordInitialOutstandImportActivity(siteId, account.id, latestJob);
                          }
                          if (latestJob.status === 'failed' || latestJob.status === 'partial') {
                            console.error(`Outstand import for account ${account.id} failed: ${latestJob.error || 'Unknown error'}`);
                          }
                        } else if (useAutomaticInitialImport) {
                          if (supportsHistoricalImport(account.network)) {
                            await startInitialOutstandImportActivity(siteId, account.id);
                          }
                        }
                        // A durable per-account claim keeps a bounded initial
                        // import from repeating after failures or lost replies.
                        continue;
                      } else if (useSocialPostNetworks && await checkIfImportTriggeredActivity(siteId, account.id)) {
                        continue;
                      }
                      // Keep the historical activity payload for pending tasks
                      // and retries. The activity revalidates ownership itself.
                      await importOutstandPostsActivity(siteId, account.id);
                      importStarted = true;
                      if (useSocialPostNetworks && !useImportJobStatus) {
                        await markImportTriggeredActivity(siteId, account.id);
                      }
                    } catch (importError) {
                      importFailed = true;
                      console.error(`Failed to trigger import for account ${account.id}:`, importError);
                    }
                  }
                }
                if (importStarted && !useSocialPostNetworks && !importFailed) {
                  await markImportTriggeredActivity(siteId);
                }
              }
            } catch (triggerError) {
              console.error(`Failed during historical import check for site ${siteId}:`, triggerError);
            }
          }
          
          let pageHasRecentPosts = !useAgeFiltering;
          
          // First pass to see if there are any recent posts on this page
          if (useAgeFiltering) {
            for (const post of posts) {
              const { isTooOld } = shouldPollPostForComments(
                post,
                nowMs,
                useBucketCadence
              );
              if (!isTooOld) {
                pageHasRecentPosts = true;
                break;
              }
            }
          }
          
          for (const post of posts) {
            const ownerships = useStrictSiteOwnership
              ? useSocialPostNetworks
                ? getUnambiguousSocialPostSiteOwnerships(post, sites)
                : getUnambiguousPostSiteOwnerships(post, sites)
              : getPostSiteOwnerships(post, sites);
            const ownership = ownerships
              .find((candidate) => candidate.siteId === siteId);
            const ownedSocialAccounts = ownership?.socialAccounts || [];
            // TikTok is eligible for post/analytics ingestion, but the comments
            // API does not support it. Do not gate the post on comment networks.
            const hasPublishedPost = ownedSocialAccounts.length > 0;
            const uniqueNetworks = [
              ...new Set(
                ownedSocialAccounts
                  .map((account: any) => normalizeOutstandNetwork(account.network))
                  .filter((network) => Boolean(network) && (useAutomaticInitialImport
                    ? SUPPORTED_COMMENT_NETWORKS.some((supported) => supported === network)
                    : !useSocialPostNetworks || network !== 'tiktok'))
              ),
            ];
            
            if ((useSocialPostNetworks ? !hasPublishedPost : uniqueNetworks.length === 0) || isOutstandDraftPost(post)) {
              continue;
            }

            if (!useDurableCommentSync && useAgeFiltering && !(useSocialPostNetworks && useImportJobStatus)) {
              const { shouldPoll, isTooOld } = shouldPollPostForComments(
                post,
                nowMs,
                useBucketCadence
              );
              if (isTooOld || !shouldPoll) {
                continue;
              }
            }
            
            try {
              // 1. Upsert content to ensure we have a reference for any comments
              const contentId = await upsertContentFromOutstandPostActivity(
                siteId,
                post,
                site.social_media
              );
              if (useSocialPostNetworks && useImportJobStatus && !contentId) {
                console.error(`Outstand post ${post.id} could not be persisted for site ${siteId}`);
                if (useDurableCommentSync) failedCommentSyncs++;
                continue;
              }
              processedPosts++;

              // Preserve legacy cadence for replay. New runs always perform an
              // initial sync, including historical posts, before reducing frequency.
              const pollReplies = !useAgeFiltering || shouldPollPostForComments(
                post, nowMs, useBucketCadence
              ).shouldPoll;

              // 2. Fetch replies for each valid published network
              for (const network of uniqueNetworks) {
                if (useDurableCommentSync) {
                  const state = syncStates.find((entry) => entry.postId === post.id && entry.network === network);
                  if (!shouldSyncSocialComments(post.publishedAt || post.createdAt, state?.lastSuccessAt, nowMs)) continue;
                } else if (useSocialPostNetworks && useImportJobStatus && !pollReplies) continue;
                const socialAccount = ownedSocialAccounts.find((account: any) =>
                  normalizeOutstandNetwork(account.network) === network
                );
                const networkPlatformPostId = socialAccount?.platformPostId || socialAccount?.platform_post_id;

                try {
                  const repliesResult = await fetchOutstandPostRepliesActivity(siteId, post.id, network);
                  const comments = Array.isArray(repliesResult) ? repliesResult : (repliesResult?.comments || repliesResult?.data || []);
                  
                  if (comments.length === 0) {
                    if (useDurableCommentSync) await recordSocialCommentSyncSuccessActivity(siteId, post.id, network);
                    continue;
                  }

                  const commentCandidates = socialCommentCandidates(comments, network, useDurableCommentSync);

                  if (commentCandidates.size === 0) {
                    continue;
                  }

                  const claimRequests = [...commentCandidates.values()].map(
                    (candidate) => ({
                      siteId,
                      objectType: 'social_comment' as const,
                      externalId: candidate.externalId,
                      provider: candidate.origin,
                      metadata: {
                        platform_comment_id:
                          candidate.platformCommentId || candidate.commentId,
                        outstand_post_id: post.id,
                      },
                    })
                  );
                  const claims = useBatchClaims
                    ? await claimSyncedObjectsBatchActivity(claimRequests)
                    : [];
                  if (!useBatchClaims) {
                    for (const request of claimRequests) {
                      claims.push(await claimSyncedObjectActivity(request));
                    }
                  }
                  const claimsByExternalId = new Map(
                    claims.map((claim) => [claim.externalId, claim])
                  );
                  const ingestionResults: Array<Promise<boolean>> = [];
                  let startFailed = false;

                  for (const candidate of commentCandidates.values()) {
                    const {
                      comment,
                      commentId,
                      commentText,
                      origin,
                      stableCommentId,
                      externalId,
                      handle,
                      authorId,
                      authorName,
                      profileUrl,
                      platformCommentId,
                    } = candidate;
                    const claim = claimsByExternalId.get(externalId);
                    if (!claim?.claimed || !claim.claimToken) {
                      continue;
                    }

                    const messageData = {
                      site_id: siteId,
                      message: commentText,
                      name: authorName || handle || 'Social User',
                      origin,
                      origin_message_id: externalId,
                      channel_delivery: true,
                      require_approval: true,
                      custom_data: {
                        platform_post_id: comment.platformPostId || comment.platform_post_id || networkPlatformPostId,
                        platform_post_url: comment.platformPostUrl || comment.platform_post_url || post.url,
                        platform_comment_id: platformCommentId || commentId,
                        parent_comment_id: comment.parentCommentId || comment.parent_comment_id,
                        root_comment_id: comment.rootCommentId || comment.root_comment_id,
                        account_username: handle,
                        social_handle: handle,
                        author_id: authorId,
                        profile_url: profileUrl,
                        outstand_post_id: post.id,
                        content_id: contentId,
                        source: 'comment',
                        ...(useDurableCommentSync ? { author_name: authorName, channel: origin } : {}),
                      },
                    };

                    try {
                      const child = await startChild(ingestSocialCommentWorkflow, {
                        workflowId: buildSocialCommentWorkflowId(siteId, origin, stableCommentId),
                        args: [{
                          siteId,
                          externalId,
                          claimToken: claim.claimToken,
                          messageData,
                          baseParams: {
                            origin,
                            origin_message_id: externalId,
                          },
                        }],
                        parentClosePolicy: ParentClosePolicy.PARENT_CLOSE_POLICY_ABANDON,
                      });
                      // Attach rejection handling immediately while starting the
                      // remaining children, then wait before advancing last success.
                      if (useDurableCommentSync) ingestionResults.push(child.result().then(
                        (value) => value.success === true, () => false
                      ));
                    } catch (startError) {
                      if (useDurableCommentSync && isCancellation(startError)) throw startError;
                      startFailed = true;
                      await finishSyncedObjectClaimActivity({
                        siteId,
                        objectType: 'social_comment',
                        externalId,
                        claimToken: claim.claimToken,
                        status: 'error',
                        errorMessage: startError instanceof Error ? startError.message : String(startError),
                      });
                      console.error(
                        `Failed to start ingestion for comment ${commentId}:`,
                        startError
                      );
                      if (!useBatchClaims) {
                        throw startError;
                      }
                      continue;
                    }
                    
                    processedComments++;
                  }
                  if (useDurableCommentSync) {
                    const ingested = await Promise.all(ingestionResults);
                    if (startFailed || ingested.some((success) => !success)) throw new Error('Some social comment workflows did not complete');
                    await verifySocialCommentIngestionActivity(siteId, [...commentCandidates.keys()]);
                    await recordSocialCommentSyncSuccessActivity(siteId, post.id, network);
                  }
                } catch (networkError) {
                  if (useDurableCommentSync && isCancellation(networkError)) throw networkError;
                  if (useDurableCommentSync) failedCommentSyncs++;
                  console.error(`Failed to process replies for post ${post.id} on network ${network}:`, networkError);
                }
              }
            } catch (postError) {
              if (useDurableCommentSync && isCancellation(postError)) throw postError;
              if (useDurableCommentSync) failedCommentSyncs++;
              // Log but continue with other posts
              console.error(`Failed to process post ${post.id}:`, postError);
            }
          }
          
          offset += limit;
          if (offset >= pagination.total || posts.length === 0) {
            hasMore = false;
          } else if (posts.length > 0 && !pageHasRecentPosts && !(useSocialPostNetworks && useImportJobStatus)) {
            // If the current page returned posts but NONE of them are recent,
            // we can assume we've reached the older posts and can stop paginating.
            console.log(`[pollSocialCommentsWorkflow] Stopping pagination for site ${siteId} as all posts on page are older than 30 days.`);
            hasMore = false;
          }
        }
      } catch (siteError) {
        if (useDurableCommentSync && isCancellation(siteError)) throw siteError;
        if (useDurableCommentSync) failedCommentSyncs++;
        // Log but continue with other sites
        console.error(`Failed to process site ${site.site_id}:`, siteError);
      }
    }
    
    if (useDurableCommentSync && failedCommentSyncs > 0) {
      throw new Error(`${failedCommentSyncs} social comment syncs failed; unsuccessful posts remain due`);
    }
    await logWorkflowExecutionActivity({
      workflowId,
      workflowType: 'pollSocialCommentsWorkflow',
      status: 'COMPLETED',
      input: {},
      output: { processedPosts, processedComments },
    });
    
    return { success: true, processedPosts, processedComments };
  } catch (error) {
    await logWorkflowExecutionActivity({
      workflowId,
      workflowType: 'pollSocialCommentsWorkflow',
      status: 'FAILED',
      input: {},
      error: error instanceof Error ? error.message : String(error),
    });
    throw terminalWorkflowFailure(
      error,
      'Social comments polling workflow failed',
      'SOCIAL_COMMENTS_WORKFLOW_FAILED'
    );
  }
}