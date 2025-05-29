/**
 * Test script for syncEmailsScheduleWorkflow
 */

// Load environment variables from .env.local
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { getTemporalClient } from '../src/temporal/client';
import { workflows } from '../src/temporal/workflows';

async function testSyncEmailsScheduleWorkflow() {
  console.log('🚀 Testing syncEmailsScheduleWorkflow...');
  console.log('=====================================\n');

  try {
    // Use the configured Temporal client
    const client = await getTemporalClient();
    console.log('🔗 Connected to Temporal server\n');

    // Test 1: Normal execution
    console.log('📋 Test 1: Normal execution');
    console.log('---------------------------');
    
    const workflowId = `sync-emails-schedule-test-${Date.now()}`;
    
    const handle = await client.workflow.start(workflows.syncEmailsScheduleWorkflow, {
      taskQueue: 'default',
      workflowId,
      args: [{}], // Default options
    });

    console.log(`✅ Workflow started with ID: ${workflowId}`);
    console.log('⏳ Waiting for workflow to complete...\n');

    const result = await handle.result();
    
    console.log('🎉 Workflow completed successfully!');
    console.log('📊 Results:');
    console.log(JSON.stringify(result, null, 2));
    console.log('');

    // Test 2: Dry run mode
    console.log('📋 Test 2: Dry run mode');
    console.log('-----------------------');
    
    const dryRunWorkflowId = `sync-emails-schedule-dryrun-${Date.now()}`;
    
    const dryRunHandle = await client.workflow.start(workflows.syncEmailsScheduleWorkflow, {
      taskQueue: 'default',
      workflowId: dryRunWorkflowId,
      args: [{ dryRun: true }],
    });

    console.log(`✅ Dry run workflow started with ID: ${dryRunWorkflowId}`);
    console.log('⏳ Waiting for dry run to complete...\n');

    const dryRunResult = await dryRunHandle.result();
    
    console.log('🎉 Dry run completed successfully!');
    console.log('📊 Dry run results:');
    console.log(JSON.stringify(dryRunResult, null, 2));

    console.log('\n🎉 All tests completed successfully!');
    console.log('====================================');

  } catch (error) {
    console.error('❌ Error running workflow:', error);
    if (error instanceof Error) {
      console.error('Stack trace:', error.stack);
    }
    process.exit(1);
  }
}

// Run the test
testSyncEmailsScheduleWorkflow()
  .then(() => {
    console.log('\n✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error: unknown) => {
    console.error('❌ Script failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }); 