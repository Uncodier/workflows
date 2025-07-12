#!/usr/bin/env tsx

/**
 * Test script for leadAttentionWorkflow
 * Tests both scenarios: with and without assignee_id
 */

import { leadAttentionWorkflow } from '../temporal/workflows/leadAttentionWorkflow';

async function main() {
  console.log('🧪 Starting leadAttentionWorkflow test...');

  // Create Temporal client
  const { Connection, Client } = require('@temporalio/client');
  
  const connection = await Connection.connect({
    address: process.env.TEMPORAL_SERVER_URL || 'localhost:7233',
  });
  
  const client = new Client({
    connection,
    namespace: process.env.TEMPORAL_NAMESPACE || 'default',
  });

  // Test cases
  const testCases = [
    {
      name: 'Test with lead that has assignee_id',
      lead_id: 'test-lead-with-assignee',
      description: 'Should send notification'
    },
    {
      name: 'Test with lead that has no assignee_id',
      lead_id: 'test-lead-no-assignee',
      description: 'Should skip notification'
    }
  ];

  for (const testCase of testCases) {
    console.log(`\n📋 Running: ${testCase.name}`);
    console.log(`   ${testCase.description}`);

    try {
      const workflowId = `test-lead-attention-${testCase.lead_id}-${Date.now()}`;
      
      console.log(`🚀 Starting workflow: ${workflowId}`);
      
      const handle = await client.workflow.start(leadAttentionWorkflow, {
        workflowId,
        taskQueue: 'default',
        args: [{
          lead_id: testCase.lead_id
        }]
      });

      console.log(`⏱️ Waiting for workflow result...`);
      const result = await handle.result();

      console.log(`✅ Test completed:`, {
        success: result.success,
        skipped: result.data?.skipped,
        notificationSent: result.data?.notificationSent,
        reason: result.data?.reason,
        assigneeId: result.data?.assigneeId,
        leadInfo: result.data?.leadInfo,
        executionTime: result.executionTime,
        error: result.error
      });

      if (result.success && result.data?.skipped) {
        console.log(`⏭️ Notification skipped: ${result.data.reason}`);
      } else if (result.success && result.data?.notificationSent) {
        console.log(`📨 Notification sent to assignee: ${result.data.assigneeId}`);
      } else if (!result.success) {
        console.log(`❌ Test failed: ${result.error}`);
      }

    } catch (error) {
      console.error(`❌ Test failed with exception:`, error);
    }
  }

  console.log('\n🏁 All tests completed!');
  
  // Close the connection
  await connection.close();
}

// Run the test
main().catch(console.error); 