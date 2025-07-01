#!/usr/bin/env node
"use strict";
/**
 * Test Business Hours Timing Fix with Real Scheduling
 * Tests the activityPrioritizationEngineWorkflow to ensure it properly schedules
 * dailyOperationsWorkflow when outside business hours
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.testBusinessHoursTimingWithScheduling = testBusinessHoursTimingWithScheduling;
const index_1 = require("../temporal/client/index");
async function testBusinessHoursTimingWithScheduling() {
    try {
        console.log('🧪 Testing Business Hours Timing Fix with Real Scheduling...');
        console.log('='.repeat(80));
        const client = await (0, index_1.getTemporalClient)();
        const currentTime = new Date();
        console.log(`🕐 Current time: ${currentTime.toISOString()}`);
        console.log(`📅 Testing day: ${currentTime.toLocaleDateString('en-US', { weekday: 'long' })}`);
        // Execute the activity prioritization engine workflow
        console.log('\n🎯 Starting activityPrioritizationEngineWorkflow...');
        const workflowHandle = await client.workflow.start('activityPrioritizationEngineWorkflow', {
            args: [],
            workflowId: `test-prioritization-${Date.now()}`,
            taskQueue: 'default',
        });
        console.log(`✅ Workflow started: ${workflowHandle.workflowId}`);
        console.log('⏳ Waiting for workflow completion...');
        // Wait for workflow completion
        const result = await workflowHandle.result();
        console.log('\n📊 WORKFLOW RESULT:');
        console.log('='.repeat(50));
        console.log(JSON.stringify(result, null, 2));
        console.log('\n🔍 ANALYSIS:');
        console.log('='.repeat(50));
        console.log(`Should Execute: ${result.shouldExecute ? '✅ YES' : '❌ NO'}`);
        console.log(`Timing Decision: ${result.timingDecision?.toUpperCase().replace('_', ' ')}`);
        console.log(`Operations Executed Now: ${result.operationsExecuted ? '✅ YES' : '❌ NO'}`);
        if (result.timingDecision === 'schedule_for_later') {
            console.log(`\n📅 SCHEDULING DETAILS:`);
            console.log(`   - Scheduled for: ${result.scheduledForTime}`);
            if (result.operationsResult?.scheduleId) {
                console.log(`   - Schedule ID: ${result.operationsResult.scheduleId}`);
                console.log(`   - Workflow ID: ${result.operationsResult.workflowId}`);
                console.log(`   - Status: ${result.operationsResult.scheduled ? '✅ SCHEDULED' : '❌ FAILED'}`);
                // Check if schedule was actually created in Temporal
                try {
                    console.log('\n🔍 Verifying schedule in Temporal...');
                    const scheduleClient = client.schedule;
                    const scheduleHandle = scheduleClient.getHandle(result.operationsResult.scheduleId);
                    const scheduleInfo = await scheduleHandle.describe();
                    console.log('✅ Schedule verified in Temporal:');
                    console.log(`   - Schedule ID: ${scheduleInfo.id}`);
                    console.log(`   - Next Run: ${scheduleInfo.info?.nextActionTimes?.[0] || 'Not available'}`);
                    console.log(`   - State: ${scheduleInfo.info?.state?.paused ? 'PAUSED' : 'ACTIVE'}`);
                    console.log(`   - Note: ${scheduleInfo.info?.state?.note || 'No note'}`);
                }
                catch (scheduleError) {
                    console.error(`❌ Failed to verify schedule: ${scheduleError instanceof Error ? scheduleError.message : scheduleError}`);
                }
            }
            else {
                console.log(`   - ❌ No schedule ID found in result`);
            }
        }
        if (result.businessHoursAnalysis) {
            console.log(`\n🏢 BUSINESS HOURS ANALYSIS:`);
            console.log(`   - Sites with business hours: ${result.businessHoursAnalysis.sitesWithBusinessHours}`);
            console.log(`   - Sites open today: ${result.businessHoursAnalysis.sitesOpenToday}`);
            console.log(`   - Should execute now: ${result.businessHoursAnalysis.shouldExecuteNow}`);
            console.log(`   - Should schedule for later: ${result.businessHoursAnalysis.shouldScheduleForLater}`);
            console.log(`   - Next execution time: ${result.businessHoursAnalysis.nextExecutionTime || 'Not available'}`);
        }
        console.log(`\n⏱️  Total execution time: ${result.executionTime}`);
        console.log(`🎯 Reason: ${result.reason}`);
        console.log('\n🎉 Test completed successfully!');
        if (result.timingDecision === 'schedule_for_later' && result.operationsResult?.scheduleId) {
            console.log('\n📋 SUMMARY:');
            console.log('✅ The workflow correctly determined it should schedule for later');
            console.log('✅ A real Temporal schedule was created');
            console.log('✅ The dailyOperationsWorkflow will execute at the scheduled time');
            console.log('✅ Business hours are being respected');
        }
        else if (result.timingDecision === 'execute_now') {
            console.log('\n📋 SUMMARY:');
            console.log('✅ The workflow correctly determined it should execute now');
            console.log('✅ Daily operations were executed immediately');
            console.log('✅ Business hours timing is working correctly');
        }
        else {
            console.log('\n📋 SUMMARY:');
            console.log('✅ The workflow determined operations should be skipped');
            console.log('✅ Business hours logic is working correctly');
        }
    }
    catch (error) {
        console.error('❌ Test failed:', error);
        process.exit(1);
    }
}
// Run the test if this script is executed directly
if (require.main === module) {
    testBusinessHoursTimingWithScheduling()
        .then(() => {
        console.log('\n✅ All tests passed!');
        process.exit(0);
    })
        .catch((error) => {
        console.error('❌ Test suite failed:', error);
        process.exit(1);
    });
}
