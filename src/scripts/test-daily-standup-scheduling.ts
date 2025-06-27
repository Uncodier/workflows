#!/usr/bin/env tsx

/**
 * Test script for Daily Stand Up Scheduling Activity
 * Tests the scheduling of dailyStandUp workflows for all sites based on business_hours
 */

import { executeDailyStandUpWorkflowsActivity } from '../temporal/activities/workflowSchedulingActivities';

async function testDailyStandUpScheduling() {
  console.log('🌅 Testing Daily Stand Up Workflow Scheduling...\n');

  try {
    console.log('📋 Test 1: Dry Run Mode');
    console.log('-------------------------');
    
    // Test dry run to see what would be scheduled
    const dryRunResult = await executeDailyStandUpWorkflowsActivity({
      dryRun: true,
      testMode: true
    });

    console.log('\n🧪 Dry Run Results:');
    console.log(`   - Sites that would be scheduled: ${dryRunResult.scheduled}`);
    console.log(`   - Sites that would be skipped: ${dryRunResult.skipped}`);
    console.log(`   - Sites with errors: ${dryRunResult.failed}`);
    
    if (dryRunResult.errors.length > 0) {
      console.log('\n❌ Errors found:');
      dryRunResult.errors.forEach((error: string, index: number) => {
        console.log(`   ${index + 1}. ${error}`);
      });
    }

    // Ask user if they want to proceed with actual scheduling
    console.log('\n🤔 Do you want to proceed with actual scheduling?');
    console.log('   This will create actual Temporal schedules for Daily Stand Up workflows.');
    console.log('   Type "yes" to proceed or anything else to exit:');

    // For automated testing, we'll skip the actual scheduling
    // In a real scenario, you could use readline to get user input
    const proceedWithScheduling = false; // Set to true if you want to test actual scheduling

    if (proceedWithScheduling) {
      console.log('\n📋 Test 2: Actual Scheduling');
      console.log('-----------------------------');
      
      const actualResult = await executeDailyStandUpWorkflowsActivity({
        dryRun: false,
        testMode: true
      });

      console.log('\n✅ Actual Scheduling Results:');
      console.log(`   - Sites scheduled: ${actualResult.scheduled}`);
      console.log(`   - Sites skipped: ${actualResult.skipped}`);
      console.log(`   - Sites with errors: ${actualResult.failed}`);
      
      if (actualResult.errors.length > 0) {
        console.log('\n❌ Errors during scheduling:');
        actualResult.errors.forEach((error: string, index: number) => {
          console.log(`   ${index + 1}. ${error}`);
        });
      }

      console.log('\n📋 Schedule Results:');
      actualResult.results.forEach((result: any, index: number) => {
        console.log(`   ${index + 1}. ${result.success ? '✅' : '❌'} ${result.scheduleId}`);
        if (!result.success && result.error) {
          console.log(`      Error: ${result.error}`);
        }
      });
    } else {
      console.log('\n⏭️  Skipping actual scheduling (test mode)');
    }

    console.log('\n🎉 Daily Stand Up Scheduling test completed!');

  } catch (error) {
    console.error('❌ Error during test:', error);
    process.exit(1);
  }
}

// Run the test if this script is executed directly
if (require.main === module) {
  testDailyStandUpScheduling()
    .then(() => {
      console.log('\n👋 Test completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Test failed:', error);
      process.exit(1);
    });
}

export { testDailyStandUpScheduling }; 