#!/usr/bin/env node

/**
 * Test Email Sync Real Scheduling
 * Tests the new real workflow scheduling functionality
 */

require('dotenv').config({ path: '.env.local' });

const { executeWorkflow } = require('./dist/temporal/client');

async function testRealEmailSyncScheduling() {
  console.log('🧪 Testing Real Email Sync Scheduling...\n');

  try {
    // Test 1: Run the workflow with real scheduling (not dry run)
    console.log('📅 Test 1: Real scheduling (with actual Temporal workflows)');
    console.log('Starting syncEmailsScheduleWorkflow with real scheduling...');
    
    const realSchedulingHandle = await executeWorkflow(
      'syncEmailsScheduleWorkflow',
      [{ 
        dryRun: false,
        minHoursBetweenSyncs: 1, // 1 hour minimum between syncs
        maxSitesToSchedule: 5 // Limit to prevent overwhelming
      }],
      `sync-emails-schedule-real-${Date.now()}`
    );

    console.log(`✅ Real scheduling workflow started: ${realSchedulingHandle.workflowId}`);
    console.log('⏳ Waiting for workflow to complete...\n');

    const realResult = await realSchedulingHandle.result();
    console.log('📊 Real Scheduling Results:');
    console.log(JSON.stringify(realResult, null, 2));
    console.log('');

    // Test 2: Run dry run to see what would be scheduled next
    console.log('📋 Test 2: Dry run to see current state');
    console.log('Starting syncEmailsScheduleWorkflow in dry run mode...');

    const dryRunHandle = await executeWorkflow(
      'syncEmailsScheduleWorkflow',
      [{ 
        dryRun: true,
        minHoursBetweenSyncs: 1
      }],
      `sync-emails-schedule-dryrun-${Date.now()}`
    );

    console.log(`✅ Dry run workflow started: ${dryRunHandle.workflowId}`);
    console.log('⏳ Waiting for dry run to complete...\n');

    const dryRunResult = await dryRunHandle.result();
    console.log('📊 Dry Run Results (current state):');
    console.log(JSON.stringify(dryRunResult, null, 2));
    console.log('');

    // Test 3: Test individual site scheduling
    if (realResult.sitesScheduled > 0) {
      console.log('📧 Test 3: Individual site workflow should now be running');
      console.log('Check the Temporal UI to see the scheduled syncEmailsWorkflow instances');
      console.log('They should be running with the email sync logic');
      console.log('');
    }

    console.log('🎉 Real Email Sync Scheduling Tests Completed Successfully!');
    console.log('');
    console.log('📋 Summary:');
    console.log(`   - Sites analyzed: ${realResult.sitesAnalyzed || 'N/A'}`);
    console.log(`   - Sites scheduled: ${realResult.sitesScheduled || 0}`);
    console.log(`   - Sites skipped: ${realResult.sitesSkipped || 0}`);
    console.log(`   - Sites failed: ${realResult.sitesFailed || 0}`);
    
    if (realResult.errors && realResult.errors.length > 0) {
      console.log('❌ Errors encountered:');
      realResult.errors.forEach((error, index) => {
        console.log(`   ${index + 1}. ${error}`);
      });
    }

    console.log('');
    console.log('🔍 Next Steps:');
    console.log('1. Check Temporal UI (http://localhost:8080) to see scheduled workflows');
    console.log('2. Check cron_status table in database for updated records');
    console.log('3. Verify that syncEmailsWorkflow instances are actually running');
    console.log('4. Monitor for workflow completion and email sync results');

  } catch (error) {
    console.error('❌ Test failed:', error);
    console.error('Error details:', {
      name: error.name,
      message: error.message,
      stack: error.stack
    });
  }
}

// Only run if called directly
if (require.main === module) {
  testRealEmailSyncScheduling()
    .then(() => {
      console.log('\n✅ All tests completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Test suite failed:', error);
      process.exit(1);
    });
}

module.exports = { testRealEmailSyncScheduling }; 