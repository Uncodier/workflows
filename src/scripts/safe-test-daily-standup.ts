#!/usr/bin/env tsx

/**
 * ULTRA SAFE Test for Daily Stand Up Scheduling
 * This script is designed to be 100% safe for testing
 */

import { executeDailyStandUpWorkflowsActivity } from '../temporal/activities/workflowSchedulingActivities';

async function safeTestDailyStandUp() {
  console.log('🛡️  ULTRA SAFE Daily Stand Up Test');
  console.log('='.repeat(50));
  console.log('✅ DRY RUN ONLY - No real schedules will be created');
  console.log('✅ Limited to max 2 sites');
  console.log('✅ Test mode with safety checks');
  console.log('='.repeat(50));

  try {
    console.log('\n🧪 Testing Daily Stand Up scheduling...');
    
    const result = await executeDailyStandUpWorkflowsActivity({
      dryRun: true,        // FORCE dry run - no real schedules
      testMode: true,      // FORCE test mode - extra safety
      maxSites: 2          // FORCE limit to 2 sites max
    });

    console.log('\n📊 Test Results:');
    console.log(`   - Sites that would be scheduled: ${result.scheduled}`);
    console.log(`   - Sites that would fail: ${result.failed}`);
    console.log(`   - Sites that would be skipped: ${result.skipped}`);
    
    if (result.testInfo) {
      console.log('\n🔍 Test Info:');
      console.log(`   - Mode: ${result.testInfo.mode}`);
      console.log(`   - Test mode: ${result.testInfo.testMode}`);
      console.log(`   - Max sites: ${result.testInfo.maxSites}`);
      console.log(`   - Sites processed: ${result.testInfo.sitesProcessed}`);
      console.log(`   - Duration: ${result.testInfo.duration}`);
      
      if (result.testInfo.siteNames && result.testInfo.siteNames.length > 0) {
        console.log(`   - Site names: ${result.testInfo.siteNames.join(', ')}`);
      }
    }

    if (result.errors.length > 0) {
      console.log('\n⚠️  Errors found:');
      result.errors.forEach((error: string, index: number) => {
        console.log(`   ${index + 1}. ${error}`);
      });
    } else {
      console.log('\n✅ No errors found!');
    }

    console.log('\n🎉 Safe test completed successfully!');
    console.log('💡 To enable real scheduling, modify the workflow file:');
    console.log('   src/temporal/workflows/activityPrioritizationEngineWorkflow.ts');
    console.log('   Change dryRun: true to dryRun: false');
    
    return result;

  } catch (error) {
    console.error('\n❌ Test failed:', error);
    throw error;
  }
}

// Run the test if this script is executed directly
if (require.main === module) {
  safeTestDailyStandUp()
    .then(() => {
      console.log('\n👋 Safe test completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Safe test failed:', error);
      process.exit(1);
    });
}

export { safeTestDailyStandUp }; 