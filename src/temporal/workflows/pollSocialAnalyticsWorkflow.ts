import { patched, proxyActivities, log, sleep } from '@temporalio/workflow';
import type { Activities } from '../activities';
import { ACTIVITY_TIMEOUTS, RETRY_POLICIES } from '../config/timeouts';

const {
  fetchSitesWithSocialCommentsActivity,
  fetchSocialPostsDueForAnalyticsActivity,
  fetchAllSocialPostsDueForAnalyticsActivity,
  fetchOutstandPostAnalyticsActivity,
  upsertContentPerformanceActivity,
  upsertContentPerformanceBatchActivity,
  logWorkflowExecutionActivity,
} = proxyActivities<Activities>({
  startToCloseTimeout: ACTIVITY_TIMEOUTS.NETWORK,
  retry: RETRY_POLICIES.NETWORK,
});

/**
 * Hourly workflow to fetch and persist social performance analytics.
 * Only refreshes persisted social posts whose snapshot is older than 6 hours.
 */
export async function pollSocialAnalyticsWorkflow(): Promise<string> {
  const workflowId = 'pollSocialAnalyticsWorkflow';
  const useBatchedPersistence = patched('poll-social-analytics-batch-v1');

  await logWorkflowExecutionActivity({
    workflowId,
    workflowType: 'pollSocialAnalyticsWorkflow',
    status: 'STARTED',
    input: {},
  });

  try {
    const sites = await fetchSitesWithSocialCommentsActivity();
    const duePosts = useBatchedPersistence
      ? await fetchAllSocialPostsDueForAnalyticsActivity(
          sites.map((site) => site.site_id).filter(Boolean)
        )
      : [];
    const dueBySite = new Map<string, typeof duePosts>();
    for (const item of duePosts) {
      const siteItems = dueBySite.get(item.siteId) || [];
      siteItems.push(item);
      dueBySite.set(item.siteId, siteItems);
    }

    let processedSites = 0;
    let processedPosts = 0;

    for (const site of sites) {
      if (!site.site_id) continue;
      processedSites++;
      log.info(`Polling social analytics for site: ${site.site_id}`);

      const siteDuePosts = useBatchedPersistence
        ? dueBySite.get(site.site_id) || []
        : await fetchSocialPostsDueForAnalyticsActivity(site.site_id);
      const performanceUpdates: Array<{
        siteId: string;
        postId: string;
        analytics: any;
        contentId: string | null;
      }> = [];

      for (const item of siteDuePosts) {
        if (!item.postId) continue;
        await sleep('2s');

        try {
          const analytics = await fetchOutstandPostAnalyticsActivity(site.site_id, item.postId);
          if (analytics) {
            if (useBatchedPersistence) {
              performanceUpdates.push({
                siteId: site.site_id,
                postId: item.postId,
                analytics,
                contentId: item.contentId,
              });
            } else {
              await upsertContentPerformanceActivity(
                site.site_id,
                item.postId,
                analytics,
                item.contentId
              );
              processedPosts++;
            }
          }
        } catch (err) {
          log.error(`Failed to fetch analytics for post ${item.postId}: ${err}`);
        }
      }

      if (useBatchedPersistence && performanceUpdates.length > 0) {
        try {
          await upsertContentPerformanceBatchActivity(performanceUpdates);
          processedPosts += performanceUpdates.length;
        } catch (err) {
          log.error(`Failed to persist analytics for site ${site.site_id}: ${err}`);
        }
      }
    }

    const message = `Processed ${processedPosts} posts across ${processedSites} sites`;
    await logWorkflowExecutionActivity({
      workflowId,
      workflowType: 'pollSocialAnalyticsWorkflow',
      status: 'COMPLETED',
      output: { message, processedPosts, processedSites },
    });
    return message;
  } catch (error: any) {
    await logWorkflowExecutionActivity({
      workflowId,
      workflowType: 'pollSocialAnalyticsWorkflow',
      status: 'FAILED',
      error: error.message || 'Unknown error',
    });
    throw error;
  }
}
