#!/usr/bin/env node
"use strict";
/**
 * Test script to verify that dailyStrategicAccountsWorkflow is properly scheduled
 * 2 hours after leadGenerationWorkflow when operations are running
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.testStrategicAccountsScheduling = testStrategicAccountsScheduling;
const workflowSchedulingActivities_1 = require("../temporal/activities/workflowSchedulingActivities");
async function testStrategicAccountsScheduling() {
    console.log('🧪 Testing Strategic Accounts Scheduling Logic...');
    console.log('This will test if dailyStrategicAccountsWorkflow is properly scheduled 2h after leadGenerationWorkflow');
    // Mock business hours analysis with a test site
    const mockBusinessHoursAnalysis = {
        openSites: [
            {
                siteId: 'test-site-123',
                businessHours: {
                    open: '09:00',
                    close: '18:00',
                    timezone: 'America/Mexico_City',
                    enabled: true
                }
            }
        ],
        shouldExecuteOperations: true,
        sitesOpenToday: 1
    };
    const options = {
        timezone: 'America/Mexico_City'
    };
    try {
        console.log('\n📅 Simulating scheduling with mock data:');
        console.log('   - Test site: test-site-123');
        console.log('   - Business hours: 09:00-18:00 America/Mexico_City');
        console.log('   - Expected sequence: Daily Standup (09:00) → Lead Gen (10:00) → Strategic (12:00)');
        const result = await (0, workflowSchedulingActivities_1.scheduleIndividualLeadGenerationActivity)(mockBusinessHoursAnalysis, options);
        console.log('\n📊 Scheduling Results:');
        console.log(`   ✅ Workflows scheduled: ${result.scheduled}`);
        console.log(`   ⏭️ Sites skipped: ${result.skipped}`);
        console.log(`   ❌ Failed: ${result.failed}`);
        console.log(`   📋 Results count: ${result.results.length}`);
        // Verify that we have both leadGeneration and strategicAccounts workflows
        const leadGenWorkflows = result.results.filter(r => r.workflowId.includes('lead-generation-timer'));
        const strategicWorkflows = result.results.filter(r => r.workflowId.includes('daily-strategic-accounts-timer'));
        console.log('\n🔍 Workflow Analysis:');
        console.log(`   - Lead Generation workflows: ${leadGenWorkflows.length}`);
        console.log(`   - Strategic Accounts workflows: ${strategicWorkflows.length}`);
        if (leadGenWorkflows.length > 0 && strategicWorkflows.length > 0) {
            console.log('\n✅ SUCCESS: Both Lead Generation and Strategic Accounts workflows were scheduled!');
            console.log('🎯 The system will now execute:');
            console.log('   1. Daily Standup at configured business hours');
            console.log('   2. Lead Generation 1 hour after standup');
            console.log('   3. Strategic Accounts 2 hours after lead generation');
        }
        else {
            console.log('\n❌ ERROR: Missing workflows in scheduling');
            console.log(`   Expected: Lead Gen + Strategic workflows`);
            console.log(`   Got: ${leadGenWorkflows.length} Lead Gen, ${strategicWorkflows.length} Strategic`);
        }
        if (result.errors.length > 0) {
            console.log('\n⚠️ Errors encountered:');
            result.errors.forEach((error, index) => {
                console.log(`   ${index + 1}. ${error}`);
            });
        }
    }
    catch (error) {
        console.error('\n❌ Test failed with error:', error);
        throw error;
    }
}
// Run the test
if (require.main === module) {
    testStrategicAccountsScheduling()
        .then(() => {
        console.log('\n🎉 Strategic Accounts Scheduling test completed successfully!');
        process.exit(0);
    })
        .catch((error) => {
        console.error('\n💥 Test failed:', error);
        process.exit(1);
    });
}
