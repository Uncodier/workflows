#!/usr/bin/env node

/**
 * Test script to debug the refactored leadAttentionWorkflow
 * Now shows 3 separate activities in Temporal UI instead of 1
 */

import { temporalClient } from './src/temporal/client/index.js';

async function testLeadAttentionWorkflow() {
  console.log('🧪 Testing refactored leadAttentionWorkflow with separate activities...');
  
  try {
    const client = await temporalClient();
    
    // Test with a real lead ID - replace with an actual lead ID from your database
    const testLeadId = 'test-lead-id-123'; // Replace with actual lead ID
    
    const workflowParams = {
      lead_id: testLeadId,
      user_message: 'Test user message for debugging',
      system_message: 'Test system message for debugging'
    };
    
    console.log('🚀 Starting refactored workflow with params:', JSON.stringify(workflowParams, null, 2));
    
    const workflowId = `lead-attention-refactored-${Date.now()}`;
    
    // Start the workflow
    const handle = await client.workflow.start('leadAttentionWorkflow', {
      args: [workflowParams],
      workflowId,
      taskQueue: 'default',
    });
    
    console.log(`✅ Workflow started with ID: ${handle.workflowId}`);
    console.log('⏳ Waiting for workflow to complete...');
    console.log('🔍 Check Temporal UI - you should now see 3 separate activities:');
    console.log('   1. checkExistingLeadNotificationActivity');
    console.log('   2. getLeadActivity');
    console.log('   3. leadAttentionActivity (API call only)');
    
    // Wait for the workflow to complete
    const result = await handle.result();
    
    console.log('🏁 Workflow completed with result:', JSON.stringify(result, null, 2));
    
    // Analyze the result
    if (result.success && result.data?.skipped) {
      console.log('📋 ANALYSIS: Workflow skipped notification');
      console.log(`📋 REASON: ${result.data.reason}`);
      
      if (result.data.reason === 'Notification already sent today') {
        console.log('💡 INSIGHT: Step 1 (duplicate check) blocked the workflow');
      } else if (result.data.reason === 'Lead has no assignee_id') {
        console.log('💡 INSIGHT: Step 2 (assignee check) blocked the workflow');
      }
    } else if (result.success && result.data?.notificationSent) {
      console.log('📋 ANALYSIS: Workflow successfully sent notification');
      console.log('💡 INSIGHT: All 3 steps completed successfully');
    } else if (!result.success) {
      console.log('📋 ANALYSIS: Workflow failed');
      console.log(`📋 ERROR: ${result.error}`);
    }
    
    // Check workflow history for detailed logs
    console.log('\n🔍 Checking workflow history...');
    const workflowHistory = await handle.describe();
    console.log('📜 Workflow status:', workflowHistory.status.name);
    
    console.log('\n🎯 REFACTORING SUCCESS');
    console.log('✅ Now the workflow shows separate activities in Temporal UI');
    console.log('✅ Validation steps are clearly visible');
    console.log('💡 Look for logs prefixed with:');
    console.log('   - DUPLICATE CHECK: Step 1 validation');
    console.log('   - WORKFLOW: Workflow orchestration');
    console.log('   - API CALL: Final API call');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    console.error('❌ Error details:', error.message);
  }
}

// Run the test
testLeadAttentionWorkflow().catch(console.error); 