import { proxyActivities } from '@temporalio/workflow';
import type { Activities } from '../activities';

const { 
  fetchSitesDueForCreditRenewalActivity, 
  renewSiteCreditsActivity,
  fetchSitesNeedingInitializationActivity,
  initializeSiteCreditsActivity
} = proxyActivities<Activities>({
  startToCloseTimeout: '5m',
});

export async function dailyCreditRenewalWorkflow(): Promise<{ processed: number; errors: number; initialized: number; initErrors: number }> {
  console.log('🔄 Starting daily credit renewal workflow...');
  
  let initialized = 0;
  let initErrors = 0;
  let processed = 0;
  let errors = 0;
  
  // 1. Atomic one-time initialization, never an emergency balance top-up.
  try {
    console.log('🔍 Checking for sites needing initialization...');
    const sitesToInit = await fetchSitesNeedingInitializationActivity();
    console.log(`Found ${sitesToInit.length} sites needing initialization.`);
    
    for (const siteId of sitesToInit) {
      try {
        const result = await initializeSiteCreditsActivity(siteId);
        // Undefined is the result recorded by pre-RPC activity histories.
        if (!result || result.outcome === 'initialized') initialized++;
      } catch (err) {
        console.error(`Failed to initialize credits for site ${siteId}:`, err);
        initErrors++;
      }
    }
  } catch (err) {
    console.error('Failed to fetch sites for initialization:', err);
    // Continue with renewal even if initialization fails
  }

  // 2. DB decides due periods/Stripe ownership. Discovery rows are only hints.
  try {
    const sitesDue = await fetchSitesDueForCreditRenewalActivity();
    console.log(`Found ${sitesDue.length} renewal candidates.`);
    
    for (const site of sitesDue) {
      try {
        const result = await renewSiteCreditsActivity(site.site_id, site.plan, site.credits_available, site.stripe_subscription_id);
        // Old histories had no outcome; retain their accounting on replay.
        if (!('outcome' in result) || result.outcome === 'reset') processed++;
      } catch (err) {
        console.error(`Failed to renew credits for site ${site.site_id}:`, err);
        errors++;
      }
    }
  } catch (err) {
    console.error('Failed to fetch sites due for renewal:', err);
    throw err;
  }
  
  console.log(`✅ Daily credit renewal completed.`);
  console.log(`   - Initialized: ${initialized} (Errors: ${initErrors})`);
  console.log(`   - Renewed: ${processed} (Errors: ${errors})`);
  
  return { processed, errors, initialized, initErrors };
}
