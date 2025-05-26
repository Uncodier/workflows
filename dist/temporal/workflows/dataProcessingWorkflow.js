"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dataProcessingWorkflow = dataProcessingWorkflow;
const workflow_1 = require("@temporalio/workflow");
// Define the activity interface and options
const { fetchDataActivity, createResourceActivity, updateResourceActivity, deleteResourceActivity } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: '10 minutes',
    retry: {
        maximumAttempts: 3,
    },
});
/**
 * Workflow to process data from an API
 *
 * @param resourceId - ID of the resource to fetch and process
 * @param options - Optional processing options
 */
async function dataProcessingWorkflow(resourceId, options = {}) {
    // Fetch data from the API
    const fetchedData = await fetchDataActivity(resourceId);
    let processedData = fetchedData;
    // Apply transformations if needed
    if (options.transform) {
        processedData = {
            ...fetchedData,
            processed: true,
            processedAt: new Date().toISOString(),
        };
        await updateResourceActivity(resourceId, processedData);
    }
    else {
        await createResourceActivity(fetchedData);
    }
    return processedData;
}
