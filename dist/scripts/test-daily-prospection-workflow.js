"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.testDailyProspectionWorkflow = testDailyProspectionWorkflow;
const client_1 = require("../temporal/client");
async function testDailyProspectionWorkflow() {
    try {
        console.log('🎯 Testing Daily Prospection Workflow...');
        // Connect to Temporal
        const client = await (0, client_1.getTemporalClient)();
        console.log('✅ Connected to Temporal Cloud');
        // Replace with a valid site_id from your database
        const testSiteId = process.env.TEST_SITE_ID || 'your-site-id-here';
        if (testSiteId === 'your-site-id-here') {
            console.error('❌ Please set TEST_SITE_ID environment variable with a valid site ID');
            process.exit(1);
        }
        const options = {
            site_id: testSiteId,
            userId: process.env.TEST_USER_ID, // Optional
            hoursThreshold: 48, // Look for leads older than 48 hours
            maxLeads: 20, // Limit to 20 leads for testing (doubled)
            updateStatus: false, // Don't update lead status for testing
            additionalData: {
                testRun: true,
                executedBy: 'test-script',
                timestamp: new Date().toISOString()
            }
        };
        console.log('📋 Starting workflow with options:', JSON.stringify(options, null, 2));
        // Start the workflow
        const handle = await client.workflow.start('dailyProspectionWorkflow', {
            args: [options],
            taskQueue: 'default',
            workflowId: `daily-prospection-test-${testSiteId}-${Date.now()}`,
            workflowRunTimeout: '10m',
        });
        console.log(`🚀 Workflow started with ID: ${handle.workflowId}`);
        console.log(`📊 Following execution...`);
        // Wait for result
        const result = await handle.result();
        console.log('\n🎉 Workflow completed successfully!');
        console.log('📊 Results:', JSON.stringify(result, null, 2));
        // Summary
        console.log('\n📋 Summary:');
        console.log(`   - Site: ${result.siteName || result.siteId}`);
        console.log(`   - Leads found: ${result.leadsFound}`);
        console.log(`   - Leads processed: ${result.leadsProcessed}`);
        console.log(`   - Tasks created: ${result.tasksCreated}`);
        console.log(`   - Status updated: ${result.statusUpdated}`);
        console.log(`   - Execution time: ${result.executionTime}`);
        if (result.errors.length > 0) {
            console.log(`   - Errors: ${result.errors.length}`);
            result.errors.forEach((error, index) => {
                console.log(`     ${index + 1}. ${error}`);
            });
        }
        // Show prospection results details
        if (result.prospectionResults.length > 0) {
            console.log('\n👥 Prospection Results:');
            result.prospectionResults.forEach((prospectionResult, index) => {
                const lead = prospectionResult.lead;
                console.log(`   ${index + 1}. ${lead.name || lead.email}`);
                console.log(`      - Task created: ${prospectionResult.taskCreated ? '✅' : '❌'}`);
                if (prospectionResult.taskId) {
                    console.log(`      - Task ID: ${prospectionResult.taskId}`);
                }
                console.log(`      - Status updated: ${prospectionResult.statusUpdated ? '✅' : '❌'}`);
                if (prospectionResult.errors.length > 0) {
                    console.log(`      - Errors: ${prospectionResult.errors.join(', ')}`);
                }
            });
        }
    }
    catch (error) {
        console.error('❌ Workflow execution failed:', error);
        if (error instanceof Error) {
            console.error('Error details:', error.message);
            console.error('Stack trace:', error.stack);
        }
        process.exit(1);
    }
}
// Run if called directly
if (require.main === module) {
    testDailyProspectionWorkflow()
        .then(() => {
        console.log('\n✅ Test completed successfully');
        process.exit(0);
    })
        .catch((error) => {
        console.error('\n❌ Test failed:', error);
        process.exit(1);
    });
}
