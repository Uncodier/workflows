#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const schedules_1 = require("../temporal/schedules");
async function deleteAllSchedules() {
    console.log(`🗑️  Deleting ${schedules_1.defaultSchedules.length} schedules...`);
    console.log('');
    const results = {
        success: [],
        failed: []
    };
    for (const schedule of schedules_1.defaultSchedules) {
        try {
            console.log(`🗑️  Deleting schedule: ${schedule.id}`);
            const result = await (0, schedules_1.deleteSchedule)(schedule.id);
            console.log(`   ✅ ${result.message}`);
            console.log('');
            results.success.push(schedule.id);
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.log(`   ❌ Failed: ${errorMessage}`);
            console.log('');
            results.failed.push({
                id: schedule.id,
                error: errorMessage
            });
        }
    }
    // Summary
    console.log('📊 Summary:');
    console.log(`✅ Successfully deleted: ${results.success.length} schedules`);
    if (results.success.length > 0) {
        results.success.forEach(id => console.log(`   - ${id}`));
    }
    console.log(`❌ Failed to delete: ${results.failed.length} schedules`);
    if (results.failed.length > 0) {
        results.failed.forEach(({ id, error }) => console.log(`   - ${id}: ${error}`));
    }
    console.log('');
    console.log('🔍 Check Temporal UI at http://localhost:8233 to verify deletion');
    console.log('📋 Use "npm run schedule:list" to list remaining schedules');
    if (results.failed.length > 0) {
        process.exit(1);
    }
}
// Run the script if called directly
if (require.main === module) {
    deleteAllSchedules().catch((error) => {
        console.error('💥 Fatal error:', error);
        process.exit(1);
    });
}
