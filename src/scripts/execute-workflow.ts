#!/usr/bin/env node
import { getTemporalClient } from '../temporal/client';
import { workflows } from '../temporal/workflows';

async function run() {
  // Use the configured Temporal client
  const client = await getTemporalClient();

  // Execute the data processing workflow
  try {
    const handle = await client.workflow.start(workflows.dataProcessingWorkflow, {
      taskQueue: 'default',
      workflowId: 'data-processing-workflow-' + Date.now(),
      args: ['test-resource', { transform: true }],
    });

    console.log('Started workflow:', handle.workflowId);
    
    // Wait for the result
    const result = await handle.result();
    console.log('Workflow result:', result);
  } catch (error) {
    console.error('Workflow execution failed:', error);
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Failed to execute workflow:', err);
  process.exit(1);
}); 