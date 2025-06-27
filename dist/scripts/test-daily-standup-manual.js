#!/usr/bin/env tsx
"use strict";
/**
 * Manual test script for Daily Stand Up Workflow
 * Tests the workflow directly without relying on schedules
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.testDailyStandUpManual = testDailyStandUpManual;
const client_1 = require("../temporal/client");
const dailyStandUpWorkflow_1 = require("../temporal/workflows/dailyStandUpWorkflow");
const supabaseService_1 = require("../temporal/services/supabaseService");
async function testDailyStandUpManual() {
    console.log('🧪 Manual Daily Stand Up Workflow Test');
    console.log('=====================================\n');
    try {
        // Get a site to test with
        const supabaseService = (0, supabaseService_1.getSupabaseService)();
        const sites = await supabaseService.fetchSites();
        if (sites.length === 0) {
            throw new Error('No sites found for testing');
        }
        const testSite = sites[0]; // Use first site
        console.log(`🏢 Testing with site: ${testSite.name} (${testSite.id})`);
        const client = await (0, client_1.getTemporalClient)();
        const testOptions = {
            site_id: testSite.id,
            userId: testSite.user_id,
            additionalData: {
                testMode: true,
                triggeredBy: 'manual-test',
                testTime: new Date().toISOString()
            }
        };
        console.log('🚀 Starting workflow manually...');
        const workflowId = `manual-daily-standup-${testSite.id}-${Date.now()}`;
        const handle = await client.workflow.start(dailyStandUpWorkflow_1.dailyStandUpWorkflow, {
            args: [testOptions],
            taskQueue: 'default',
            workflowId: workflowId,
        });
        console.log(`✅ Workflow started successfully`);
        console.log(`🔗 Workflow ID: ${handle.workflowId}`);
        console.log(`📋 Run ID: ${handle.firstExecutionRunId}`);
        console.log('\n⏳ Waiting for completion...\n');
        // Wait for result with timeout
        const result = await Promise.race([
            handle.result(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Workflow timeout after 5 minutes')), 5 * 60 * 1000))
        ]);
        console.log('🎉 Workflow completed!\n');
        console.log('📊 Results:');
        console.log(`   - Success: ${result.success}`);
        console.log(`   - Site: ${result.siteName} (${result.siteId})`);
        console.log(`   - Command ID: ${result.command_id || 'None'}`);
        console.log(`   - Execution Time: ${result.executionTime}`);
        console.log(`   - Errors: ${result.errors.length}`);
        if (result.errors.length > 0) {
            console.log('\n❌ Errors:');
            result.errors.forEach((error, i) => console.log(`   ${i + 1}. ${error}`));
        }
        return result;
    }
    catch (error) {
        console.error('❌ Manual test failed:', error);
        throw error;
    }
}
// Run if executed directly
if (require.main === module) {
    testDailyStandUpManual()
        .then(() => {
        console.log('\n✅ Manual test completed successfully');
        process.exit(0);
    })
        .catch((error) => {
        console.error('\n❌ Manual test failed:', error);
        process.exit(1);
    });
}
