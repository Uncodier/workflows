"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTemporalClient = getTemporalClient;
exports.executeWorkflow = executeWorkflow;
const config_1 = require("../../config/config");
const taskQueues_1 = require("../config/taskQueues");
const searchAttributes_1 = require("../utils/searchAttributes");
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
 * Automatically extracts search attributes from workflow inputs for filtering in Temporal UI
 *
 * @param workflowType Workflow function name
 * @param args Arguments to pass to the workflow
 * @param workflowId Optional custom workflow ID
 * @param taskQueue Optional custom task queue
 * @param options Optional configuration including searchAttributes
 * @returns Workflow handle
 *
 * @example
 * // Automatic search attributes extraction
 * await executeWorkflow('buildSegmentsWorkflow', [{ site_id: 'site-123', userId: 'user-456' }]);
 * // searchAttributes { site_id: ['site-123'], user_id: ['user-456'] } added automatically
 *
 * @example
 * // Manual search attributes
 * await executeWorkflow('myWorkflow', [args], 'my-id', 'default', {
 *   searchAttributes: { site_id: ['site-123'], workflow_category: ['critical'] }
 * });
 */
async function executeWorkflow(workflowType, args, workflowId, taskQueue, options) {
    const client = await getTemporalClient();
    // Auto-extract search attributes from first argument if it's an object
    let searchAttributes = {};
    if (options?.autoExtractSearchAttributes !== false && args[0] && typeof args[0] === 'object') {
        const extracted = (0, searchAttributes_1.extractSearchAttributesFromInput)(args[0]);
        searchAttributes = extracted;
    }
    // Merge with manually provided search attributes (manual takes precedence)
    if (options?.searchAttributes) {
        searchAttributes = (0, searchAttributes_1.mergeSearchAttributes)(searchAttributes, options.searchAttributes);
    }
    return client.workflow.start(workflowType, {
        args,
        workflowId: workflowId || `${workflowType}-${Date.now()}`,
        taskQueue: taskQueue || (0, taskQueues_1.getTaskQueueForWorkflow)(workflowType),
        // Only add searchAttributes if we have any
        ...(Object.keys(searchAttributes).length > 0 && { searchAttributes })
    });
}
