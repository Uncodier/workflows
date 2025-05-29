"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultSchedules = void 0;
exports.createSchedule = createSchedule;
exports.createAllSchedules = createAllSchedules;
exports.listSchedules = listSchedules;
exports.deleteSchedule = deleteSchedule;
exports.toggleSchedule = toggleSchedule;
const config_1 = require("../../config/config");
const workflows_1 = require("../workflows");
// Central schedule that manages all other workflows
exports.defaultSchedules = [
    {
        id: 'central-schedule-activities',
        workflowType: 'scheduleActivitiesWorkflow',
        cronSchedule: '0 0 * * *', // Every day at midnight
        args: [],
        description: 'Central schedule that manages all workflow orchestration'
    },
    {
        id: 'sync-emails-schedule-manager',
        workflowType: 'syncEmailsScheduleWorkflow',
        cronSchedule: '0 */1 * * *', // Every 1 hours
        args: [],
        description: 'Schedule email sync workflows for all sites every 2 hours'
    }
];
// Connection timeout wrapper
async function withTimeout(promise, timeoutMs, operation) {
    const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
            reject(new Error(`${operation} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
    });
    return Promise.race([promise, timeoutPromise]);
}
// Retry wrapper
async function withRetry(operation, maxRetries = 3, delayMs = 1000, operationName = 'operation') {
    let lastError = new Error('No attempts made');
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`🔄 Attempt ${attempt}/${maxRetries} for ${operationName}`);
            return await operation();
        }
        catch (error) {
            lastError = error;
            console.log(`❌ Attempt ${attempt} failed: ${lastError.message}`);
            if (attempt < maxRetries) {
                console.log(`⏳ Waiting ${delayMs}ms before retry...`);
                await new Promise(resolve => setTimeout(resolve, delayMs));
                delayMs *= 1.5; // Exponential backoff
            }
        }
    }
    throw new Error(`${operationName} failed after ${maxRetries} attempts. Last error: ${lastError.message}`);
}
// Helper function to create connection with proper configuration
async function createTemporalConnection() {
    console.log('🔗 Creating Temporal connection...');
    const { Connection } = require('@temporalio/client');
    const connectionOptions = {
        address: config_1.temporalConfig.serverUrl,
        // Add connection timeout options
        connectTimeout: '10s',
        rpcTimeout: '30s',
    };
    // Add TLS and API key for remote connections (Temporal Cloud)
    if (config_1.temporalConfig.tls) {
        connectionOptions.tls = {
            // Add TLS timeout options
            handshakeTimeout: '10s',
        };
    }
    if (config_1.temporalConfig.apiKey) {
        connectionOptions.metadata = {
            'temporal-namespace': config_1.temporalConfig.namespace,
        };
        connectionOptions.apiKey = config_1.temporalConfig.apiKey;
    }
    console.log('🔗 Connection options:', {
        address: connectionOptions.address,
        hasTls: !!connectionOptions.tls,
        hasApiKey: !!connectionOptions.apiKey,
        connectTimeout: connectionOptions.connectTimeout,
        rpcTimeout: connectionOptions.rpcTimeout
    });
    // Wrap connection with timeout
    return await withTimeout(Connection.connect(connectionOptions), 15000, // 15 second timeout
    'Temporal connection');
}
async function createSchedule(spec) {
    console.log(`📅 Creating schedule: ${spec.id}`);
    return await withRetry(async () => {
        const { ScheduleClient, ScheduleOverlapPolicy } = require('@temporalio/client');
        console.log(`🔗 Establishing connection for ${spec.id}...`);
        const connection = await createTemporalConnection();
        console.log(`📋 Creating schedule client for ${spec.id}...`);
        const client = new ScheduleClient({
            connection,
            namespace: config_1.temporalConfig.namespace,
        });
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
                pauseOnFailure: false,
            },
            timeZone: 'UTC',
        };
        console.log(`🚀 Creating schedule ${spec.id} in Temporal...`);
        console.log(`   - Cron: ${spec.cronSchedule}`);
        console.log(`   - Workflow: ${workflows_1.workflows[spec.workflowType]}`);
        console.log(`   - Task Queue: ${config_1.temporalConfig.taskQueue}`);
        console.log(`   - Time Zone: UTC`);
        await withTimeout(client.create(scheduleOptions), 20000, // 20 second timeout for schedule creation
        `Schedule creation for ${spec.id}`);
        console.log(`🔒 Closing connection for ${spec.id}...`);
        await connection.close();
        return { message: `Schedule ${spec.id} created successfully` };
    }, 2, 2000, `createSchedule(${spec.id})`); // 2 retries, 2 second delay
}
async function createAllSchedules() {
    console.log('=== SCHEDULE CREATION ===');
    console.log('Timestamp:', new Date().toISOString());
    console.log('Environment:', {
        NODE_ENV: process.env.NODE_ENV,
        TEMPORAL_SERVER_URL: process.env.TEMPORAL_SERVER_URL ? 'SET' : 'NOT_SET',
        TEMPORAL_NAMESPACE: process.env.TEMPORAL_NAMESPACE || 'default',
        TEMPORAL_API_KEY: process.env.TEMPORAL_API_KEY ? 'SET' : 'NOT_SET',
        TEMPORAL_TLS: process.env.TEMPORAL_TLS,
        WORKFLOW_TASK_QUEUE: process.env.WORKFLOW_TASK_QUEUE || 'default',
        PWD: process.cwd(),
        isVercel: !!process.env.VERCEL
    });
    console.log('');
    console.log(`🚀 Creating ${exports.defaultSchedules.length} schedules...`);
    console.log('Schedules to create:', exports.defaultSchedules.map(s => ({
        id: s.id,
        workflowType: s.workflowType,
        cronSchedule: s.cronSchedule
    })));
    console.log('');
    const results = {
        success: [],
        failed: []
    };
    // Process schedules one by one to avoid connection overload
    for (const schedule of exports.defaultSchedules) {
        try {
            console.log(`📅 Processing schedule: ${schedule.id}`);
            console.log(`   - Workflow: ${schedule.workflowType}`);
            console.log(`   - Cron: ${schedule.cronSchedule}`);
            console.log(`   - Description: ${schedule.description}`);
            const result = await createSchedule(schedule);
            console.log(`   ✅ ${result.message}`);
            console.log('');
            results.success.push(schedule.id);
            // Add small delay between schedules to avoid overwhelming the connection
            if (process.env.VERCEL) {
                console.log('   ⏳ Waiting 1s before next schedule...');
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.log(`   ❌ Failed: ${errorMessage}`);
            console.log(`   🔍 Error details:`, {
                name: error instanceof Error ? error.name : 'Unknown',
                stack: error instanceof Error ? error.stack?.split('\n')[0] : 'No stack trace',
                errorType: typeof error
            });
            console.log('');
            results.failed.push({
                id: schedule.id,
                error: errorMessage
            });
        }
    }
    // Summary
    console.log('=== SCHEDULE CREATION SUMMARY ===');
    console.log(`✅ Successfully created: ${results.success.length} schedules`);
    if (results.success.length > 0) {
        results.success.forEach(id => console.log(`   - ${id}`));
    }
    console.log(`❌ Failed to create: ${results.failed.length} schedules`);
    if (results.failed.length > 0) {
        results.failed.forEach(({ id, error }) => console.log(`   - ${id}: ${error}`));
    }
    console.log('');
    console.log('🔍 Check Temporal UI to see your schedules');
    console.log('=== SCHEDULE CREATION COMPLETED ===');
    return {
        success: results.success,
        failed: results.failed,
        total: exports.defaultSchedules.length
    };
}
async function listSchedules() {
    const { ScheduleClient } = require('@temporalio/client');
    const connection = await createTemporalConnection();
    const client = new ScheduleClient({
        connection,
        namespace: config_1.temporalConfig.namespace,
    });
    const schedules = await client.list();
    await connection.close();
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
    await connection.close();
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
        await connection.close();
        return { message: `Schedule ${scheduleId} paused successfully` };
    }
    else {
        await handle.unpause(note);
        await connection.close();
        return { message: `Schedule ${scheduleId} unpaused successfully` };
    }
}
