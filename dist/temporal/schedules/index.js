"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultSchedules = void 0;
exports.createSchedule = createSchedule;
exports.listSchedules = listSchedules;
exports.deleteSchedule = deleteSchedule;
exports.toggleSchedule = toggleSchedule;
const config_1 = require("../../config/config");
const workflows_1 = require("../workflows");
// Define your schedules here
exports.defaultSchedules = [
    {
        id: 'daily-data-processing',
        workflowType: 'dataProcessingWorkflow',
        cronSchedule: '0 0 * * *', // Every day at midnight
        args: ['daily-batch', { transform: true }],
        description: 'Daily data processing job'
    },
    {
        id: 'hourly-api-polling',
        workflowType: 'scheduledApiPollingWorkflow',
        cronSchedule: '0 * * * *', // Every hour
        args: [{ endpoint: '/api/status', storeMetrics: true }],
        description: 'Hourly API health check'
    },
    {
        id: 'email-sync-every-5min',
        workflowType: 'syncEmailsWorkflow',
        cronSchedule: '*/5 * * * *', // Every 5 minutes
        args: [{
                userId: 'system-sync',
                provider: 'gmail',
                batchSize: 100
            }],
        description: 'Email synchronization every 5 minutes'
    }
];
// Helper function to create connection with proper configuration
async function createTemporalConnection() {
    // Use require to avoid TypeScript issues
    const { Connection } = require('@temporalio/client');
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
    return await Connection.connect(connectionOptions);
}
async function createSchedule(spec) {
    const { ScheduleClient, ScheduleOverlapPolicy } = require('@temporalio/client');
    const connection = await createTemporalConnection();
    const client = new ScheduleClient({
        connection,
        namespace: config_1.temporalConfig.namespace,
    });
    // Using type assertion to avoid linting issues while we sort out the correct types
    const scheduleOptions = {
        scheduleId: spec.id,
        action: {
            type: 'startWorkflow',
            workflowType: workflows_1.workflows[spec.workflowType],
            taskQueue: config_1.temporalConfig.taskQueue,
            args: spec.args || [],
        },
        spec: {
            cron: spec.cronSchedule
        },
        policies: {
            catchupWindow: '5m',
            overlap: ScheduleOverlapPolicy.SKIP,
        },
    };
    await client.create(scheduleOptions);
    return { message: `Schedule ${spec.id} created successfully` };
}
async function listSchedules() {
    const { ScheduleClient } = require('@temporalio/client');
    const connection = await createTemporalConnection();
    const client = new ScheduleClient({
        connection,
        namespace: config_1.temporalConfig.namespace,
    });
    const schedules = await client.list();
    return schedules;
}
async function deleteSchedule(scheduleId) {
    const { ScheduleClient } = require('@temporalio/client');
    const connection = await createTemporalConnection();
    const client = new ScheduleClient({
        connection,
        namespace: config_1.temporalConfig.namespace,
    });
    const handle = client.getHandle(scheduleId);
    await handle.delete();
    return { message: `Schedule ${scheduleId} deleted successfully` };
}
async function toggleSchedule(scheduleId, paused, note) {
    const { ScheduleClient } = require('@temporalio/client');
    const connection = await createTemporalConnection();
    const client = new ScheduleClient({
        connection,
        namespace: config_1.temporalConfig.namespace,
    });
    const handle = client.getHandle(scheduleId);
    if (paused) {
        await handle.pause(note);
        return { message: `Schedule ${scheduleId} paused successfully` };
    }
    else {
        await handle.unpause(note);
        return { message: `Schedule ${scheduleId} unpaused successfully` };
    }
}
