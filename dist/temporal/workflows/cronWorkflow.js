"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scheduledApiPollingWorkflow = scheduledApiPollingWorkflow;
exports.cronWorkflow = cronWorkflow;
const workflow_1 = require("@temporalio/workflow");
const { fetchDataActivity, createResourceActivity, updateResourceActivity, 
// deleteResourceActivity,
logWorkflowExecutionActivity, 
// storeWorkflowResultActivity,
// fetchConfigurationActivity,
trackApiCallActivity } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: '1 minute',
});
/**
 * A workflow designed to run on a schedule, polling an API for data
 *
 * @param options Configuration options for the scheduled workflow
 */
async function scheduledApiPollingWorkflow(options = {}) {
    const workflowId = options.endpoint || 'scheduled-api-poll';
    // Log workflow execution start
    await logWorkflowExecutionActivity({
        workflowId,
        workflowType: 'scheduledApiPollingWorkflow',
        status: 'STARTED',
        input: options,
    });
    try {
        const startTime = Date.now();
        // Simulate an API call (using our activities)
        const data = await fetchDataActivity(options.endpoint || 'default');
        const duration = Date.now() - startTime;
        if (options.storeMetrics) {
            await trackApiCallActivity({
                endpoint: options.endpoint || 'default',
                method: options.method || 'GET',
                statusCode: 200,
                duration,
                workflowId,
            });
        }
        // Log workflow execution completion
        await logWorkflowExecutionActivity({
            workflowId,
            workflowType: 'scheduledApiPollingWorkflow',
            status: 'COMPLETED',
            input: options,
            output: { success: true, dataSize: JSON.stringify(data).length },
        });
        return {
            success: true,
            data,
            executionTime: duration,
        };
    }
    catch (error) {
        // Log workflow execution failure
        await logWorkflowExecutionActivity({
            workflowId,
            workflowType: 'scheduledApiPollingWorkflow',
            status: 'FAILED',
            input: options,
            error: error instanceof Error ? error.message : String(error),
        });
        throw error;
    }
}
async function cronWorkflow() {
    try {
        // Fetch data from external API
        const data = await fetchDataActivity('resource-id');
        // Create or update resource in Supabase
        if (data.id) {
            await updateResourceActivity(data.id, data);
        }
        else {
            await createResourceActivity(data);
        }
    }
    catch (error) {
        // Handle errors appropriately
        console.error('Error in cron workflow:', error);
        throw error;
    }
}
