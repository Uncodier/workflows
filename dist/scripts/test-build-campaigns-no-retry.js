#!/usr/bin/env node
"use strict";
/**
 * Test script for buildCampaignsWorkflow with no-retry policy
 * Tests the new behavior where campaign failures are treated as non-critical
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.testBuildCampaignsNoRetry = testBuildCampaignsNoRetry;
const client_1 = require("../temporal/client");
const workflows_1 = require("../temporal/workflows");
async function testBuildCampaignsNoRetry() {
    console.log('🧪 Testing buildCampaignsWorkflow with no-retry policy...');
    const testParams = {
        siteId: '0de521da-0406-44c3-85e5-8b4c0cc8f271', // The site ID from your error
        campaignData: {
            segmentIds: [],
            description: 'Test campaign creation with new no-retry policy'
        }
    };
    try {
        console.log('📋 Test parameters:', JSON.stringify(testParams, null, 2));
        // Use the configured Temporal client
        const client = await (0, client_1.getTemporalClient)();
        const workflowId = `test-build-campaigns-no-retry-${Date.now()}`;
        console.log(`🔄 Starting workflow with ID: ${workflowId}`);
        const handle = await client.workflow.start(workflows_1.workflows.buildCampaignsWorkflow, {
            taskQueue: 'default',
            workflowId,
            args: [testParams],
        });
        console.log('⏳ Waiting for workflow completion...');
        // Wait for the result
        const result = await handle.result();
        console.log('\n✅ Test completed!');
        console.log('📊 Result:', JSON.stringify(result, null, 2));
        if (result.success) {
            console.log('\n🎉 Workflow completed successfully');
            if (result.warnings && result.warnings.length > 0) {
                console.log('⚠️ Non-critical warnings detected:');
                result.warnings.forEach((warning, index) => {
                    console.log(`   ${index + 1}. ${warning}`);
                });
                console.log('✅ Workflow continued despite warnings (as expected)');
            }
            if (result.campaign) {
                console.log('📈 Campaign was created successfully');
            }
            else {
                console.log('⏭️ Campaign creation was skipped (non-critical failure)');
            }
            if (result.requirements) {
                console.log('📋 Requirements were created successfully');
            }
            else {
                console.log('⏭️ Requirements creation was skipped');
            }
        }
        else {
            console.log('\n❌ Test failed:', result.error);
        }
    }
    catch (error) {
        console.error('\n💥 Test threw an exception:', error);
        // This should NOT happen with the new no-retry policy
        // Campaign failures should be caught and handled gracefully
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes('CAMPAIGN_PLANNING_FAILED')) {
            console.log('\n⚠️ This error should now be handled gracefully with the new no-retry policy');
            console.log('   The workflow should continue and return success with warnings');
        }
    }
}
// Helper function to demonstrate the new behavior
async function demonstrateNewBehavior() {
    console.log('\n📚 New Behavior Demonstration:');
    console.log('================================================');
    console.log('1. ✅ Critical operations (site validation, segments) still retry on failure');
    console.log('2. ⚠️ Non-critical operations (campaign creation) fail gracefully without retries');
    console.log('3. 🔄 Workflow continues execution even if campaigns fail');
    console.log('4. ✅ Workflow returns success:true with warnings array for non-critical failures');
    console.log('5. 📊 Partial results are still returned (siteInfo, segmentsUsed)');
    console.log('================================================\n');
}
async function main() {
    await demonstrateNewBehavior();
    await testBuildCampaignsNoRetry();
}
if (require.main === module) {
    main().catch(console.error);
}
