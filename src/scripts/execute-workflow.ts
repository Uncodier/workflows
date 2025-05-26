#!/usr/bin/env node
import { Connection, Client } from '@temporalio/client';
import { workflows } from '../temporal/workflows';
import { temporalConfig } from '../config/config';

async function run() {
  // Connect to Temporal server
  const connection = await Connection.connect({
    address: temporalConfig.serverUrl,
  });

  const client = new Client({
    connection,
    namespace: temporalConfig.namespace,
  });

  // Execute the hello world workflow
  try {
    const handle = await client.workflow.start(workflows.helloWorldWorkflow, {
      taskQueue: temporalConfig.taskQueue,
      workflowId: 'hello-workflow-' + Date.now(),
      args: ['Temporal'],
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