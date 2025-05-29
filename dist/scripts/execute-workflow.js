#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("../temporal/client");
const workflows_1 = require("../temporal/workflows");
async function run() {
    // Use the configured Temporal client
    const client = await (0, client_1.getTemporalClient)();
    // Execute the central schedule activities workflow
    try {
        const handle = await client.workflow.start(workflows_1.workflows.scheduleActivitiesWorkflow, {
            taskQueue: 'default',
            workflowId: 'schedule-activities-workflow-' + Date.now(),
            args: [],
        });
        console.log('Started workflow:', handle.workflowId);
        // Wait for the result
        const result = await handle.result();
        console.log('Workflow result:', result);
    }
    catch (error) {
        console.error('Workflow execution failed:', error);
        process.exit(1);
    }
}
run().catch((err) => {
    console.error('Failed to execute workflow:', err);
    process.exit(1);
});
