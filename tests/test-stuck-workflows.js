#!/usr/bin/env node

/**
 * Test Stuck Workflows Detection
 * Tests if the system correctly detects and reschedules stuck workflows
 */

require('dotenv').config({ path: '.env.local' });

async function testStuckWorkflows() {
  console.log('🧪 Testing Stuck Workflows Detection...\n');

  try {
    // Import the client after dotenv is loaded
    const { getTemporalClient } = require('../dist/temporal/client');

    console.log('📅 Starting syncEmailsScheduleWorkflow to detect stuck workflows...');
    
    const client = await getTemporalClient();
    
    // Test with very aggressive settings to force detection of stuck workflows
    const handle = await client.workflow.start('syncEmailsScheduleWorkflow', {
      args: [{ 
        dryRun: true, // Dry run first to see what would be scheduled
        minHoursBetweenSyncs: 0.1, // Very short interval (6 minutes)
        forceRescheduleStuck: true, // Force reschedule stuck workflows
        maxSitesToSchedule: 10
      }],
      workflowId: `test-stuck-workflows-${Date.now()}`,
      taskQueue: 'default',
    });

    console.log(`✅ Workflow started: ${handle.workflowId}`);
    console.log('⏳ Waiting for workflow to complete...\n');

    const result = await handle.result();
    console.log('📊 Stuck Workflow Detection Results:');
    console.log(JSON.stringify(result, null, 2));
    console.log('');

    console.log('🎉 Stuck workflow detection test completed!');
    console.log('');
    console.log('📋 Summary:');
    console.log(`   - Workflow completed: ${result.success ? '✅' : '❌'}`);
    console.log(`   - Sites analyzed: ${result.sitesAnalyzed || 'N/A'}`);
    console.log(`   - Sites would schedule: ${result.sitesWouldSchedule || 0}`);
    console.log(`   - Sites would skip: ${result.sitesWouldSkip || 0}`);

    if (result.sites && result.sites.length > 0) {
      console.log('\n📋 Sites that would be scheduled:');
      result.sites.forEach(site => {
        console.log(`   - ${site.name}: ${site.reason}`);
      });
    }

    // If we found stuck workflows in dry run, test actual rescheduling
    if (result.sitesWouldSchedule > 0) {
      console.log('\n🔄 Found stuck workflows! Testing actual rescheduling...');
      
      const realHandle = await client.workflow.start('syncEmailsScheduleWorkflow', {
        args: [{ 
          dryRun: false, // Real scheduling
          minHoursBetweenSyncs: 0.1,
          forceRescheduleStuck: true,
          maxSitesToSchedule: 3 // Limit for safety
        }],
        workflowId: `real-stuck-reschedule-${Date.now()}`,
        taskQueue: 'default',
      });

      console.log(`✅ Real rescheduling workflow started: ${realHandle.workflowId}`);
      console.log('⏳ Waiting for real rescheduling to complete...\n');

      const realResult = await realHandle.result();
      console.log('📊 Real Rescheduling Results:');
      console.log(JSON.stringify(realResult, null, 2));
      console.log('');
      
      console.log('📋 Real Rescheduling Summary:');
      console.log(`   - Sites scheduled: ${realResult.sitesScheduled || 0}`);
      console.log(`   - Sites failed: ${realResult.sitesFailed || 0}`);
      
      if (realResult.errors && realResult.errors.length > 0) {
        console.log('❌ Errors encountered:');
        realResult.errors.forEach((error, index) => {
          console.log(`   ${index + 1}. ${error}`);
        });
      }
    } else {
      console.log('\n✅ No stuck workflows detected - system is working correctly!');
    }

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
  testStuckWorkflows()
    .then(() => {
      console.log('\n✅ Stuck workflow detection test completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Stuck workflow detection test failed:', error);
      process.exit(1);
    });
}

module.exports = { testStuckWorkflows }; 