import { proxyActivities } from '@temporalio/workflow';
import type { Activities } from '../activities';

const {
  fetchDueSubscriptionsActivity,
  processSubscriptionRenewalActivity,
  notifySubscriptionRenewalActivity
} = proxyActivities<Activities>({
  startToCloseTimeout: '5m',
  retry: {
    initialInterval: '1m',
    maximumAttempts: 3
  }
});

export async function processSubscriptionsWorkflow(): Promise<{ processed: number; errors: number }> {
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
      } catch (err) {
        console.error(`❌ Error processing subscription ${sub.id}:`, err);
        errors++;
      }
    }
  } catch (err) {
    console.error('❌ Error fetching due subscriptions:', err);
    throw err;
  }

  console.log(`✅ processSubscriptionsWorkflow completed. Processed: ${processed}, Errors: ${errors}`);

  return { processed, errors };
}
