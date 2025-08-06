/**
 * Test script for the startRobotWorkflow
 * 
 * This script tests the robot workflow execution with various inputs
 */

async function testStartRobotWorkflow() {
  console.log('🤖 Testing startRobotWorkflow...');

  try {
    // Create Temporal client
    const { Connection, Client } = require('@temporalio/client');
    
    const connection = await Connection.connect({
      address: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
    });
    
    const client = new Client({
      connection,
      namespace: process.env.TEMPORAL_NAMESPACE || 'default',
    });

    // Test data
    const testCases = [
      {
        name: 'Lead Generation (with user_id)',
        input: {
          site_id: 'test-site-001',
          activity: 'lead-generation',
          user_id: 'test-user-001'
        }
      },
      {
        name: 'Content Creation (without user_id)',
        input: {
          site_id: 'test-site-002', 
          activity: 'content-creation'
          // user_id omitted to test optional behavior
        }
      },
      {
        name: 'Campaign Optimization (with user_id)',
        input: {
          site_id: 'test-site-003',
          activity: 'campaign-optimization',
          user_id: 'test-user-003'
        }
      }
    ];

    console.log(`📋 Running ${testCases.length} test cases...\n`);

    for (const testCase of testCases) {
      console.log(`🧪 Testing: ${testCase.name}`);
      console.log(`📤 Input:`, testCase.input);

      try {
        const workflowId = `test-start-robot-${testCase.input.site_id}-${testCase.input.activity}-${Date.now()}`;
        
        console.log(`🔄 Starting workflow with ID: ${workflowId}`);

        // Start the workflow
        const handle = await client.workflow.start('startRobotWorkflow', {
          args: [testCase.input],
          workflowId,
          taskQueue: 'default',
        });

        console.log(`⏳ Workflow started, waiting for result...`);

        // Wait for result
        const result = await handle.result();

        console.log(`📋 Result:`, result);

        if (result.success) {
          console.log(`✅ ${testCase.name} completed successfully!`);
          console.log(`   Site ID: ${result.site_id}`);
          console.log(`   Activity: ${result.activity}`);
          if (result.instance_id) {
            console.log(`   Instance ID: ${result.instance_id}`);
          }
          if (result.user_id) {
            console.log(`   User ID: ${result.user_id}`);
          } else {
            console.log(`   User ID: (not provided)`);
          }
          console.log(`   Executed at: ${result.executedAt}`);
          
          if (result.instanceData) {
            console.log(`   Instance response:`, JSON.stringify(result.instanceData, null, 2));
          }
          if (result.planData) {
            console.log(`   Plan response:`, JSON.stringify(result.planData, null, 2));
          }
        } else {
          console.log(`❌ ${testCase.name} failed: ${result.error}`);
        }

      } catch (error) {
        console.error(`💥 Error testing ${testCase.name}:`, error);
      }

      console.log(''); // Empty line for separation
    }

    console.log('✅ All tests completed!');

  } catch (error) {
    console.error('💥 Test execution failed:', error);
    process.exit(1);
  }
}

// Test workflow execution with error handling
async function testRobotWorkflowWithInvalidInput() {
  console.log('🧪 Testing with invalid input...');

  try {
    const { Connection, Client } = require('@temporalio/client');
    
    const connection = await Connection.connect({
      address: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
    });
    
    const client = new Client({
      connection,
      namespace: process.env.TEMPORAL_NAMESPACE || 'default',
    });

    // Test with invalid input
    const invalidInput = {
      site_id: '', // Empty site_id
      activity: '' // Empty activity
      // user_id omitted since it's optional
    };

    console.log(`📤 Invalid input:`, invalidInput);

    const workflowId = `test-start-robot-invalid-${Date.now()}`;
    
    const handle = await client.workflow.start('startRobotWorkflow', {
      args: [invalidInput],
      workflowId,
      taskQueue: 'default',
    });

    const result = await handle.result();

    console.log(`📋 Result:`, result);

    if (!result.success) {
      console.log('✅ Invalid input correctly handled with error:', result.error);
    } else {
      console.log('⚠️  Expected failure but workflow succeeded');
    }

  } catch (error) {
    console.error('💥 Error testing invalid input:', error);
  }
}

// Run the tests
async function runAllTests() {
  console.log('🚀 Starting startRobotWorkflow tests...\n');

  try {
    // Run main tests
    await testStartRobotWorkflow();
    
    console.log('\n🧪 Testing error handling...');
    await testRobotWorkflowWithInvalidInput();

    console.log('\n🎉 All tests completed successfully!');

  } catch (error) {
    console.error('\n💥 Test suite failed:', error);
    process.exit(1);
  }
}

// Execute if run directly
if (require.main === module) {
  runAllTests();
}

export { testStartRobotWorkflow, testRobotWorkflowWithInvalidInput, runAllTests };