#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const schedules_1 = require("../temporal/schedules");
async function createEmailSyncSchedule() {
    try {
        // Find the email sync schedule from our default schedules
        const emailSyncSchedule = schedules_1.defaultSchedules.find(schedule => schedule.id === 'email-sync-every-5min');
        if (!emailSyncSchedule) {
            console.error('Email sync schedule not found in default schedules');
            process.exit(1);
        }
        console.log('Creating email sync schedule (every 5 minutes)...');
        console.log(`Schedule ID: ${emailSyncSchedule.id}`);
        console.log(`Workflow Type: ${emailSyncSchedule.workflowType}`);
        console.log(`Cron Schedule: ${emailSyncSchedule.cronSchedule}`);
        console.log(`Description: ${emailSyncSchedule.description}`);
        const result = await (0, schedules_1.createSchedule)(emailSyncSchedule);
        console.log('✅ Schedule created successfully:', result.message);
        console.log('🔍 Check Temporal UI to see it running every 5 minutes');
    }
    catch (error) {
        console.error('❌ Failed to create email sync schedule:', error);
        process.exit(1);
    }
}
// Run the script if called directly
if (require.main === module) {
    createEmailSyncSchedule();
}
