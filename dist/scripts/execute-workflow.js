#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("../temporal/client");
async function run() {
    try {
        // Get command line arguments
        const args = process.argv.slice(2);
        const workflowType = args[0];
        const resourceId = args[1];
        const options = args[2] ? JSON.parse(args[2]) : {};
        if (!workflowType || !resourceId) {
            console.error('Usage: npm run execute-workflow <workflowType> <resourceId> <optionsJSON>');
            process.exit(1);
        }
        console.log(`Executing workflow ${workflowType} with resourceId ${resourceId}`);
        console.log('Options:', options);
        // Execute the workflow
        const handle = await (0, client_1.executeWorkflow)(workflowType, [resourceId, options]);
        console.log(`Workflow started with ID: ${handle.workflowId}`);
        // Wait for the workflow to complete
        const result = await handle.result();
        console.log('Workflow completed with result:', result);
        process.exit(0);
    }
    catch (error) {
        console.error('Error executing workflow:', error);
        process.exit(1);
    }
}
run();
