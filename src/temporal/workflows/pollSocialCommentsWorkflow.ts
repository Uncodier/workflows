import {
  ParentClosePolicy,
  patched,
  proxyActivities,
  startChild,
} from '@temporalio/workflow';
import type { Activities } from '../activities';
import { ingestSocialCommentWorkflow } from './ingestSocialCommentWorkflow';
import { ACTIVITY_TIMEOUTS, RETRY_POLICIES } from '../config/timeouts';
import {
  buildSocialCommentExternalId,
  buildSocialCommentWorkflowId,
  getPostSiteOwnerships,
  getUnambiguousPostSiteOwnerships,
  isImportAccountOwnedBySite,
  isOutstandDraftPost,
  normalizeOutstandNetwork,
  shouldPollPostForComments,
} from './helpers/outstandPoll';
import { terminalWorkflowFailure } from './helpers/terminalWorkflowFailure';

const {
  fetchSitesWithSocialCommentsActivity,
  fetchOutstandPostsActivity,
  fetchOutstandPostRepliesActivity,
  upsertContentFromOutstandPostActivity,
  logWorkflowExecutionActivity,
  fetchOutstandAccountsActivity,
  importOutstandPostsActivity,
  checkIfImportTriggeredActivity,
  markImportTriggeredActivity,
  claimSyncedObjectActivity,
  claimSyncedObjectsBatchActivity,
  finishSyncedObjectClaimActivity,
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
  
  await logWorkflowExecutionActivity({
    workflowId,
    workflowType: 'pollSocialCommentsWorkflow',
    status: 'STARTED',
    input: {},
  });
  
  let processedPosts = 0;
  let processedComments = 0;

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
          const pagination = Array.isArray(result) ? { total: posts.length } : (result?.pagination || { total: posts.length });
          
          if (offset === 0 && posts.length === 0) {
            try {
              const alreadyTriggered = await checkIfImportTriggeredActivity(siteId);
              if (!alreadyTriggered) {
                const accounts = await fetchOutstandAccountsActivity(siteId);
                let importStarted = false;
                for (const account of accounts) {
                  const canImport = useStrictSiteOwnership
                    ? isImportAccountOwnedBySite(account, site.social_media) &&
                      sites.filter((candidate) =>
                        isImportAccountOwnedBySite(account, candidate.social_media)
                      ).length === 1
                    : Boolean(account.id);
                  if (canImport) {
                    try {
                      // Keep the historical activity payload for pending tasks
                      // and retries. The activity revalidates ownership itself.
                      await importOutstandPostsActivity(siteId, account.id);
                      importStarted = true;
                    } catch (importError) {
                      console.error(`Failed to trigger import for account ${account.id}:`, importError);
                    }
                  }
                }
                if (importStarted) {
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
              ? getUnambiguousPostSiteOwnerships(post, sites)
              : getPostSiteOwnerships(post, sites);
            const ownership = ownerships
              .find((candidate) => candidate.siteId === siteId);
            const ownedSocialAccounts = ownership?.socialAccounts || [];
            const uniqueNetworks = [
              ...new Set(
                ownedSocialAccounts
                  .map((account: any) => normalizeOutstandNetwork(account.network))
                  .filter(Boolean)
              ),
            ];
            
            if (uniqueNetworks.length === 0 || isOutstandDraftPost(post)) {
              continue;
            }

            if (useAgeFiltering) {
              const { shouldPoll, isTooOld } = shouldPollPostForComments(
                post,
                nowMs,
                useBucketCadence
              );
              if (isTooOld || !shouldPoll) {
                continue;
              }
            }
            
            processedPosts++;
            
            try {
              // 1. Upsert content to ensure we have a reference for any comments
              const contentId = await upsertContentFromOutstandPostActivity(
                siteId,
                post,
                site.social_media
              );

              // 2. Fetch replies for each valid published network
              for (const network of uniqueNetworks) {
                const socialAccount = ownedSocialAccounts.find((account: any) =>
                  normalizeOutstandNetwork(account.network) === network
                );
                const networkPlatformPostId = socialAccount?.platformPostId || socialAccount?.platform_post_id;

                try {
                  const repliesResult = await fetchOutstandPostRepliesActivity(siteId, post.id, network);
                  const comments = Array.isArray(repliesResult) ? repliesResult : (repliesResult?.comments || repliesResult?.data || []);
                  
                  if (comments.length === 0) {
                    continue;
                  }

                  const commentCandidates = new Map<string, {
                    comment: any;
                    commentId: string;
                    commentText: string;
                    origin: string;
                    stableCommentId: string;
                    externalId: string;
                    handle: string;
                    authorId: string;
                    profileUrl: string;
                    platformCommentId: unknown;
                  }>();

                  for (const comment of comments) {
                    const commentText = comment.text || comment.message || '';
                    const commentId = comment.id || comment.reply_id;
                    if (!commentText || !commentId) {
                      continue;
                    }

                    const commentNetwork = (comment.network || comment.account?.network || network || 'social').toLowerCase();
                    if (normalizeOutstandNetwork(commentNetwork) !== network) {
                      console.warn(
                        `Skipping comment ${commentId}: returned network ${commentNetwork} does not match owned network ${network}`
                      );
                      continue;
                    }
                    
                    const authorObj = (typeof comment.author === 'object' && comment.author) || 
                                      (typeof comment.from === 'object' && comment.from) || 
                                      (typeof comment.user === 'object' && comment.user) || {};
                    
                    const rawAuthorId = typeof comment.author === 'string' ? comment.author : 
                                        typeof comment.from === 'string' ? comment.from : '';

                    const handle = comment.username || 
                                   comment.authorName || 
                                   authorObj.username || 
                                   authorObj.name || 
                                   comment.accountUsername || 
                                   rawAuthorId || 
                                   '';
                    
                    const authorId = String(comment.author_id || comment.authorId || authorObj.id || rawAuthorId || '');
                    const profileUrl = comment.author_url || comment.authorUrl || authorObj.url || authorObj.profileUrl || authorObj.profile_url || '';
                    const platformCommentId = comment.platform_specific?.commentUrn || comment.platform_specific?.id;
                    
                    const origin = commentNetwork === 'twitter' ? 'x' : commentNetwork;
                    const stableCommentId = String(platformCommentId || commentId);
                    const externalId = buildSocialCommentExternalId(origin, stableCommentId);

                    commentCandidates.set(externalId, {
                      comment,
                      commentId: String(commentId),
                      commentText,
                      origin,
                      stableCommentId,
                      externalId,
                      handle,
                      authorId,
                      profileUrl,
                      platformCommentId,
                    });
                  }

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
                      name: handle || 'Social User',
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
                      },
                    };

                    try {
                      await startChild(ingestSocialCommentWorkflow, {
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
                    } catch (startError) {
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
                } catch (networkError) {
                  console.error(`Failed to process replies for post ${post.id} on network ${network}:`, networkError);
                }
              }
            } catch (postError) {
              // Log but continue with other posts
              console.error(`Failed to process post ${post.id}:`, postError);
            }
          }
          
          offset += limit;
          if (offset >= pagination.total || posts.length === 0) {
            hasMore = false;
          } else if (posts.length > 0 && !pageHasRecentPosts) {
            // If the current page returned posts but NONE of them are recent,
            // we can assume we've reached the older posts and can stop paginating.
            console.log(`[pollSocialCommentsWorkflow] Stopping pagination for site ${siteId} as all posts on page are older than 30 days.`);
            hasMore = false;
          }
        }
      } catch (siteError) {
        // Log but continue with other sites
        console.error(`Failed to process site ${site.site_id}:`, siteError);
      }
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