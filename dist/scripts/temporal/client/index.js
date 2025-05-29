"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTemporalClient = getTemporalClient;
exports.executeWorkflow = executeWorkflow;
const config_1 = require("../../config/config");
/**
 * Creates and returns a Temporal client connection
 * @returns Temporal client instance
 */
async function getTemporalClient() {
    // Use require to avoid TypeScript issues
    const { Connection, Client } = require('@temporalio/client');
    // Configure connection options based on environment
    const connectionOptions = {
        address: config_1.temporalConfig.serverUrl,
    };
    // Add TLS and API key for remote connections (Temporal Cloud)
    if (config_1.temporalConfig.tls) {
        connectionOptions.tls = {};
    }
    if (config_1.temporalConfig.apiKey) {
        connectionOptions.metadata = {
            'temporal-namespace': config_1.temporalConfig.namespace,
        };
        connectionOptions.apiKey = config_1.temporalConfig.apiKey;
    }
    const connection = await Connection.connect(connectionOptions);
    return new Client({
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
