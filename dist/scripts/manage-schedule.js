#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("../temporal/client");
const config_1 = require("../config/config");
async function run() {
    try {
        // Get command line arguments
        const args = process.argv.slice(2);
        const action = args[0]; // create, list, delete
        const client = await (0, client_1.getTemporalClient)();
        const scheduleClient = client.schedule;
        switch (action) {
            case 'create': {
                const scheduleName = args[1];
                const workflowType = args[2];
                const cronExpression = args[3];
                const workflowArgs = args[4] ? JSON.parse(args[4]) : [];
                if (!scheduleName || !workflowType || !cronExpression) {
                    console.error('Usage: npm run schedule:create <scheduleName> <workflowType> <cronExpression> [workflowArgsJSON]');
                    process.exit(1);
                }
                console.log(`Creating schedule ${scheduleName} for workflow ${workflowType} with cron: ${cronExpression}`);
                // Use the raw API to avoid typing issues with different versions
                await scheduleClient.create({
                    scheduleId: scheduleName,
                    spec: {
                        cron: cronExpression
                    },
                    action: {
                        type: 'startWorkflow',
                        workflowType,
                        taskQueue: config_1.temporalConfig.taskQueue,
                        args: workflowArgs,
                    },
                    timeZone: 'UTC',
                    policies: {
                        catchupWindow: '5m',
                        overlap: 'SKIP',
                        pauseOnFailure: false,
                    },
                });
                console.log('Schedule created successfully');
                break;
            }
            case 'list': {
                console.log('Listing all schedules:');
                const schedulesIterable = await scheduleClient.list();
                let count = 0;
                for await (const schedule of schedulesIterable) {
                    console.log(`- ${schedule.scheduleId}`);
                    count++;
                }
                if (count === 0) {
                    console.log('No schedules found');
                }
                break;
            }
            case 'delete': {
                const scheduleId = args[1];
                if (!scheduleId) {
                    console.error('Usage: npm run schedule:delete <scheduleId>');
                    process.exit(1);
                }
                console.log(`Deleting schedule ${scheduleId}`);
                await scheduleClient.delete(scheduleId);
                console.log('Schedule deleted successfully');
                break;
            }
            default:
                console.error('Unknown action. Use: create, list, or delete');
                process.exit(1);
        }
        process.exit(0);
    }
    catch (error) {
        console.error('Error managing schedules:', error);
        process.exit(1);
    }
}
run();
