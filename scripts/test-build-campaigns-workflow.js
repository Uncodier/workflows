#!/usr/bin/env node

/**
 * Script to test the buildCampaignsWorkflow
 * This script demonstrates how to trigger the campaign building workflow
 */

const { getTemporalClient } = require('../dist/temporal/client.js');
const { buildCampaignsWorkflow } = require('../dist/temporal/workflows/index.js');

async function testBuildCampaignsWorkflow() {
  try {
    console.log('🚀 Testing Build Campaigns Workflow...\n');

    // Get Temporal client
    console.log('📡 Connecting to Temporal server...');
    const client = await getTemporalClient();
    console.log('✅ Connected to Temporal server\n');

    // Test case 1: Basic workflow execution
    console.log('📋 Test Case 1: Basic campaign building workflow');
    const workflowId1 = `test-build-campaigns-${Date.now()}`;
    
    const workflowOptions1 = {
      siteId: 'site_test_123',
      userId: 'user_test_456',
      agentId: 'agent_growth_789',
      additionalCampaignData: {
        strategy: 'growth',
        priority: 'high',
        budget: 1000
      }
    };

    console.log('📊 Workflow options:', JSON.stringify(workflowOptions1, null, 2));

    console.log(`⚡ Starting workflow: ${workflowId1}`);
    const handle1 = await client.workflow.start('buildCampaignsWorkflow', {
      args: [workflowOptions1],
      workflowId: workflowId1,
      taskQueue: 'default-task-queue',
      workflowRunTimeout: '30 minutes',
    });

    console.log(`✅ Workflow started: ${handle1.workflowId}`);
    console.log('⏳ Waiting for workflow to complete...\n');

    // Wait for result
    try {
      const result1 = await handle1.result();
      console.log('🎉 Workflow completed successfully!');
      console.log('📊 Result:', JSON.stringify(result1, null, 2));
    } catch (error) {
      console.log('⚠️  Workflow execution result:', error.message);
      // This is expected in test environment without real API endpoints
    }

    console.log('\n' + '='.repeat(60) + '\n');

    // Test case 2: Workflow with minimal parameters
    console.log('📋 Test Case 2: Minimal parameters workflow');
    const workflowId2 = `test-build-campaigns-minimal-${Date.now()}`;
    
    const workflowOptions2 = {
      siteId: 'site_minimal_456'
    };

    console.log('📊 Workflow options:', JSON.stringify(workflowOptions2, null, 2));

    console.log(`⚡ Starting workflow: ${workflowId2}`);
    const handle2 = await client.workflow.start('buildCampaignsWorkflow', {
      args: [workflowOptions2],
      workflowId: workflowId2,
      taskQueue: 'default-task-queue',
      workflowRunTimeout: '30 minutes',
    });

    console.log(`✅ Workflow started: ${handle2.workflowId}`);
    console.log('⏳ Waiting for workflow to complete...\n');

    // Wait for result
    try {
      const result2 = await handle2.result();
      console.log('🎉 Workflow completed successfully!');
      console.log('📊 Result:', JSON.stringify(result2, null, 2));
    } catch (error) {
      console.log('⚠️  Workflow execution result:', error.message);
      // This is expected in test environment without real API endpoints
    }

    console.log('\n' + '='.repeat(60) + '\n');

    // Show workflow status
    console.log('📊 Workflow Status Summary:');
    console.log(`   - Test Workflow 1: ${workflowId1}`);
    console.log(`   - Test Workflow 2: ${workflowId2}`);
    
    console.log('\n✅ Build Campaigns Workflow test completed!');
    console.log('\n📝 What this workflow does:');
    console.log('   1. 🎯 Fetches segments for the specified site');
    console.log('   2. 🚀 Creates campaigns using those segments');
    console.log('   3. 📈 Returns comprehensive results with timing');
    console.log('   4. 📋 Logs execution status to cron table');
    
    console.log('\n🔧 Usage in production:');
    console.log('   - Use scheduleBuildCampaignsWorkflowActivity for scheduling');
    console.log('   - Include proper userId and agentId for tracking');
    console.log('   - Add additionalCampaignData for custom campaign parameters');

  } catch (error) {
    console.error('❌ Error testing build campaigns workflow:', error);
    console.error('Stack:', error.stack);
  }
}

// Run the test
if (require.main === module) {
  testBuildCampaignsWorkflow()
    .then(() => {
      console.log('\n🏁 Test script completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Test script failed:', error);
      process.exit(1);
    });
}

module.exports = { testBuildCampaignsWorkflow }; 