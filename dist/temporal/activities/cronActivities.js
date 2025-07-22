"use strict";
/**
 * Cron Activities
 * Modular activities for managing cron status records across workflows
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveCronStatusActivity = saveCronStatusActivity;
exports.batchSaveCronStatusActivity = batchSaveCronStatusActivity;
exports.getCronStatusActivity = getCronStatusActivity;
exports.shouldRunWorkflowActivity = shouldRunWorkflowActivity;
exports.cleanStuckRunningStatusActivity = cleanStuckRunningStatusActivity;
const services_1 = require("../services");
/**
 * Save or update a single cron status record
 * This is a modular activity that can be used by multiple workflows
 */
async function saveCronStatusActivity(update) {
    console.log(`📝 Saving cron status for ${update.activityName} (Site: ${update.siteId})`);
    try {
        const supabaseService = (0, services_1.getSupabaseService)();
        const isConnected = await supabaseService.getConnectionStatus();
        if (!isConnected) {
            console.log('⚠️  Database not available, logging to console...');
            logCronStatusUpdate(update);
            return;
        }
        // Prepare cron status record
        const cronStatusRecord = {
            site_id: update.siteId,
            workflow_id: update.workflowId,
            schedule_id: update.scheduleId,
            activity_name: update.activityName,
            status: update.status,
            last_run: update.lastRun || (update.status === 'COMPLETED' || update.status === 'FAILED' ? new Date().toISOString() : null),
            next_run: update.nextRun || null,
            error_message: update.errorMessage || null,
            retry_count: update.retryCount || (update.errorMessage ? 1 : 0)
        };
        // Upsert single cron status record
        await supabaseService.batchUpsertCronStatus([cronStatusRecord]);
        console.log(`✅ Successfully saved cron status for ${update.activityName}`);
    }
    catch (error) {
        console.error(`❌ Error saving cron status for ${update.activityName}:`, error);
        // Fallback to console logging if database operations fail
        console.log('⚠️  Database update failed, logging to console...');
        logCronStatusUpdate(update);
    }
}
/**
 * Save or update multiple cron status records in batch
 * This is useful for workflows that need to update multiple sites at once
 */
async function batchSaveCronStatusActivity(updates) {
    console.log(`📝 Batch saving ${updates.length} cron status records...`);
    try {
        const supabaseService = (0, services_1.getSupabaseService)();
        const isConnected = await supabaseService.getConnectionStatus();
        if (!isConnected) {
            console.log('⚠️  Database not available, logging to console...');
            updates.forEach(update => logCronStatusUpdate(update));
            return;
        }
        // Prepare cron status records
        const cronStatusRecords = updates.map(update => ({
            site_id: update.siteId,
            workflow_id: update.workflowId,
            schedule_id: update.scheduleId,
            activity_name: update.activityName,
            status: update.status,
            last_run: update.lastRun || (update.status === 'COMPLETED' || update.status === 'FAILED' ? new Date().toISOString() : null),
            next_run: update.nextRun || null,
            error_message: update.errorMessage || null,
            retry_count: update.retryCount || (update.errorMessage ? 1 : 0)
        }));
        // Batch upsert cron status records
        await supabaseService.batchUpsertCronStatus(cronStatusRecords);
        console.log(`✅ Successfully saved ${updates.length} cron status records`);
    }
    catch (error) {
        console.error('❌ Error in batch save cron status:', error);
        // Fallback to console logging if database operations fail
        console.log('⚠️  Database update failed, logging to console...');
        updates.forEach(update => logCronStatusUpdate(update));
    }
}
/**
 * Get cron status for a specific workflow and sites
 * This can be used to check the last run status before scheduling
 */
async function getCronStatusActivity(activityName, siteIds) {
    console.log(`🔍 Fetching cron status for ${activityName} and ${siteIds.length} sites...`);
    try {
        const supabaseService = (0, services_1.getSupabaseService)();
        const isConnected = await supabaseService.getConnectionStatus();
        if (!isConnected) {
            console.log('⚠️  Database not available, returning empty results');
            return [];
        }
        const cronData = await supabaseService.fetchCronStatus(activityName, siteIds);
        console.log(`✅ Found ${cronData?.length || 0} cron status records`);
        return cronData || [];
    }
    catch (error) {
        console.error(`❌ Error fetching cron status for ${activityName}:`, error);
        return [];
    }
}
/**
 * Check if a workflow needs to run based on last run time
 * Returns true if the workflow should run (hasn't run in the specified hours)
 */
