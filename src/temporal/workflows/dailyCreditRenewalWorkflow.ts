import { proxyActivities } from '@temporalio/workflow';
import type { Activities } from '../activities';

const { fetchSitesDueForCreditRenewalActivity, renewSiteCreditsActivity } = proxyActivities<Activities>({
  startToCloseTimeout: '5m',
});

export async function dailyCreditRenewalWorkflow(): Promise<{ processed: number; errors: number }> {
  console.log('🔄 Starting daily credit renewal workflow...');
  
  let processed = 0;
  let errors = 0;
  
  try {
    const sitesDue = await fetchSitesDueForCreditRenewalActivity();
    console.log(`Found ${sitesDue.length} sites due for renewal.`);
    
    for (const site of sitesDue) {
      try {
        await renewSiteCreditsActivity(site.site_id, site.plan, site.credits_available);
        processed++;
      } catch (err) {
        console.error(`Failed to renew credits for site ${site.site_id}:`, err);
        errors++;
      }
    }
  } catch (err) {
    console.error('Failed to fetch sites due for renewal:', err);
    throw err;
  }
  
  console.log(`✅ Daily credit renewal completed. Processed: ${processed}, Errors: ${errors}`);
  return { processed, errors };
}
