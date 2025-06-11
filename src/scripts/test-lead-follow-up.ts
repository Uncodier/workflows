#!/usr/bin/env node

/**
 * Test script for leadFollowUpWorkflow
 * Usage: npm run test:lead-follow-up
 */

import { leadFollowUpWorkflow } from '../temporal/workflows/leadFollowUpWorkflow';

const { Connection, Client } = require('@temporalio/client');

async function testLeadFollowUpWorkflow() {
  console.log('🧪 Testing Lead Follow-Up Workflow...\n');

  try {
    // Connect to Temporal
    const connection = await Connection.connect({
      address: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
    });

    const client = new Client({
      connection,
      namespace: process.env.TEMPORAL_NAMESPACE || 'default',
    });

    // Test parameters
    const testOptions = {
      lead_id: process.env.TEST_LEAD_ID || 'test-lead-12345',
      site_id: process.env.TEST_SITE_ID || 'test-site-67890',
      userId: process.env.TEST_USER_ID || 'test-user-11111',
      additionalData: {
        source: 'test-script',
        priority: 'medium',
        notes: 'This is a test execution'
      }
    };

    console.log('📋 Test Configuration:');
    console.log('   - Lead ID:', testOptions.lead_id);
    console.log('   - Site ID:', testOptions.site_id);
    console.log('   - User ID:', testOptions.userId);
    console.log('   - Additional Data:', JSON.stringify(testOptions.additionalData, null, 2));
    console.log('');

    // Generate unique workflow ID
    const workflowId = `test-lead-follow-up-${testOptions.lead_id}-${Date.now()}`;

    console.log('🚀 Starting workflow execution...');
    console.log('   - Workflow ID:', workflowId);
    console.log('');

    // Start the workflow
    const handle = await client.workflow.start(leadFollowUpWorkflow, {
      args: [testOptions],
      taskQueue: 'workflow-queue',
      workflowId: workflowId,
      workflowExecutionTimeout: '10 minutes',
    });

    console.log('⏳ Waiting for workflow completion...');
    
    // Wait for result
    const result = await handle.result();

    console.log('\n🎉 Workflow completed!');
    console.log('📊 Results:');
    console.log('   - Success:', result.success);
    console.log('   - Lead ID:', result.leadId);
    console.log('   - Site ID:', result.siteId);
    console.log('   - Site Name:', result.siteName || 'N/A');
    console.log('   - Site URL:', result.siteUrl || 'N/A');
    console.log('   - Follow-up Actions:', result.followUpActions?.length || 0);
    console.log('   - Next Steps:', result.nextSteps?.length || 0);
    console.log('   - Execution Time:', result.executionTime);
    console.log('   - Completed At:', result.completedAt);
    console.log('   - Errors:', result.errors.length);

    if (result.errors.length > 0) {
      console.log('\n❌ Errors encountered:');
      result.errors.forEach((error: string, index: number) => {
        console.log(`   ${index + 1}. ${error}`);
      });
    }

    if (result.followUpActions && result.followUpActions.length > 0) {
      console.log('\n📋 Follow-up Actions:');
      result.followUpActions.forEach((action: any, index: number) => {
        console.log(`   ${index + 1}. ${action.title || action.name || action.type || 'Unnamed Action'}`);
        if (action.description) {
          console.log(`      Description: ${action.description}`);
        }
      });
    }

    if (result.nextSteps && result.nextSteps.length > 0) {
      console.log('\n🎯 Next Steps:');
      result.nextSteps.forEach((step: string, index: number) => {
        console.log(`   ${index + 1}. ${step}`);
      });
    }

    if (result.data) {
      console.log('\n📄 Additional Data:');
      console.log(JSON.stringify(result.data, null, 2));
    }

    process.exit(result.success ? 0 : 1);

  } catch (error) {
    console.error('\n❌ Test failed:', error);
    console.error('Stack trace:', error instanceof Error ? error.stack : String(error));
    process.exit(1);
  }
}

// Handle script execution
if (require.main === module) {
  console.log('🔧 Lead Follow-Up Workflow Test Script');
  console.log('=====================================\n');
  
  console.log('💡 Environment Variables:');
  console.log('   - TEST_LEAD_ID: Override default lead ID');
  console.log('   - TEST_SITE_ID: Override default site ID');
  console.log('   - TEST_USER_ID: Override default user ID');
  console.log('   - TEMPORAL_ADDRESS: Temporal server address (default: localhost:7233)');
  console.log('   - TEMPORAL_NAMESPACE: Temporal namespace (default: default)');
  console.log('');

  testLeadFollowUpWorkflow().catch((error) => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
}

export { testLeadFollowUpWorkflow }; 