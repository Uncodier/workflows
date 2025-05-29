#!/usr/bin/env node

/**
 * Debug Scheduling Logic
 * Debug script to understand why the failed workflow isn't being scheduled
 */

require('dotenv').config({ path: '.env.local' });

async function debugSchedulingLogic() {
  console.log('🔍 Debugging Email Sync Scheduling Logic...\n');

  try {
    // Import the services
    const { getSupabaseService } = require('../dist/temporal/services/supabaseService');
    const { EmailSyncSchedulingService } = require('../dist/temporal/services/EmailSyncSchedulingService');

    console.log('📂 Step 1: Fetching sites and cron status...');
    
    // Get Supabase service instance
    const supabaseService = getSupabaseService();
    
    // Get sites with email enabled
    const sites = await supabaseService.fetchSitesWithEmailEnabled();
    console.log(`✅ Found ${sites.length} sites with email enabled`);

    // Get cron statuses
    const cronStatuses = await supabaseService.fetchCronStatus(
      'syncEmailsWorkflow',
      sites.map(site => site.id)
    );
    console.log(`✅ Found ${cronStatuses.length} cron status records`);

    console.log('\n🔍 Step 2: Analyzing each site individually...');

    for (const site of sites) {
      console.log(`\n📧 Site: ${site.name} (${site.id})`);
      
      const cronStatus = cronStatuses.find(cron => cron.site_id === site.id);
      
      if (cronStatus) {
        console.log(`   - Status: ${cronStatus.status}`);
        console.log(`   - Last Run: ${cronStatus.last_run}`);
        console.log(`   - Retry Count: ${cronStatus.retry_count}`);
        console.log(`   - Created At: ${cronStatus.created_at}`);
        console.log(`   - Updated At: ${cronStatus.updated_at}`);

        // Calculate time differences manually
        const now = Date.now();
        const lastRunTime = cronStatus.last_run ? new Date(cronStatus.last_run).getTime() : 0;
        const minutesSinceLastRun = (now - lastRunTime) / (1000 * 60);
        const hoursSinceLastRun = minutesSinceLastRun / 60;

        console.log(`   - Minutes since last run: ${minutesSinceLastRun.toFixed(1)}`);
        console.log(`   - Hours since last run: ${hoursSinceLastRun.toFixed(1)}`);
        console.log(`   - Should retry after 15 minutes: ${minutesSinceLastRun >= 15 ? 'YES' : 'NO'}`);

        if (cronStatus.status === 'FAILED') {
          console.log(`   - Retry logic: ${cronStatus.retry_count}/3 attempts`);
          console.log(`   - Ready for retry: ${minutesSinceLastRun >= 15 ? 'YES' : 'NO'}`);
        }
      } else {
        console.log(`   - No cron status found`);
      }

      // Prepare site data in the format expected by determineSiteScheduling
      const siteData = {
        id: site.id,
        name: site.name,
        user_id: site.user_id,
        email: site.emailSettings || null
      };

      // Test the determineSiteScheduling method directly
      console.log('\n   🧪 Testing determineSiteScheduling...');
      
      const schedulingResult = EmailSyncSchedulingService.determineSiteScheduling(
        siteData,
        cronStatus,
        {
          minHoursBetweenSyncs: 1,
          maxRetryCount: 3
        }
      );

      console.log(`   - Should Schedule: ${schedulingResult.shouldSchedule}`);
      console.log(`   - Reason: ${schedulingResult.reason}`);
      console.log(`   - Has Valid Email Config: ${schedulingResult.hasValidEmailConfig}`);
    }

    console.log('\n🎯 Step 3: Testing full processSitesForScheduling...');
    
    // Prepare sites data for processSitesForScheduling
    const sitesData = sites.map(site => ({
      id: site.id,
      name: site.name,
      user_id: site.user_id,
      email: site.emailSettings || null
    }));
    
    const processedSites = EmailSyncSchedulingService.processSitesForScheduling(
      sitesData,
      cronStatuses,
      {
        minHoursBetweenSyncs: 1,
        maxRetryCount: 3,
        dryRun: true
      }
    );

    console.log('\n📊 Final Results:');
    processedSites.forEach(site => {
      console.log(`   ${site.shouldSchedule ? '✅' : '❌'} ${site.name}: ${site.reason}`);
    });

  } catch (error) {
    console.error('❌ Debug failed:', error);
    console.error('Error details:', {
      name: error.name,
      message: error.message,
      stack: error.stack
    });
  }
}

// Only run if called directly
if (require.main === module) {
  debugSchedulingLogic()
    .then(() => {
      console.log('\n✅ Debug completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Debug failed:', error);
      process.exit(1);
    });
}

module.exports = { debugSchedulingLogic }; 