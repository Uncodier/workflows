"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scheduledApiPollingWorkflow = scheduledApiPollingWorkflow;
exports.cronWorkflow = cronWorkflow;
const workflow_1 = require("@temporalio/workflow");
const { fetchDataActivity, createResourceActivity, updateResourceActivity } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: '5 minutes',
    retry: {
        maximumAttempts: 3,
    },
});
/**
 * A workflow designed to run on a schedule, polling an API for data
 *
 * @param options Configuration options for the scheduled workflow
 */
async function scheduledApiPollingWorkflow(options = {}) {
    // Fetch data from API
    const data = await fetchDataActivity(options.endpoint || 'default');
    // Create or update resource in Supabase
    if (data.id) {
        await updateResourceActivity(data.id, data);
    }
    else {
        await createResourceActivity(data);
    }
    return {
        success: true,
        data,
    };
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
