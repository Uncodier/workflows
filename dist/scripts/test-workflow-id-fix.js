#!/usr/bin/env tsx
"use strict";
/**
 * Test script to verify the workflow ID conflict fix
 * This script will test the activityPrioritizationEngineWorkflow multiple times
 * to ensure that the "Workflow execution already started" error is resolved
 */
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("../temporal/client");
const activityPrioritizationEngineWorkflow_1 = require("../temporal/workflows/activityPrioritizationEngineWorkflow");
async function testWorkflowIdFix() {
    console.log('🧪 Testing Workflow ID Conflict Fix');
    console.log('===================================\n');
    try {
        const client = await (0, client_1.getTemporalClient)();
        console.log('✅ Connected to Temporal server\n');
        // Test 1: Run the activity prioritization engine workflow multiple times
        console.log('📋 Test 1: Running activityPrioritizationEngineWorkflow multiple times');
        console.log('-----------------------------------------------------------------------');
        const testRuns = 3;
        const results = [];
        for (let i = 1; i <= testRuns; i++) {
            console.log(`\n🚀 Test Run ${i}/${testRuns}`);
            const workflowId = `test-activity-prioritization-${Date.now()}-${i}`;
            try {
                const handle = await client.workflow.start(activityPrioritizationEngineWorkflow_1.activityPrioritizationEngineWorkflow, {
                    args: [],
                    taskQueue: 'default',
                    workflowId: workflowId,
                });
                console.log(`✅ Workflow ${i} started successfully: ${handle.workflowId}`);
                // Wait for the workflow to complete
                const result = await handle.result();
                console.log(`🎉 Workflow ${i} completed successfully`);
                console.log(`   - Should Execute: ${result.shouldExecute}`);
                console.log(`   - Timing Decision: ${result.timingDecision}`);
                console.log(`   - Operations Executed: ${result.operationsExecuted}`);
                console.log(`   - Execution Time: ${result.executionTime}`);
                if (result.operationsResult?.individualSchedules) {
                    console.log(`   - Individual Schedules Created: ${result.operationsResult.individualSchedules}`);
                }
                if (result.operationsResult?.failedSchedules && result.operationsResult.failedSchedules > 0) {
                    console.log(`   - Failed Schedules: ${result.operationsResult.failedSchedules}`);
                }
                results.push({
                    run: i,
                    workflowId: handle.workflowId,
                    success: true,
                    result: result
                });
            }
            catch (error) {
                console.error(`❌ Workflow ${i} failed: ${error instanceof Error ? error.message : String(error)}`);
                results.push({
                    run: i,
                    workflowId: workflowId,
                    success: false,
                    error: error instanceof Error ? error.message : String(error)
                });
            }
            // Wait a bit between runs
            if (i < testRuns) {
                console.log('⏳ Waiting 2 seconds before next run...');
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
        // Summary
        console.log('\n📊 Test Results Summary');
        console.log('=======================');
        const successfulRuns = results.filter(r => r.success).length;
        const failedRuns = results.filter(r => !r.success).length;
        console.log(`✅ Successful runs: ${successfulRuns}/${testRuns}`);
        console.log(`❌ Failed runs: ${failedRuns}/${testRuns}`);
        if (failedRuns > 0) {
            console.log('\n❌ Failed runs details:');
            results.filter(r => !r.success).forEach(result => {
                console.log(`   Run ${result.run}: ${result.error}`);
            });
        }
        // Test 2: Check for "Workflow execution already started" errors
        console.log('\n📋 Test 2: Checking for "Workflow execution already started" errors');
        console.log('---------------------------------------------------------------------');
        const workflowAlreadyStartedErrors = results.filter(r => !r.success && r.error?.includes('Workflow execution already started'));
        if (workflowAlreadyStartedErrors.length === 0) {
            console.log('✅ No "Workflow execution already started" errors found!');
            console.log('✅ The fix appears to be working correctly.');
        }
        else {
            console.log(`❌ Found ${workflowAlreadyStartedErrors.length} "Workflow execution already started" errors:`);
            workflowAlreadyStartedErrors.forEach(result => {
                console.log(`   Run ${result.run}: ${result.error}`);
            });
            console.log('❌ The fix may need additional work.');
        }
        // Test 3: Analyze scheduling results
        console.log('\n📋 Test 3: Analyzing scheduling results');
        console.log('--------------------------------------');
        const successfulResults = results.filter(r => r.success);
        if (successfulResults.length > 0) {
            console.log('📊 Scheduling statistics:');
            successfulResults.forEach(result => {
                const operationsResult = result.result.operationsResult;
                if (operationsResult?.individualSchedules) {
                    console.log(`   Run ${result.run}: ${operationsResult.individualSchedules} individual schedules created`);
                    if (operationsResult.scheduleDetails) {
                        const duplicateWorkflows = operationsResult.scheduleDetails.filter((detail) => detail.error?.includes('Workflow already exists'));
                        if (duplicateWorkflows.length > 0) {
                            console.log(`     - ${duplicateWorkflows.length} duplicate workflows handled gracefully`);
                        }
                    }
                }
            });
        }
        console.log('\n🎉 Test completed successfully!');
        if (failedRuns === 0) {
            console.log('✅ All tests passed - the workflow ID conflict fix is working correctly.');
        }
        else {
            console.log('⚠️ Some tests failed - please review the results above.');
        }
    }
    catch (error) {
        console.error('❌ Test failed:', error);
        process.exit(1);
    }
}
// Run the test
testWorkflowIdFix().catch(console.error);
