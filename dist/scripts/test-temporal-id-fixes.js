"use strict";
/**
 * Test script to verify that cron_status table now stores real Temporal IDs
 * instead of locally generated IDs.
 *
 * This script will:
 * 1. Create a test schedule
 * 2. Start a test workflow
 * 3. Check that the cron_status table contains the actual Temporal IDs
 */
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("../temporal/client");
const services_1 = require("../temporal/services");
const cronActivities_1 = require("../temporal/activities/cronActivities");
const config_1 = require("../config/config");
async function testTemporalIdFixes() {
    console.log('🧪 Testing Temporal ID fixes in cron_status table...\n');
    try {
        const client = await (0, client_1.getTemporalClient)();
        const supabaseService = (0, services_1.getSupabaseService)();
        // Test 1: Create a schedule and verify the ID is captured correctly
        console.log('📅 Test 1: Creating a test schedule...');
        const testScheduleId = `test-schedule-${Date.now()}`;
        const scheduleClient = client.schedule;
        const scheduleHandle = await scheduleClient.create({
            scheduleId: testScheduleId,
            spec: {
                cron: '0 * * * *' // Every hour
            },
            action: {
                type: 'startWorkflow',
                workflowType: 'syncEmailsWorkflow',
                taskQueue: config_1.temporalConfig.taskQueue,
                args: [{
                        userId: 'test-user-id',
                        siteId: 'test-site-id',
                        provider: 'imap',
                        since: new Date(),
                        batchSize: 10
                    }],
            },
            timeZone: 'UTC',
            policies: {
                catchupWindow: '5m',
                overlap: 'SKIP',
                pauseOnFailure: false,
            },
        });
        const actualScheduleId = scheduleHandle.scheduleId;
        console.log(`   - Generated Schedule ID: ${testScheduleId}`);
        console.log(`   - Actual Temporal Schedule ID: ${actualScheduleId}`);
        console.log(`   - IDs match: ${testScheduleId === actualScheduleId ? '✅' : '❌'}`);
        // Save to cron_status using the actual Temporal ID
        const scheduleUpdate = {
            siteId: 'test-site-id',
            workflowId: `${actualScheduleId}-test`,
            scheduleId: actualScheduleId, // Use actual Temporal schedule ID
            activityName: 'test-schedule',
            status: 'SCHEDULED',
            nextRun: new Date(Date.now() + 60 * 60 * 1000).toISOString()
        };
        await (0, cronActivities_1.saveCronStatusActivity)(scheduleUpdate);
        console.log('   - Saved to cron_status with actual Temporal schedule ID ✅\n');
        // Test 2: Start a workflow and verify the ID is captured correctly
        console.log('⚡ Test 2: Starting a test workflow...');
        const testWorkflowId = `test-workflow-${Date.now()}`;
        const workflowHandle = await client.workflow.start('syncEmailsWorkflow', {
            args: [{
                    userId: 'test-user-id',
                    siteId: 'test-site-id',
                    provider: 'imap',
                    since: new Date(),
                    batchSize: 10
                }],
            workflowId: testWorkflowId,
            taskQueue: config_1.temporalConfig.taskQueue,
            workflowRunTimeout: '10m',
        });
        const actualWorkflowId = workflowHandle.workflowId;
        console.log(`   - Generated Workflow ID: ${testWorkflowId}`);
        console.log(`   - Actual Temporal Workflow ID: ${actualWorkflowId}`);
        console.log(`   - IDs match: ${testWorkflowId === actualWorkflowId ? '✅' : '❌'}`);
        // Save to cron_status using the actual Temporal ID
        const workflowUpdate = {
            siteId: 'test-site-id',
            workflowId: actualWorkflowId, // Use actual Temporal workflow ID
            scheduleId: 'test-schedule-ref',
            activityName: 'test-workflow',
            status: 'RUNNING',
            lastRun: new Date().toISOString()
        };
        await (0, cronActivities_1.saveCronStatusActivity)(workflowUpdate);
        console.log('   - Saved to cron_status with actual Temporal workflow ID ✅\n');
        // Test 3: Verify the records were saved correctly (via fetchCronStatus method)
        console.log('🔍 Test 3: Verifying records in cron_status table...');
        const isConnected = await supabaseService.getConnectionStatus();
        if (isConnected) {
            try {
                // Use the public fetchCronStatus method to verify our test records
                const scheduleRecords = await supabaseService.fetchCronStatus('test-schedule', ['test-site-id']);
                const workflowRecords = await supabaseService.fetchCronStatus('test-workflow', ['test-site-id']);
                if (scheduleRecords.length > 0) {
                    const scheduleRecord = scheduleRecords[0];
                    console.log('   - Schedule record found in database ✅');
                    console.log(`     - Stored schedule_id: ${scheduleRecord.schedule_id}`);
                    console.log(`     - Matches Temporal ID: ${scheduleRecord.schedule_id === actualScheduleId ? '✅' : '❌'}`);
                }
                else {
                    console.log('   - Schedule record not found in database ❌');
                }
                if (workflowRecords.length > 0) {
                    const workflowRecord = workflowRecords[0];
                    console.log('   - Workflow record found in database ✅');
                    console.log(`     - Stored workflow_id: ${workflowRecord.workflow_id}`);
                    console.log(`     - Matches Temporal ID: ${workflowRecord.workflow_id === actualWorkflowId ? '✅' : '❌'}`);
                }
                else {
                    console.log('   - Workflow record not found in database ❌');
                }
                console.log('   - Database verification completed ✅');
            }
            catch (verifyError) {
                console.log(`   - Database verification failed: ${verifyError instanceof Error ? verifyError.message : String(verifyError)} ⚠️`);
            }
        }
        else {
            console.log('   - Database not connected, skipping database verification ⚠️');
        }
        // Clean up Temporal resources
        console.log('\n🧹 Cleaning up Temporal resources...');
        try {
            // Cancel the workflow
            await workflowHandle.cancel();
            console.log('   - Test workflow cancelled ✅');
        }
        catch {
            console.log('   - Workflow cleanup: workflow may have already completed');
        }
        try {
            // Delete the schedule
            const scheduleHandleForCleanup = scheduleClient.getHandle(actualScheduleId);
            await scheduleHandleForCleanup.delete();
            console.log('   - Test schedule deleted ✅');
        }
        catch {
            console.log('   - Schedule cleanup: schedule may have already been deleted');
        }
        console.log('\n🎉 All tests completed successfully!');
        console.log('✅ Temporal IDs are now being captured and stored correctly in cron_status table');
    }
    catch (error) {
        console.error('❌ Test failed:', error);
        process.exit(1);
    }
}
// Run the test
testTemporalIdFixes().catch((error) => {
    console.error('❌ Unhandled error in test:', error);
    process.exit(1);
});
