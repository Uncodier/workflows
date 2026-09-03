"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pollSocialAnalyticsWorkflow = pollSocialAnalyticsWorkflow;
const workflow_1 = require("@temporalio/workflow");
const { fetchSitesWithSocialCommentsActivity, fetchSocialPostsDueForAnalyticsActivity, fetchOutstandPostAnalyticsActivity, upsertContentPerformanceActivity, logWorkflowExecutionActivity, } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: '5 minutes',
});
/**
 * Hourly workflow to fetch and persist social performance analytics.
 * Only refreshes persisted social posts whose snapshot is older than 6 hours.
 */
async function pollSocialAnalyticsWorkflow() {
    const workflowId = 'pollSocialAnalyticsWorkflow';
    await logWorkflowExecutionActivity({
        workflowId,
        workflowType: 'pollSocialAnalyticsWorkflow',
        status: 'STARTED',
        input: {},
    });
    try {
        const sites = await fetchSitesWithSocialCommentsActivity();
        let processedSites = 0;
        let processedPosts = 0;
        for (const site of sites) {
            if (!site.site_id)
                continue;
            processedSites++;
            workflow_1.log.info(`Polling social analytics for site: ${site.site_id}`);
            const duePosts = await fetchSocialPostsDueForAnalyticsActivity(site.site_id);
            for (const item of duePosts) {
                if (!item.postId)
                    continue;
                await (0, workflow_1.sleep)('2s');
                try {
                    const analytics = await fetchOutstandPostAnalyticsActivity(site.site_id, item.postId);
                    if (analytics) {
                        await upsertContentPerformanceActivity(site.site_id, item.postId, analytics, item.contentId);
                        processedPosts++;
                    }
                }
                catch (err) {
                    workflow_1.log.error(`Failed to fetch/upsert analytics for post ${item.postId}: ${err}`);
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
    }
    catch (error) {
        await logWorkflowExecutionActivity({
            workflowId,
            workflowType: 'pollSocialAnalyticsWorkflow',
            status: 'FAILED',
            error: error.message || 'Unknown error',
        });
        throw error;
    }
}
