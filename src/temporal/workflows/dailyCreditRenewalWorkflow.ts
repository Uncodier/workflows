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
  
  // 1. First, check for any sites that need initialization (missing credits)
  try {
    console.log('🔍 Checking for sites needing initialization...');
    const sitesToInit = await fetchSitesNeedingInitializationActivity();
    console.log(`Found ${sitesToInit.length} sites needing initialization.`);
    
    for (const siteId of sitesToInit) {
      try {
        await initializeSiteCreditsActivity(siteId);
        initialized++;
      } catch (err) {
        console.error(`Failed to initialize credits for site ${siteId}:`, err);
        initErrors++;
      }
    }
  } catch (err) {
    console.error('Failed to fetch sites for initialization:', err);
    // Continue with renewal even if initialization fails
  }

  // 2. Then proceed with normal credit renewal for existing billing records
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
  
  console.log(`✅ Daily credit renewal completed.`);
  console.log(`   - Initialized: ${initialized} (Errors: ${initErrors})`);
  console.log(`   - Renewed: ${processed} (Errors: ${errors})`);
  
  return { processed, errors, initialized, initErrors };
}
