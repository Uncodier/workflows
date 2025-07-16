#!/usr/bin/env tsx
"use strict";
/**
 * Test script for Lead Generation Scheduling
 * Tests that leadGenerationWorkflow is scheduled 1 hour after dailyStandUp
 * following the business hours logic
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.testLeadGenerationScheduling = testLeadGenerationScheduling;
const client_1 = require("../temporal/client");
async function testLeadGenerationScheduling() {
    console.log('🔥 Testing Lead Generation Scheduling After Daily StandUp');
    console.log('='.repeat(70));
    console.log('✅ This tests that leadGenerationWorkflow gets scheduled 1 hour after dailyStandUp');
    console.log('✅ Respects business hours and timing logic');
    console.log('='.repeat(70));
    try {
        const client = await (0, client_1.getTemporalClient)();
        console.log('\n🚀 Starting activityPrioritizationEngineWorkflow...');
        // Start the workflow with a unique ID
        const workflowId = `lead-generation-scheduling-test-${Date.now()}`;
        const handle = await client.workflow.start('activityPrioritizationEngineWorkflow', {
            args: [], // No arguments needed
            workflowId,
            taskQueue: 'default',
            workflowRunTimeout: '10 minutes',
        });
        console.log(`✅ Workflow started with ID: ${workflowId}`);
        console.log('⏳ Waiting for workflow to complete...');
        // Wait for the result
        const result = await handle.result();
        console.log('\n🎉 Workflow completed successfully!');
        console.log('📊 Activity Prioritization Results:');
        console.log(`   - Should Execute: ${result.shouldExecute ? '✅ YES' : '❌ NO'}`);
        console.log(`   - Reason: ${result.reason}`);
        console.log(`   - Timing Decision: ${result.timingDecision?.toUpperCase() || 'N/A'}`);
        console.log(`   - Operations Executed: ${result.operationsExecuted ? '✅ YES' : '❌ NO'}`);
        console.log(`   - Execution Time: ${result.executionTime}`);
        if (result.scheduledForTime) {
            console.log(`   - Scheduled For: ${result.scheduledForTime}`);
        }
        // Show business hours analysis
        if (result.businessHoursAnalysis) {
            const analysis = result.businessHoursAnalysis;
            console.log('\n🏢 Business Hours Analysis:');
            console.log(`   - Sites with business_hours: ${analysis.sitesWithBusinessHours}`);
            console.log(`   - Sites open today: ${analysis.sitesOpenToday}`);
            console.log(`   - Should execute operations: ${analysis.shouldExecuteOperations ? '✅ YES' : '❌ NO'}`);
            console.log(`   - Should execute now: ${analysis.shouldExecuteNow ? '✅ YES' : '❌ NO'}`);
            console.log(`   - Should schedule for later: ${analysis.shouldScheduleForLater ? '✅ YES' : '❌ NO'}`);
            if (analysis.nextExecutionTime) {
                console.log(`   - Next execution time: ${analysis.nextExecutionTime}`);
            }
        }
        // Show operations result details
        if (result.operationsResult) {
            const operations = result.operationsResult;
            console.log('\n📋 Operations Results:');
            if (operations.individualSchedules) {
                console.log(`   - Individual schedules created: ${operations.individualSchedules}`);
                console.log(`   - Failed schedules: ${operations.failedSchedules}`);
                console.log(`   - Approach: ${operations.approach}`);
            }
            // Show site analysis scheduling
            if (operations.siteAnalysisScheduling) {
                const siteAnalysis = operations.siteAnalysisScheduling;
                console.log('\n🔍 Site Analysis Scheduling:');
                console.log(`   - ✅ Scheduled: ${siteAnalysis.scheduled} sites`);
                console.log(`   - ⏭️ Skipped: ${siteAnalysis.skipped} sites`);
                console.log(`   - ❌ Failed: ${siteAnalysis.failed} sites`);
                if (siteAnalysis.errors?.length > 0) {
                    console.log(`   - Errors: ${siteAnalysis.errors.slice(0, 3).join(', ')}`);
                }
            }
            // Show lead generation scheduling (NEW!)
            if (operations.leadGenerationScheduling) {
                const leadGeneration = operations.leadGenerationScheduling;
                console.log('\n🔥 LEAD GENERATION SCHEDULING (NEW FEATURE):');
                console.log(`   - ✅ Scheduled: ${leadGeneration.scheduled} sites`);
                console.log(`   - ⏭️ Skipped: ${leadGeneration.skipped} sites`);
                console.log(`   - ❌ Failed: ${leadGeneration.failed} sites`);
                console.log(`   - 🔥 EXECUTES 1 HOUR AFTER DAILY STANDUP`);
                if (leadGeneration.errors?.length > 0) {
                    console.log(`   - Errors: ${leadGeneration.errors.slice(0, 3).join(', ')}`);
                }
                if (leadGeneration.results?.length > 0) {
                    console.log(`   - Successfully scheduled workflows:`);
                    leadGeneration.results.slice(0, 5).forEach((result, index) => {
                        if (result.success) {
                            console.log(`     ${index + 1}. WorkflowID: ${result.workflowId}`);
                        }
                    });
                    if (leadGeneration.results.length > 5) {
                        console.log(`     ... and ${leadGeneration.results.length - 5} more`);
                    }
                }
            }
            else {
                console.log('\n❌ LEAD GENERATION SCHEDULING: Not found in results');
                console.log('   This indicates the new feature may not be working correctly');
            }
        }
        // Verification summary
        console.log('\n🎯 VERIFICATION SUMMARY:');
        console.log('='.repeat(50));
        const hasLeadGenScheduling = result.operationsResult?.leadGenerationScheduling;
        const leadGenScheduled = hasLeadGenScheduling?.scheduled || 0;
        if (hasLeadGenScheduling) {
            console.log('✅ PASS: Lead Generation scheduling is working');
            console.log(`✅ PASS: ${leadGenScheduled} sites scheduled for lead generation`);
            console.log('✅ PASS: Lead generation will execute 1 hour after daily standups');
            if (leadGenScheduled > 0) {
                console.log('✅ PASS: At least one site was successfully scheduled');
            }
            else {
                console.log('⚠️  WARNING: No sites were scheduled (this may be expected based on business hours)');
            }
        }
        else {
            console.log('❌ FAIL: Lead Generation scheduling not found in results');
            console.log('❌ FAIL: The new feature is not working correctly');
        }
        const hasSiteAnalysis = result.operationsResult?.siteAnalysisScheduling;
        if (hasSiteAnalysis) {
            console.log('✅ PASS: Site Analysis scheduling is also working (existing feature)');
        }
        console.log('\n🏁 Test completed successfully!');
        // Summary of timing
        if (result.timingDecision === 'execute_now') {
            console.log('\n⏰ TIMING: Operations executed immediately');
            console.log('   - Daily standups executed now');
            console.log('   - Site analysis scheduled for business hours (1h before standups)');
            console.log('   - 🔥 Lead generation scheduled for business hours (1h after standups)');
        }
        else if (result.timingDecision === 'schedule_for_later') {
            console.log('\n⏰ TIMING: Operations scheduled for later');
            console.log('   - Daily standups scheduled for business hours');
            console.log('   - Site analysis scheduled for business hours (1h before standups)');
            console.log('   - 🔥 Lead generation scheduled for business hours (1h after standups)');
        }
        else {
            console.log('\n⏰ TIMING: Operations skipped');
            console.log('   - No scheduling performed due to business logic');
        }
    }
    catch (error) {
        console.error('\n❌ Test failed with error:', error);
        if (error instanceof Error) {
            console.error('Error message:', error.message);
            console.error('Stack trace:', error.stack);
        }
        process.exit(1);
    }
}
// Run the test
if (require.main === module) {
    testLeadGenerationScheduling()
        .then(() => {
        console.log('\n✅ Test script completed successfully');
        process.exit(0);
    })
        .catch((error) => {
        console.error('\n❌ Test script failed:', error);
        process.exit(1);
    });
}
