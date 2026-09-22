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
  getPublishedCommentNetworks,
  isOutstandDraftPost,
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
  finishSyncedObjectClaimActivity,
} = proxyActivities<Activities>({
  startToCloseTimeout: ACTIVITY_TIMEOUTS.NETWORK,
  retry: RETRY_POLICIES.NETWORK, // Handle API flakiness properly, don't retry forever on 400s
});

export async function pollSocialCommentsWorkflow(): Promise<any> {
  const workflowId = 'pollSocialCommentsWorkflow';
  const useAgeFiltering = patched('poll-social-comments-age-filter-v1');
  patched('poll-social-comments-safe-identifiers-v1');
  
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
                  if (account.id) {
                    try {
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
              const { isTooOld } = shouldPollPostForComments(post, nowMs);
              if (!isTooOld) {
                pageHasRecentPosts = true;
                break;
              }
            }
          }
          
          for (const post of posts) {
            const uniqueNetworks = getPublishedCommentNetworks(post);
            
            if (uniqueNetworks.length === 0 || isOutstandDraftPost(post)) {
              continue;
            }

            if (useAgeFiltering) {
              const { shouldPoll, isTooOld } = shouldPollPostForComments(post, nowMs);
              if (isTooOld || !shouldPoll) {
                continue;
              }
            }
            
            processedPosts++;
            
            try {
              // 1. Upsert content to ensure we have a reference for any comments
              const contentId = await upsertContentFromOutstandPostActivity(siteId, post);

              // 2. Fetch replies for each valid published network
              for (const network of uniqueNetworks) {
                const socialAccount = post.socialAccounts?.find((acc: any) => 
                  acc.network && acc.network.toLowerCase() === network.toLowerCase()
                );
                const networkPlatformPostId = socialAccount?.platformPostId || socialAccount?.platform_post_id;

                try {
                  const repliesResult = await fetchOutstandPostRepliesActivity(siteId, post.id, network);
                  const comments = Array.isArray(repliesResult) ? repliesResult : (repliesResult?.comments || repliesResult?.data || []);
                  
                  if (comments.length === 0) {
                    continue;
                  }

                  for (const comment of comments) {
                    const commentText = comment.text || comment.message || '';
                    const commentId = comment.id || comment.reply_id;
                    if (!commentText || !commentId) {
                      continue;
                    }

                    const commentNetwork = (comment.network || comment.account?.network || network || 'social').toLowerCase();
                    
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
                    const claim = await claimSyncedObjectActivity({
                      siteId,
                      objectType: 'social_comment',
                      externalId,
                      provider: origin,
                      metadata: {
                        platform_comment_id: platformCommentId || commentId,
                        outstand_post_id: post.id,
                      },
                    });

                    if (!claim.claimed || !claim.claimToken) {
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
                      throw startError;
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