async function shouldRunWorkflowActivity(activityName, siteId, minHoursBetweenRuns = 1) {
    console.log(`🔍 Checking if ${activityName} should run for site ${siteId} (min interval: ${minHoursBetweenRuns}h)`);
    try {
        const cronData = await getCronStatusActivity(activityName, [siteId]);
        const siteStatus = cronData.find(record => record.site_id === siteId);
        if (!siteStatus) {
            return {
                shouldRun: true,
                reason: 'No previous run found - needs initial scheduling'
            };
        }
        if (!siteStatus.last_run) {
            return {
                shouldRun: true,
                reason: 'Scheduled but never executed - needs to run',
                lastRun: siteStatus.last_run
            };
        }
        const lastRunTime = new Date(siteStatus.last_run);
        const now = new Date();
        const hoursSinceLastRun = (now.getTime() - lastRunTime.getTime()) / (1000 * 60 * 60);
        const shouldRun = hoursSinceLastRun >= minHoursBetweenRuns;
        return {
            shouldRun,
            reason: shouldRun
                ? `Last run was ${hoursSinceLastRun.toFixed(1)}h ago - needs to run`
                : `Last run was ${hoursSinceLastRun.toFixed(1)}h ago - too recent`,
            lastRun: siteStatus.last_run
        };
    }
    catch (error) {
        console.error(`❌ Error checking workflow run status:`, error);
        // Default to should run in case of error
        return {
            shouldRun: true,
            reason: 'Error checking status - defaulting to run'
        };
    }
}
/**
 * Clean stuck RUNNING cron status records automatically
 * This helps prevent the workflow manager from getting confused
 * about what workflows are actually running
 */
async function cleanStuckRunningStatusActivity(hoursThreshold = 6) {
    console.log(`🧹 Auto-cleaning stuck RUNNING cron status records older than ${hoursThreshold} hours...`);
    const errors = [];
    let cleaned = 0;
    try {
        const supabaseService = (0, services_1.getSupabaseService)();
        const isConnected = await supabaseService.getConnectionStatus();
        if (!isConnected) {
            console.log('⚠️  Database not available for cleanup');
            return { cleaned: 0, errors: ['Database not available'] };
        }
        // Find stuck RUNNING records
        const stuckRecords = await supabaseService.fetchStuckCronStatus(hoursThreshold);
        if (!stuckRecords || stuckRecords.length === 0) {
            console.log('✅ No stuck RUNNING records found');
            return { cleaned: 0, errors: [] };
        }
        console.log(`🔧 Found ${stuckRecords.length} stuck records to clean up`);
        // Reset each stuck record to FAILED
        for (const record of stuckRecords) {
            try {
                const updatedAt = new Date(record.updated_at);
                const hoursStuck = (Date.now() - updatedAt.getTime()) / (1000 * 60 * 60);
                const errorMessage = `Auto-reset from stuck RUNNING state after ${hoursStuck.toFixed(1)}h by preventive cleanup`;
                await supabaseService.resetCronStatusToFailed(record.id, errorMessage);
                console.log(`✅ Auto-cleaned stuck ${record.activity_name} for site ${record.site_id?.substring(0, 8)}...`);
                cleaned++;
            }
            catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                console.error(`❌ Failed to clean record ${record.id}: ${errorMessage}`);
                errors.push(`Failed to clean ${record.activity_name}: ${errorMessage}`);
            }
        }
        console.log(`🎉 Auto-cleanup completed: ${cleaned} records cleaned, ${errors.length} errors`);
        return { cleaned, errors };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Error in cleanStuckRunningStatusActivity: ${errorMessage}`);
        errors.push(`Cleanup activity error: ${errorMessage}`);
        return { cleaned, errors };
    }
}
/**
 * Log cron status update to console (fallback method)
 */
function logCronStatusUpdate(update) {
    console.log(`📝 [MOCK] Cron status update for ${update.activityName}:`);
    console.log(`   - Site ID: ${update.siteId}`);
    console.log(`   - Workflow ID: ${update.workflowId}`);
    console.log(`   - Schedule ID: ${update.scheduleId}`);
    console.log(`   - Status: ${update.status}`);
    if (update.lastRun) {
        console.log(`   - Last Run: ${update.lastRun}`);
    }
    if (update.nextRun) {
        console.log(`   - Next Run: ${update.nextRun}`);
    }
    if (update.errorMessage) {
        console.log(`   - Error: ${update.errorMessage}`);
    }
    console.log(`   - Retry Count: ${update.retryCount || 0}`);
}
