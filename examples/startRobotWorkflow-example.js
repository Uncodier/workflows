/**
 * Example: Using the startRobotWorkflow
 * 
 * This example shows how to execute the startRobotWorkflow to trigger
 * robot planning for a specific site and activity.
 */

async function runStartRobotWorkflowExample() {
  const { Connection, Client } = require('@temporalio/client');
  
  const connection = await Connection.connect({
    address: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
  });
  
  const client = new Client({
    connection,
    namespace: process.env.TEMPORAL_NAMESPACE || 'default',
  });

  try {
    console.log('🤖 Starting robot workflow example...');

    // Example input data
    const workflowInput = {
      site_id: 'site-123', // Replace with actual site ID
      activity: 'lead-generation', // Replace with actual activity name
      user_id: 'user-456' // Optional - Replace with actual user ID or omit
    };

    console.log('📤 Input:', workflowInput);

    // Execute the workflow
    const result = await client.execute('startRobotWorkflow', {
      args: [workflowInput],
      workflowId: `start-robot-${workflowInput.site_id}-${Date.now()}`,
      taskQueue: 'default',
    });

    console.log('✅ Robot workflow completed successfully!');
    console.log('📋 Result:', result);

    if (result.success) {
      console.log(`🎯 Robot plan executed for site: ${result.site_id}`);
      console.log(`📊 Activity: ${result.activity}`);
      if (result.instance_id) {
        console.log(`🔗 Instance ID: ${result.instance_id}`);
      }
      console.log(`⏰ Executed at: ${result.executedAt}`);
      
      if (result.instanceData) {
        console.log('🔧 Instance API Response:', result.instanceData);
      }
      if (result.planData) {
        console.log('📈 Plan API Response:', result.planData);
      }
      if (result.user_id) {
        console.log(`👤 User: ${result.user_id}`);
      }
    } else {
      console.error('❌ Robot workflow failed:', result.error);
    }

  } catch (error) {
    console.error('💥 Error executing robot workflow:', error);
  }
}

// Example using a provided instance_id (skips instance creation step)
async function runStartRobotWorkflowWithInstanceIdExample() {
  const { Connection, Client } = require('@temporalio/client');

  const connection = await Connection.connect({
    address: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
  });

  const client = new Client({
    connection,
    namespace: process.env.TEMPORAL_NAMESPACE || 'default',
  });

  try {
    console.log('🤖 Starting robot workflow with provided instance_id example...');

    const workflowInput = {
      site_id: 'site-789',
      activity: 'lead-generation',
      instance_id: 'example-instance-' + Date.now(),
      // user_id is optional
    };

    console.log('📤 Input (with instance_id):', workflowInput);

    const result = await client.execute('startRobotWorkflow', {
      args: [workflowInput],
      workflowId: `start-robot-with-instance-${workflowInput.site_id}-${Date.now()}`,
      taskQueue: 'default',
    });

    console.log('✅ Robot workflow completed successfully!');
    console.log('📋 Result:', result);

  } catch (error) {
    console.error('💥 Error executing robot workflow with instance_id:', error);
  }
}

// Example with different activity types
async function runMultipleActivitiesExample() {
  const { Connection, Client } = require('@temporalio/client');
  
  const connection = await Connection.connect({
    address: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
  });
  
  const client = new Client({
    connection,
    namespace: process.env.TEMPORAL_NAMESPACE || 'default',
  });
  
  const activities = [
    'lead-generation',
    'content-creation',
    'campaign-optimization',
    'market-analysis'
  ];

  const siteId = 'site-456';

  console.log('🔄 Running multiple robot activities...');

  for (const activity of activities) {
    try {
      console.log(`\n🚀 Starting activity: ${activity}`);
      
      const result = await client.execute('startRobotWorkflow', {
        args: [{
          site_id: siteId,
          activity: activity
          // user_id is optional - can be omitted
        }],
        workflowId: `start-robot-${siteId}-${activity}-${Date.now()}`,
        taskQueue: 'default',
      });

      if (result.success) {
        console.log(`✅ ${activity} completed successfully`);
      } else {
        console.error(`❌ ${activity} failed:`, result.error);
      }

    } catch (error) {
      console.error(`💥 Error with ${activity}:`, error);
    }
  }
}

// Run the examples
if (require.main === module) {
  console.log('🤖 Running startRobotWorkflow examples...\n');
  
  runStartRobotWorkflowExample()
    .then(() => {
      console.log('\n🔄 Running with provided instance_id example...');
      return runStartRobotWorkflowWithInstanceIdExample();
    })
    .then(() => {
      console.log('\n🔄 Running multiple activities example...');
      return runMultipleActivitiesExample();
    })
    .then(() => {
      console.log('\n✅ All examples completed!');
    })
    .catch((error) => {
      console.error('\n💥 Example failed:', error);
      process.exit(1);
    });
}

export { runStartRobotWorkflowExample, runMultipleActivitiesExample, runStartRobotWorkflowWithInstanceIdExample };