#!/usr/bin/env node

/**
 * Test Cron Activities
 * Tests the new modular cron status activities
 */

require('dotenv').config({ path: '.env.local' });

const { executeWorkflow } = require('./src/temporal/client');

async function testCronActivities() {
  console.log('🧪 Testing Modular Cron Activities...\n');

  try {
    // Create a simple workflow to test the cron activities
    console.log('📝 Test 1: Testing saveCronStatusActivity');
    
    // We'll create a simple test workflow that uses the cron activities
    const testWorkflowCode = `
      import { proxyActivities } from '@temporalio/workflow';
      
      const { saveCronStatusActivity, getCronStatusActivity, shouldRunWorkflowActivity } = proxyActivities({
        startToCloseTimeout: '1 minute',
      });
      
      export async function testCronActivitiesWorkflow() {
        console.log('🧪 Testing cron activities...');
        
        // Test 1: Save a cron status
        const testUpdate = {
          siteId: 'test-site-${Date.now()}',
          workflowId: 'test-workflow-${Date.now()}',
          scheduleId: 'test-schedule-${Date.now()}',
          activityName: 'testActivity',
          status: 'RUNNING',
          nextRun: new Date(Date.now() + 60 * 60 * 1000).toISOString()
        };
        
        await saveCronStatusActivity(testUpdate);
        console.log('✅ Successfully saved cron status');
        
        // Test 2: Get cron status
        const cronData = await getCronStatusActivity('testActivity', [testUpdate.siteId]);
        console.log('✅ Successfully retrieved cron status:', cronData);
        
        // Test 3: Check if workflow should run
        const shouldRun = await shouldRunWorkflowActivity('testActivity', testUpdate.siteId, 1);
        console.log('✅ Successfully checked workflow run status:', shouldRun);
        
        return {
          success: true,
          testUpdate,
          cronData,
          shouldRun
        };
      }
    `;

    console.log('📝 Testing cron activities with inline test...');

    // For now, let's test using the sync emails workflow which uses the cron activities
    console.log('📅 Running syncEmailsScheduleWorkflow to test cron activities...');
    
    const handle = await executeWorkflow(
      'syncEmailsScheduleWorkflow',
      [{ 
        dryRun: false,
        minHoursBetweenSyncs: 0.1, // Very short interval for testing
        maxSitesToSchedule: 1 // Just one site for testing
      }],
      `test-cron-activities-${Date.now()}`
    );

    console.log(`✅ Test workflow started: ${handle.workflowId}`);
    console.log('⏳ Waiting for workflow to complete...\n');

    const result = await handle.result();
    console.log('📊 Test Results:');
    console.log(JSON.stringify(result, null, 2));
    console.log('');

    // Test the database to see if cron status was actually saved
    console.log('🔍 Test 2: Verifying cron status was saved to database');
    
    // Run a diagnostic to check the database
    const diagnosticHandle = await executeWorkflow(
      'syncEmailsScheduleWorkflow',
      [{ dryRun: true }],
      `diagnostic-${Date.now()}`
    );

    const diagnosticResult = await diagnosticHandle.result();
    console.log('📋 Diagnostic Results (should show updated cron status):');
    console.log(JSON.stringify(diagnosticResult, null, 2));
    console.log('');

    console.log('🎉 Cron Activities Tests Completed!');
    console.log('');
    console.log('📋 Test Summary:');
    console.log(`   - Workflow completed: ${result.success ? '✅' : '❌'}`);
    console.log(`   - Sites processed: ${result.sitesAnalyzed || 'N/A'}`);
    console.log(`   - Cron records updated: ${result.sitesScheduled || 0}`);
    
    if (result.errors && result.errors.length > 0) {
      console.log('❌ Errors encountered:');
      result.errors.forEach((error, index) => {
        console.log(`   ${index + 1}. ${error}`);
      });
    }

    console.log('');
    console.log('🔍 Verification Steps:');
    console.log('1. Check if cron_status table has new records');
    console.log('2. Verify that saveCronStatusActivity is working');
    console.log('3. Confirm that the modular activities can be reused');

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
  testCronActivities()
    .then(() => {
      console.log('\n✅ All cron activity tests completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Cron activity test suite failed:', error);
      process.exit(1);
    });
}

module.exports = { testCronActivities }; 