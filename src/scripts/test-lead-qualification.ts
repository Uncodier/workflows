#!/usr/bin/env node

import { leadQualificationWorkflow } from '../temporal/workflows/leadQualificationWorkflow';
const { Connection, Client } = require('@temporalio/client');

async function testLeadQualificationWorkflow() {
  console.log('🧪 Testing Lead Qualification Workflow...');

  const siteId = process.env.TEST_SITE_ID || 'test-site-67890';
  const days = Number(process.env.TEST_DAYS || 7);
  const maxLeads = Number(process.env.TEST_MAX || 10);

  try {
    const connection = await Connection.connect({
      address: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
    });

    const client = new Client({
      connection,
      namespace: process.env.TEMPORAL_NAMESPACE || 'default',
    });

    const workflowId = `test-lead-qualification-${siteId}-${Date.now()}`;
    console.log('🚀 Starting workflow:', workflowId);

    const handle = await client.workflow.start(leadQualificationWorkflow, {
      args: [{ site_id: siteId, daysWithoutReply: days, maxLeads }],
      taskQueue: process.env.TEMPORAL_TASK_QUEUE || 'default',
      workflowId,
      workflowExecutionTimeout: '10 minutes',
    });

    const result = await handle.result();
    console.log('🎉 Result:', JSON.stringify(result, null, 2));
    process.exit(result.success ? 0 : 1);
  } catch (err) {
    console.error('❌ Test failed:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  testLeadQualificationWorkflow();
}


