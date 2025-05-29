"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCronSchedule = createCronSchedule;
exports.listSchedules = listSchedules;
exports.deleteSchedule = deleteSchedule;
exports.pauseSchedule = pauseSchedule;
exports.unpauseSchedule = unpauseSchedule;
const client_1 = require("../client");
const config_1 = require("../../config/config");
/**
 * Schedule a workflow to run on a cron schedule
 */
async function createCronSchedule(scheduleName, workflowType, args, cronExpression, options) {
    const client = await (0, client_1.getTemporalClient)();
    try {
        const scheduleClient = client.schedule;
        await scheduleClient.create({
            scheduleId: scheduleName,
            spec: {
                cron: cronExpression
            },
            action: {
                type: 'startWorkflow',
                workflowType,
                taskQueue: options?.taskQueue ?? config_1.temporalConfig.taskQueue,
                args,
            },
            timeZone: 'UTC',
            policies: {
                catchupWindow: '5m',
                overlap: 'SKIP',
                pauseOnFailure: false,
            },
        });
        console.log(`Schedule created: ${scheduleName} for workflow ${workflowType} with cron: ${cronExpression}`);
        return scheduleName;
    }
    catch (error) {
        console.error(`Failed to create schedule ${scheduleName}:`, error);
        throw error;
    }
}
/**
 * List all schedules
 */
async function listSchedules() {
    const client = await (0, client_1.getTemporalClient)();
    const scheduleClient = client.schedule;
    const schedulesIterable = await scheduleClient.list();
    // Convert AsyncIterable to array
    const schedules = [];
    for await (const schedule of schedulesIterable) {
        schedules.push(schedule);
    }
    return schedules;
}
/**
 * Delete a schedule
 */
async function deleteSchedule(scheduleId) {
    const client = await (0, client_1.getTemporalClient)();
    const scheduleClient = client.schedule;
    await scheduleClient.delete(scheduleId);
    console.log(`Schedule deleted: ${scheduleId}`);
}
/**
 * Pause a schedule
 */
async function pauseSchedule(scheduleId, note = 'Paused by API') {
    const client = await (0, client_1.getTemporalClient)();
    const scheduleClient = client.schedule;
    const description = await scheduleClient.describe(scheduleId);
    await scheduleClient.update(scheduleId, {
        ...description,
        state: {
            ...description.state,
            paused: true,
            note,
        },
    });
    console.log(`Schedule paused: ${scheduleId}`);
}
/**
 * Unpause a schedule
 */
async function unpauseSchedule(scheduleId, note = 'Unpaused by API') {
    const client = await (0, client_1.getTemporalClient)();
    const scheduleClient = client.schedule;
    const description = await scheduleClient.describe(scheduleId);
    await scheduleClient.update(scheduleId, {
        ...description,
        state: {
            ...description.state,
            paused: false,
            note,
        },
    });
    console.log(`Schedule unpaused: ${scheduleId}`);
}
