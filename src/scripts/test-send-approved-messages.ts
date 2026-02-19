#!/usr/bin/env tsx

/**
 * Script to run sendApprovedMessagesWorkflow once.
 * Starts the workflow on the default task queue and waits for completion.
 */

import { getTemporalClient } from '../temporal/client';
import { sendApprovedMessagesWorkflow } from '../temporal/workflows/sendApprovedMessagesWorkflow';

async function run() {
  console.log('🚀 Starting sendApprovedMessagesWorkflow...\n');

  const client = await getTemporalClient();
  const workflowId = `send-approved-messages-${Date.now()}`;

  const handle = await client.workflow.start(sendApprovedMessagesWorkflow, {
    args: [],
    taskQueue: 'default',
    workflowId,
  });

  console.log(`✅ Workflow started: ${handle.workflowId}`);
  console.log('⏳ Waiting for result...\n');

  const result = await handle.result();
  console.log('✅ Workflow completed. Result:', result ?? '(no return value)');
}

run().catch((err) => {
  console.error('❌ Failed to run sendApprovedMessagesWorkflow:', err);
  process.exit(1);
});
