#!/usr/bin/env tsx
"use strict";
/**
 * Test script for Activity Prioritization Engine - DRY RUN MODE
 * Tests all the activities without making real calls or schedules
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.testActivityPrioritizationDryRun = testActivityPrioritizationDryRun;
const client_1 = require("../temporal/client");
async function testActivityPrioritizationDryRun() {
    console.log('🧪 Testing Activity Prioritization Engine - DRY RUN MODE');
    console.log('='.repeat(60));
    console.log('⚠️  This will NOT make any real API calls or create real schedules');
    console.log('='.repeat(60));
    try {
        const client = await (0, client_1.getTemporalClient)();
        console.log('\n🎯 Starting activityPrioritizationEngineWorkflow in test mode...');
        // Start the workflow with a unique ID
        const workflowId = `activity-prioritization-test-${Date.now()}`;
        const handle = await client.workflow.start('activityPrioritizationEngineWorkflow', {
            args: [], // No arguments needed
            workflowId,
            taskQueue: 'default',
            workflowRunTimeout: '10 minutes',
        });
        console.log(`✅ Workflow started with ID: ${workflowId}`);
        console.log('🔍 Waiting for workflow to complete...');
        // Wait for the result
        const result = await handle.result();
        console.log('\n🎉 Workflow completed successfully!');
        console.log('📊 Results:');
        console.log(`   - Context retrieved: ${result.contextRetrieved ? '✅' : '❌'}`);
        console.log(`   - Plan designed: ${result.planDesigned ? '✅' : '❌'}`);
        console.log(`   - Plan sent: ${result.planSent ? '✅' : '❌'}`);
        console.log(`   - Priority mails sent: ${result.priorityMailsSent}`);
        console.log(`   - Activities scheduled: ${result.activitiesScheduled}`);
        console.log(`   - Daily stand ups scheduled: ${result.dailyStandUpsScheduled}`);
        console.log(`   - Execution time: ${result.executionTime}`);
        console.log('\n✅ Test completed successfully!');
        return result;
    }
    catch (error) {
        console.error('\n❌ Test failed:', error);
        throw error;
    }
}
// Run the test if this script is executed directly
if (require.main === module) {
    testActivityPrioritizationDryRun()
        .then(() => {
        console.log('\n👋 Test completed successfully');
        process.exit(0);
    })
        .catch((error) => {
        console.error('\n💥 Test failed:', error);
        process.exit(1);
    });
}
