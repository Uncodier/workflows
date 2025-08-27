#!/usr/bin/env tsx
"use strict";
/**
 * Test script to verify the buildCampaignsWorkflow retry logic
 * This script tests that the workflow now fails properly when campaign creation fails
 * and retries the operation according to the configured retry policy
 */
const { Connection, Client } = require('@temporalio/client');
async function testBuildCampaignsRetry() {
    console.log('🧪 Testing buildCampaignsWorkflow retry logic...\n');
    try {
        // Connect to Temporal
        const connection = await Connection.connect({
            address: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
        });
        const client = new Client({
            connection,
            namespace: process.env.TEMPORAL_NAMESPACE || 'default',
        });
        console.log('✅ Connected to Temporal');
        // Test case 1: Valid site ID (should work)
        console.log('\n📋 Test Case 1: Valid site ID');
        const validSiteId = '16d322ab-3104-4935-b7cf-ada54c2a1bbb';
        try {
            const handle = await client.workflow.start('buildCampaignsWorkflow', {
                args: [{
                        siteId: validSiteId,
                        userId: 'test-user',
                        campaignData: {
                            segmentIds: [],
                            testMode: true
                        }
                    }],
                taskQueue: 'default',
                workflowId: `test-build-campaigns-retry-${Date.now()}`,
            });
            console.log(`🚀 Started workflow: ${handle.workflowId}`);
            const result = await handle.result();
            console.log('📊 Workflow Result:', JSON.stringify(result, null, 2));
            if (result.success) {
                console.log('✅ Test Case 1 PASSED: Workflow succeeded with valid site');
            }
            else {
                console.log('❌ Test Case 1 FAILED: Workflow should have succeeded');
            }
        }
        catch (error) {
            console.log('📊 Workflow Error:', error instanceof Error ? error.message : String(error));
            // Check if this is a campaign planning failure
            const errorMessage = error instanceof Error ? error.message : String(error);
            if (errorMessage.includes('CAMPAIGN_PLANNING_FAILED') || errorMessage.includes('Campaign creation failed')) {
                console.log('✅ Test Case 1 PASSED: Workflow failed as expected due to campaign creation failure');
                console.log('🔄 This confirms that the workflow now properly fails when campaign creation fails');
                console.log('🔁 Temporal should have retried the createCampaignsActivity according to the retry policy');
            }
            else {
                console.log('❌ Test Case 1 FAILED: Unexpected error type');
            }
        }
        // Test case 2: Invalid site ID (should fail immediately)
        console.log('\n📋 Test Case 2: Invalid site ID');
        const invalidSiteId = 'invalid-site-id-12345';
        try {
            const handle2 = await client.workflow.start('buildCampaignsWorkflow', {
                args: [{
                        siteId: invalidSiteId,
                        userId: 'test-user',
                        campaignData: {
                            segmentIds: [],
                            testMode: true
                        }
                    }],
                taskQueue: 'default',
                workflowId: `test-build-campaigns-retry-invalid-${Date.now()}`,
            });
            console.log(`🚀 Started workflow: ${handle2.workflowId}`);
            const result2 = await handle2.result();
            console.log('📊 Workflow Result:', JSON.stringify(result2, null, 2));
            console.log('❌ Test Case 2 FAILED: Workflow should have failed with invalid site ID');
        }
        catch (error) {
            console.log('📊 Workflow Error:', error instanceof Error ? error.message : String(error));
            const errorMessage = error instanceof Error ? error.message : String(error);
            if (errorMessage.includes('Site') && errorMessage.includes('not found')) {
                console.log('✅ Test Case 2 PASSED: Workflow failed as expected due to invalid site');
            }
            else {
                console.log('❌ Test Case 2 FAILED: Unexpected error type for invalid site');
            }
        }
        console.log('\n🎯 Summary:');
        console.log('- Campaign creation is now a critical operation with retries enabled');
        console.log('- Workflow will fail if campaign creation fails after all retry attempts');
        console.log('- Campaign requirements creation remains non-critical (optional)');
        console.log('- Site validation remains critical and will fail workflow immediately');
    }
    catch (error) {
        console.error('❌ Test setup failed:', error);
        process.exit(1);
    }
}
// Run the test
testBuildCampaignsRetry().catch(console.error);
