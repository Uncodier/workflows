#!/usr/bin/env tsx
"use strict";
/**
 * Script to run sendApprovedMessagesWorkflow once.
 * Starts the workflow on the default task queue and waits for completion.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("../temporal/client");
const sendApprovedMessagesWorkflow_1 = require("../temporal/workflows/sendApprovedMessagesWorkflow");
async function run() {
    console.log('🚀 Starting sendApprovedMessagesWorkflow...\n');
    const client = await (0, client_1.getTemporalClient)();
    const workflowId = `send-approved-messages-${Date.now()}`;
    const handle = await client.workflow.start(sendApprovedMessagesWorkflow_1.sendApprovedMessagesWorkflow, {
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
