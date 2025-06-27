#!/usr/bin/env tsx

/**
 * Test script for Daily Stand Up Workflow
 * Executes the CMO daily stand up workflow for a specific site
 */

import { getTemporalClient } from '../temporal/client';
import { dailyStandUpWorkflow, type DailyStandUpOptions, type DailyStandUpResult } from '../temporal/workflows/dailyStandUpWorkflow';

async function testDailyStandUpWorkflow() {
  console.log('🎯 Testing CMO Daily Stand Up Workflow...\n');

  const client = await getTemporalClient();

  // Test configuration
  const testOptions: DailyStandUpOptions = {
    site_id: 'test-site-123', // Replace with actual site ID
    userId: 'test-user-456',  // Replace with actual user ID
    runParallel: false,       // Set to true to test parallel execution
    additionalData: {
      testRun: true,
      testTimestamp: new Date().toISOString()
    }
  };

  console.log('📋 Test configuration:');
  console.log(JSON.stringify(testOptions, null, 2));
  console.log('\n');

  try {
    // Start the workflow
    const workflowId = `test-daily-standup-${Date.now()}`;
    
    console.log(`🚀 Starting Daily Stand Up workflow with ID: ${workflowId}`);
    
    const handle = await client.workflow.start(dailyStandUpWorkflow, {
      args: [testOptions],
      taskQueue: 'default',
      workflowId: workflowId,
    });

    console.log(`✅ Workflow started successfully`);
    console.log(`🔗 Workflow ID: ${handle.workflowId}`);
    console.log(`📋 Workflow Run ID: ${handle.firstExecutionRunId}`);
    console.log('\n⏳ Waiting for workflow completion...\n');

    // Wait for the workflow to complete
    const result: DailyStandUpResult = await handle.result();

    console.log('🎉 Daily Stand Up Workflow completed!\n');
    
    // Display results
    console.log('📊 Workflow Results:');
    console.log(`   - Success: ${result.success}`);
    console.log(`   - Site ID: ${result.siteId}`);
    console.log(`   - Site Name: ${result.siteName || 'N/A'}`);
    console.log(`   - Site URL: ${result.siteUrl || 'N/A'}`);
    console.log(`   - Command ID: ${result.command_id || 'N/A'}`);
    console.log(`   - Execution Time: ${result.executionTime}`);
    console.log(`   - Completed At: ${result.completedAt}`);
    console.log(`   - Errors: ${result.errors.length}`);
    
    if (result.errors.length > 0) {
      console.log('\n❌ Errors encountered:');
      result.errors.forEach((error, index) => {
        console.log(`   ${index + 1}. ${error}`);
      });
    }

    // Display analysis results
    console.log('\n📈 Analysis Results:');
    console.log(`   - System Analysis: ${result.systemAnalysis?.success ? '✅ Success' : '❌ Failed'}`);
    if (result.systemAnalysis?.command_id) {
      console.log(`     Command ID: ${result.systemAnalysis.command_id}`);
    }
    if (result.systemAnalysis?.summary) {
      console.log(`     Summary: ${result.systemAnalysis.summary.substring(0, 100)}...`);
    }

    console.log(`   - Sales Analysis: ${result.salesAnalysis?.success ? '✅ Success' : '❌ Failed'}`);
    if (result.salesAnalysis?.command_id) {
      console.log(`     Command ID: ${result.salesAnalysis.command_id}`);
    }
    if (result.salesAnalysis?.summary) {
      console.log(`     Summary: ${result.salesAnalysis.summary.substring(0, 100)}...`);
    }

    console.log(`   - Support Analysis: ${result.supportAnalysis?.success ? '✅ Success' : '❌ Failed'}`);
    if (result.supportAnalysis?.command_id) {
      console.log(`     Command ID: ${result.supportAnalysis.command_id}`);
    }
    if (result.supportAnalysis?.summary) {
      console.log(`     Summary: ${result.supportAnalysis.summary.substring(0, 100)}...`);
    }

    console.log(`   - Growth Analysis: ${result.growthAnalysis?.success ? '✅ Success' : '❌ Failed'}`);
    if (result.growthAnalysis?.command_id) {
      console.log(`     Command ID: ${result.growthAnalysis.command_id}`);
    }
    if (result.growthAnalysis?.summary) {
      console.log(`     Summary: ${result.growthAnalysis.summary.substring(0, 100)}...`);
    }

    // Display final summary
    if (result.finalSummary) {
      console.log('\n📋 Final Summary:');
      console.log(`   ${result.finalSummary.substring(0, 200)}...`);
    }

    console.log('\n✅ Test completed successfully!');

  } catch (error) {
    console.error('❌ Test failed:', error);
    
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      console.error('Stack trace:', error.stack);
    }
    
    process.exit(1);
  }
}

// Run the test
if (require.main === module) {
  testDailyStandUpWorkflow()
    .then(() => {
      console.log('\n🎯 Daily Stand Up Workflow test completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Daily Stand Up Workflow test failed:', error);
      process.exit(1);
    });
}

export { testDailyStandUpWorkflow }; 