#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recreateSchedules = recreateSchedules;
const schedules_1 = require("../temporal/schedules");
async function recreateSchedules() {
    console.log('=== RECREATING SCHEDULES WITH IMPROVED CONFIGURATION ===');
    console.log('Timestamp:', new Date().toISOString());
    console.log('');
    try {
        // Step 1: List existing schedules
        console.log('📋 Step 1: Checking existing schedules...');
        let existingSchedules = [];
        try {
            const schedulesList = await (0, schedules_1.listSchedules)();
            existingSchedules = Array.from(schedulesList);
            console.log(`Found ${existingSchedules.length} existing schedules`);
            for (const schedule of existingSchedules) {
                console.log(`   - ${schedule.scheduleId}`);
            }
        }
        catch (listError) {
            console.log('⚠️ Could not list existing schedules:', listError);
            console.log('Proceeding with deletion attempts for known schedule IDs...');
        }
        console.log('');
        // Step 2: Delete existing schedules that match our default schedules
        console.log('🗑️ Step 2: Deleting existing schedules...');
        const schedulesToDelete = schedules_1.defaultSchedules.map(s => s.id);
        for (const scheduleId of schedulesToDelete) {
            try {
                console.log(`   Deleting schedule: ${scheduleId}`);
                await (0, schedules_1.deleteSchedule)(scheduleId);
                console.log(`   ✅ Successfully deleted: ${scheduleId}`);
            }
            catch (deleteError) {
                const errorMessage = deleteError instanceof Error ? deleteError.message : String(deleteError);
                if (errorMessage.includes('not found') || errorMessage.includes('NotFound')) {
                    console.log(`   ℹ️ Schedule ${scheduleId} not found (already deleted or never existed)`);
                }
                else {
                    console.log(`   ⚠️ Failed to delete ${scheduleId}: ${errorMessage}`);
                }
            }
        }
        console.log('');
        // Step 3: Wait a moment for cleanup
        console.log('⏳ Step 3: Waiting for cleanup...');
        await new Promise(resolve => setTimeout(resolve, 2000));
        // Step 4: Create schedules with new configuration
        console.log('🚀 Step 4: Creating schedules with improved configuration...');
        const result = await (0, schedules_1.createAllSchedules)();
        console.log('');
        console.log('=== RECREATION SUMMARY ===');
        console.log(`✅ Successfully recreated: ${result.success.length} schedules`);
        console.log(`❌ Failed to recreate: ${result.failed.length} schedules`);
        if (result.success.length > 0) {
            console.log('Recreated schedules:');
            result.success.forEach(id => console.log(`   - ${id}`));
        }
        if (result.failed.length > 0) {
            console.log('Failed schedules:');
            result.failed.forEach(({ id, error }) => console.log(`   - ${id}: ${error}`));
        }
        console.log('');
        console.log('✅ Schedule recreation completed successfully!');
        console.log('🔍 Check Temporal UI to see your improved schedules');
    }
    catch (error) {
        console.error('❌ Schedule recreation failed:', error);
        process.exit(1);
    }
}
// Run the script
if (require.main === module) {
    recreateSchedules().catch(error => {
        console.error('💥 Fatal error during schedule recreation:', error);
        process.exit(1);
    });
}
