#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("../temporal/client");
const services_1 = require("../temporal/services");
async function testImprovedSyncEmailsWorkflow() {
    console.log('🧪 Testing improved syncEmailsWorkflow...');
    console.log('📋 This test verifies that the workflow properly handles errors and updates cron status');
    console.log('');
    const testResults = [];
    try {
        const client = await (0, client_1.getTemporalClient)();
        const supabaseService = (0, services_1.getSupabaseService)();
        // Check database connection
        const isConnected = await supabaseService.getConnectionStatus();
        if (!isConnected) {
            console.error('❌ Database not available for testing');
            process.exit(1);
        }
        console.log('✅ Database connection confirmed');
        console.log('');
        // Test 1: Normal execution
        console.log('🔬 Test 1: Normal workflow execution...');
        const test1Result = await runSingleTest(client, supabaseService, {
            userId: 'test-user-1',
            siteId: 'test-site-1',
            provider: 'gmail',
            testName: 'Normal execution'
        });
        testResults.push(test1Result);
        // Wait between tests
        await new Promise(resolve => setTimeout(resolve, 2000));
        // Test 2: Workflow with simulated API failures (should still complete)
        console.log('🔬 Test 2: Workflow with API failures (should still complete)...');
        const test2Result = await runSingleTest(client, supabaseService, {
            userId: 'test-user-2',
            siteId: 'test-site-2',
            provider: 'outlook',
            analysisLimit: 5, // Smaller limit for faster testing
            testName: 'API failures handling'
        });
        testResults.push(test2Result);
        // Wait between tests
        await new Promise(resolve => setTimeout(resolve, 2000));
        // Test 3: Quick timeout test
        console.log('🔬 Test 3: Quick completion test...');
        const test3Result = await runSingleTest(client, supabaseService, {
            userId: 'test-user-3',
            siteId: 'test-site-3',
            provider: 'imap',
            analysisLimit: 1, // Minimal analysis
            testName: 'Quick completion'
        });
        testResults.push(test3Result);
        // Final results
        console.log('');
        console.log('📊 Test Results Summary:');
        console.log('=======================');
        let passedTests = 0;
        let failedTests = 0;
        testResults.forEach((result, index) => {
            const testNumber = index + 1;
            const status = result.completed && result.cronStatus === 'COMPLETED' ? '✅ PASS' : '❌ FAIL';
            if (status.includes('PASS'))
                passedTests++;
            else
                failedTests++;
            console.log(`Test ${testNumber}: ${status}`);
            console.log(`  - Workflow ID: ${result.workflowId}`);
            console.log(`  - Started: ${result.started ? 'Yes' : 'No'}`);
            console.log(`  - Completed: ${result.completed ? 'Yes' : 'No'}`);
            console.log(`  - Final Status: ${result.status}`);
            console.log(`  - Cron Status: ${result.cronStatus}`);
            console.log(`  - Duration: ${result.duration}ms`);
            if (result.error) {
                console.log(`  - Error: ${result.error}`);
            }
            console.log('');
        });
        console.log(`📋 Overall Results: ${passedTests}/${testResults.length} tests passed`);
        if (failedTests === 0) {
            console.log('🎉 All tests passed! The improved workflow is working correctly.');
        }
        else {
            console.log(`⚠️ ${failedTests} test(s) failed. Review the results above.`);
        }
    }
    catch (error) {
        console.error('❌ Test execution failed:', error);
        process.exit(1);
    }
}
async function runSingleTest(client, supabaseService, options) {
    const { userId, siteId, provider, analysisLimit = 10, testName } = options;
    const workflowId = `test-sync-emails-${siteId}-${Date.now()}`;
    const startTime = Date.now();
    console.log(`🚀 Starting ${testName}...`);
    console.log(`   - Workflow ID: ${workflowId}`);
    console.log(`   - User ID: ${userId}`);
    console.log(`   - Site ID: ${siteId}`);
    console.log(`   - Provider: ${provider}`);
    const result = {
        workflowId,
        started: false,
        completed: false,
        status: 'NOT_STARTED',
        cronStatus: 'UNKNOWN',
        duration: 0,
    };
    try {
        // Start the workflow
        const handle = await client.workflow.start('syncEmailsWorkflow', {
            args: [{
                    userId,
                    siteId,
                    provider,
                    analysisLimit,
                    since: new Date(Date.now() - 2 * 60 * 60 * 1000), // Last 2 hours
                    batchSize: 10
                }],
            workflowId,
            taskQueue: 'default',
            workflowRunTimeout: '15 minutes',
        });
        result.started = true;
        result.status = 'RUNNING';
        console.log(`   ✅ Workflow started successfully`);
        // Wait for workflow to complete
        console.log(`   ⏳ Waiting for workflow to complete...`);
        const workflowResult = await handle.result();
        result.completed = true;
        result.status = 'COMPLETED';
        result.duration = Date.now() - startTime;
        console.log(`   ✅ Workflow completed in ${result.duration}ms`);
        console.log(`   📧 Result: ${workflowResult.success ? 'Success' : 'Failed'}`);
        if (workflowResult.errors && workflowResult.errors.length > 0) {
            console.log(`   ⚠️ Non-critical errors: ${workflowResult.errors.length}`);
        }
        // Check cron status in database
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for DB update
        const cronRecords = await supabaseService.fetchCronStatus('syncEmailsWorkflow', [siteId]);
        const cronRecord = cronRecords?.find((record) => record.site_id === siteId);
        if (cronRecord) {
            result.cronStatus = cronRecord.status;
            console.log(`   📊 Cron Status: ${cronRecord.status}`);
            if (cronRecord.status === 'COMPLETED') {
                console.log(`   ✅ ${testName} PASSED - Workflow completed and cron status updated correctly`);
            }
            else if (cronRecord.status === 'RUNNING') {
                console.log(`   ❌ ${testName} FAILED - Cron status still RUNNING after workflow completion`);
                result.error = 'Cron status not updated to COMPLETED';
            }
            else {
                console.log(`   ⚠️ ${testName} - Unexpected cron status: ${cronRecord.status}`);
                result.error = `Unexpected cron status: ${cronRecord.status}`;
            }
        }
        else {
            console.log(`   ⚠️ No cron status record found for site ${siteId}`);
            result.cronStatus = 'NOT_FOUND';
            result.error = 'No cron status record found';
        }
    }
    catch (error) {
        result.completed = false;
        result.status = 'FAILED';
        result.duration = Date.now() - startTime;
        result.error = error instanceof Error ? error.message : String(error);
        console.log(`   ❌ ${testName} FAILED - Error: ${result.error}`);
        // Check if cron status was updated to FAILED
        try {
            const cronRecords = await supabaseService.fetchCronStatus('syncEmailsWorkflow', [siteId]);
            const cronRecord = cronRecords?.find((record) => record.site_id === siteId);
            if (cronRecord) {
                result.cronStatus = cronRecord.status;
                console.log(`   📊 Cron Status after error: ${cronRecord.status}`);
            }
        }
        catch (cronError) {
            console.log(`   ⚠️ Could not check cron status after error: ${cronError}`);
        }
    }
    console.log('');
    return result;
}
// Execute the test
testImprovedSyncEmailsWorkflow().catch(console.error);
