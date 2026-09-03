"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processSubscriptionsWorkflow = processSubscriptionsWorkflow;
const workflow_1 = require("@temporalio/workflow");
const { fetchDueSubscriptionsActivity, processSubscriptionRenewalActivity, notifySubscriptionRenewalActivity } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: '5m',
    retry: {
        initialInterval: '1m',
        maximumAttempts: 3
    }
});
async function processSubscriptionsWorkflow() {
    console.log('🔄 Starting processSubscriptionsWorkflow (Cron)...');
    let processed = 0;
    let errors = 0;
    try {
        const subscriptions = await fetchDueSubscriptionsActivity();
        for (const sub of subscriptions) {
            try {
                const renewalData = await processSubscriptionRenewalActivity(sub);
                await notifySubscriptionRenewalActivity({
                    sub,
                    renewalData
                });
                processed++;
            }
            catch (err) {
                console.error(`❌ Error processing subscription ${sub.id}:`, err);
                errors++;
            }
        }
    }
    catch (err) {
        console.error('❌ Error fetching due subscriptions:', err);
        throw err;
    }
    console.log(`✅ processSubscriptionsWorkflow completed. Processed: ${processed}, Errors: ${errors}`);
    return { processed, errors };
}
