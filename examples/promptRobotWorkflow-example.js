/**
 * Example usage of promptRobotWorkflow
 * 
 * This workflow prompts a robot instance with a message and conditionally
 * triggers the robotWorkflow based on the plan completion status.
 */

const { getTemporalClient } = require('../src/temporal/client');

async function runPromptRobotWorkflowExample() {
  console.log('🎯 Starting promptRobotWorkflow example...');

  try {
    const client = await getTemporalClient();

    // Example input matching the required format
    const workflowInput = {
      instance_id: "123e4567-e89b-12d3-a456-426614174000",
      message: "navega a linkedin y busca posts de Santiago Zavala",
      step_status: "pending",
      site_id: "site_123",
      context: "Usuario quiere interactuar en LinkedIn",
      activity: "linkedin-interaction", // Optional: activity for robotWorkflow if triggered
      user_id: "user_456" // Optional: user ID
    };

    console.log('📝 Workflow input:', JSON.stringify(workflowInput, null, 2));

    // Start the workflow
    const handle = await client.workflow.start('promptRobotWorkflow', {
      args: [workflowInput],
      workflowId: `prompt-robot-example-${Date.now()}`,
      taskQueue: 'default',
    });

    console.log(`✅ Workflow started with ID: ${handle.workflowId}`);
    console.log('⏳ Waiting for workflow completion...');

    // Wait for the workflow to complete
    const result = await handle.result();

    console.log('🎉 Workflow completed successfully!');
    console.log('📊 Result:', JSON.stringify(result, null, 2));

    // Log key information
    console.log('\n📋 Summary:');
    console.log(`- Success: ${result.success}`);
    console.log(`- Instance ID: ${result.instance_id}`);
    console.log(`- Site ID: ${result.site_id}`);
    console.log(`- Plan Completed: ${result.plan_completed}`);
    console.log(`- Instance Status: ${result.instance_status || 'unknown'}`);
    console.log(`- Robot Workflow Triggered: ${result.robot_workflow_triggered || false}`);

    if (result.robot_workflow_triggered && result.robot_workflow_result) {
      console.log('🤖 Robot workflow was triggered and executed');
    } else if (!result.plan_completed) {
      console.log('⏳ Plan is pending, instance will continue with current execution');
    }

  } catch (error) {
    console.error('❌ Workflow execution failed:', error);
    
    if (error.cause) {
      console.error('📝 Error details:', error.cause);
    }
  }
}

// Run the example if this file is executed directly
if (require.main === module) {
  runPromptRobotWorkflowExample()
    .then(() => {
      console.log('✅ Example completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Example failed:', error);
      process.exit(1);
    });
}

module.exports = { runPromptRobotWorkflowExample };
