#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cleanStuckCronStatus = cleanStuckCronStatus;
exports.checkStuckRecords = checkStuckRecords;
const services_1 = require("../temporal/services");
async function cleanStuckCronStatus() {
    console.log('🧹 Cleaning stuck RUNNING cron status records...');
    console.log('');
    try {
        const supabaseService = (0, services_1.getSupabaseService)();
        const isConnected = await supabaseService.getConnectionStatus();
        if (!isConnected) {
            console.error('❌ Database not available');
            process.exit(1);
        }
        // Find RUNNING records that are likely stuck (older than 2 hours)
        const stuckRecords = await supabaseService.fetchStuckCronStatus(2);
        if (!stuckRecords || stuckRecords.length === 0) {
            console.log('✅ No stuck RUNNING records found - all good!');
            return;
        }
        console.log(`🔍 Found ${stuckRecords.length} stuck RUNNING records:`);
        console.log('');
        const processedRecords = stuckRecords.map(record => {
            const updatedAt = new Date(record.updated_at);
            const hoursStuck = (Date.now() - updatedAt.getTime()) / (1000 * 60 * 60);
            return {
                id: record.id,
                site_id: record.site_id,
                activity_name: record.activity_name,
                workflow_id: record.workflow_id,
                status: record.status,
                last_run: record.last_run,
                updated_at: record.updated_at,
                hoursStuck: Math.round(hoursStuck * 10) / 10
            };
        });
        // Display stuck records
        processedRecords.forEach((record, index) => {
            console.log(`${index + 1}. Site: ${record.site_id.substring(0, 8)}...`);
            console.log(`   Activity: ${record.activity_name}`);
            console.log(`   Workflow: ${record.workflow_id}`);
            console.log(`   Stuck for: ${record.hoursStuck} hours`);
            console.log(`   Last update: ${record.updated_at}`);
            console.log('');
        });
        // Ask for confirmation
        console.log(`🚨 This will reset ${stuckRecords.length} stuck records to 'FAILED' status`);
        console.log('⚠️  This will allow workflows to run again for these sites');
        console.log('');
        // For automated execution, skip confirmation
        const args = process.argv.slice(2);
        const autoConfirm = args.includes('--yes') || args.includes('-y');
        if (!autoConfirm) {
            console.log('💡 Run with --yes or -y to skip confirmation');
            console.log('');
            process.exit(0);
        }
        console.log('🔧 Proceeding with cleanup...');
        console.log('');
        // Reset stuck records to FAILED status
        const resetResults = [];
        for (const record of processedRecords) {
            try {
                const errorMessage = `Reset from stuck RUNNING state after ${record.hoursStuck}h by cleanup script`;
                await supabaseService.resetCronStatusToFailed(record.id, errorMessage);
                console.log(`✅ Reset ${record.activity_name} for site ${record.site_id.substring(0, 8)}...`);
                resetResults.push({ id: record.id, success: true });
            }
            catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                console.error(`❌ Failed to reset record ${record.id}:`, errorMessage);
                resetResults.push({ id: record.id, success: false, error: errorMessage });
            }
        }
        console.log('');
        console.log('📊 Cleanup Summary:');
        const successful = resetResults.filter(r => r.success).length;
        const failed = resetResults.filter(r => !r.success).length;
        console.log(`✅ Successfully reset: ${successful} records`);
        console.log(`❌ Failed to reset: ${failed} records`);
        if (failed > 0) {
            console.log('');
            console.log('❌ Failed records:');
            resetResults.filter(r => !r.success).forEach(result => {
                console.log(`   - ${result.id}: ${result.error}`);
            });
        }
        console.log('');
        console.log('🎉 Cleanup completed!');
        console.log('💡 Workflows for these sites should now be able to run again');
    }
    catch (error) {
        console.error('�� Fatal error during cleanup:', error);
        process.exit(1);
    }
}
// Additional function to check for stuck records without cleaning
async function checkStuckRecords() {
    console.log('🔍 Checking for stuck RUNNING cron status records...');
    console.log('');
    try {
        const supabaseService = (0, services_1.getSupabaseService)();
        const isConnected = await supabaseService.getConnectionStatus();
        if (!isConnected) {
            console.error('❌ Database not available');
            process.exit(1);
        }
        // Find ALL RUNNING records with their age
        const runningRecords = await supabaseService.fetchAllRunningCronStatus();
        if (!runningRecords || runningRecords.length === 0) {
            console.log('✅ No RUNNING records found');
            return;
        }
        console.log(`📋 Found ${runningRecords.length} RUNNING records:`);
        console.log('');
        runningRecords.forEach((record, index) => {
            const updatedAt = new Date(record.updated_at);
            const hoursAge = (Date.now() - updatedAt.getTime()) / (1000 * 60 * 60);
            const isStuck = hoursAge > 2;
            console.log(`${index + 1}. Site: ${record.site_id.substring(0, 8)}... ${isStuck ? '🚨 STUCK' : '✅'}`);
            console.log(`   Activity: ${record.activity_name}`);
            console.log(`   Age: ${Math.round(hoursAge * 10) / 10} hours`);
            console.log(`   Last update: ${record.updated_at}`);
            console.log('');
        });
        const stuckCount = runningRecords.filter(record => {
            const hoursAge = (Date.now() - new Date(record.updated_at).getTime()) / (1000 * 60 * 60);
            return hoursAge > 2;
        }).length;
        if (stuckCount > 0) {
            console.log(`🚨 ${stuckCount} records appear to be stuck (older than 2 hours)`);
            console.log('💡 Run: npm run clean:cron-status --yes   to reset them');
        }
        else {
            console.log('✅ All RUNNING records appear to be recent (not stuck)');
        }
    }
    catch (error) {
        console.error('💥 Fatal error during check:', error);
        process.exit(1);
    }
}
// Run the appropriate function based on arguments
const args = process.argv.slice(2);
const isCheckMode = args.includes('--check') || args.includes('-c');
if (require.main === module) {
    if (isCheckMode) {
        checkStuckRecords().catch((error) => {
            console.error('💥 Fatal error:', error);
            process.exit(1);
        });
    }
    else {
        cleanStuckCronStatus().catch((error) => {
            console.error('💥 Fatal error:', error);
            process.exit(1);
        });
    }
}
