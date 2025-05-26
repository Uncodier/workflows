"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTemporalClient = getTemporalClient;
exports.executeWorkflow = executeWorkflow;
const client_1 = require("@temporalio/client");
const config_1 = require("../../config/config");
/**
 * Creates and returns a Temporal client connection
 * @returns Temporal client instance
 */
async function getTemporalClient() {
    const connection = await client_1.Connection.connect({
        address: config_1.temporalConfig.serverUrl,
    });
    return new client_1.Client({
        connection,
        namespace: config_1.temporalConfig.namespace,
    });
}
/**
 * Helper function to execute a workflow with the Temporal client
 * @param workflowType Workflow function name
 * @param args Arguments to pass to the workflow
 * @param workflowId Optional custom workflow ID
 * @param taskQueue Optional custom task queue
 * @returns Workflow handle
 */
async function executeWorkflow(workflowType, args, workflowId, taskQueue) {
    const client = await getTemporalClient();
    return client.workflow.start(workflowType, {
        args,
        workflowId: workflowId || `${workflowType}-${Date.now()}`,
        taskQueue: taskQueue || config_1.temporalConfig.taskQueue,
    });
}
