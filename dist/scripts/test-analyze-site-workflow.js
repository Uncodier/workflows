#!/usr/bin/env ts-node
"use strict";
/**
 * Test script for analyzeSiteWorkflow
 * This script tests the new UX analysis workflow
 */
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("../temporal/client");
const analyzeSiteWorkflow_1 = require("../temporal/workflows/analyzeSiteWorkflow");
async function main() {
    console.log('🔍 Starting Analyze Site Workflow test...');
    // Create Temporal client
    const client = await (0, client_1.getTemporalClient)();
    // Example site ID for testing
    const siteId = process.env.TEST_SITE_ID || 'test-site-001';
    console.log(`📝 Testing with site ID: ${siteId}`);
    // Options for the workflow
    const options = {
        site_id: siteId,
        userId: 'test-user-id',
        additionalData: {
            testMode: true,
            source: 'test-script',
            timestamp: new Date().toISOString()
        }
    };
    const workflowId = `test-analyze-site-${siteId}-${Date.now()}`;
    console.log(`🚀 Starting workflow with ID: ${workflowId}`);
    console.log(`📋 Options:`, JSON.stringify(options, null, 2));
    try {
        // Start the workflow
        const handle = await client.workflow.start(analyzeSiteWorkflow_1.analyzeSiteWorkflow, {
            args: [options],
            taskQueue: 'default',
            workflowId: workflowId,
        });
        console.log(`✅ Workflow started with ID: ${handle.workflowId}`);
        console.log(`🏃 Workflow execution ID: ${handle.firstExecutionRunId}`);
        // Wait for the workflow to complete
        console.log('⏳ Waiting for workflow to complete...');
        const result = await handle.result();
        console.log('\n🎉 Workflow completed successfully!');
        console.log('📊 Result:', JSON.stringify(result, null, 2));
        // Print summary
        console.log('\n📋 Summary:');
        console.log(`   - Success: ${result.success}`);
        console.log(`   - Site ID: ${result.siteId}`);
        console.log(`   - Site Name: ${result.siteName || 'N/A'}`);
        console.log(`   - Site URL: ${result.siteUrl || 'N/A'}`);
        console.log(`   - Analysis Success: ${result.analysisResult?.success || false}`);
        console.log(`   - Assimilate Success: ${result.assimilateResult?.success || false}`);
        console.log(`   - Experiments Success: ${result.experimentsResult?.success || false}`);
        console.log(`   - Errors: ${result.errors.length}`);
        console.log(`   - Execution Time: ${result.executionTime}`);
        if (result.errors.length > 0) {
            console.log('\n⚠️ Errors encountered:');
            result.errors.forEach((error, index) => {
                console.log(`   ${index + 1}. ${error}`);
            });
        }
    }
    catch (error) {
        console.error('❌ Workflow failed:', error);
        process.exit(1);
    }
}
// Run the test
main().catch((error) => {
    console.error('❌ Test failed:', error);
    process.exit(1);
});
