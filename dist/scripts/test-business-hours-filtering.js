#!/usr/bin/env tsx
"use strict";
/**
 * Test script for Business Hours Filtering Fix
 * Tests that dailyStandUpWorkflow only executes for sites with active business hours
 */
Object.defineProperty(exports, "__esModule", { value: true });
const workflowSchedulingActivities_1 = require("../temporal/activities/workflowSchedulingActivities");
const prioritizationActivities_1 = require("../temporal/activities/prioritizationActivities");
/**
 * Test the business hours filtering functionality
 */
async function testBusinessHoursFiltering() {
    console.log('🧪 Testing Business Hours Filtering Fix');
    console.log('=====================================');
    // Get current day info
    const today = new Date();
    const dayOfWeek = today.getDay(); // 0=Sunday, 1=Monday, etc.
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const currentDay = dayNames[dayOfWeek];
    console.log(`📅 Testing for: ${currentDay} (day ${dayOfWeek})`);
    console.log(`🕐 Current time: ${today.toLocaleString()}`);
    try {
        // Step 1: Test business hours evaluation
        console.log('\n🔍 Step 1: Evaluating business hours for today...');
        const businessHoursAnalysis = await (0, prioritizationActivities_1.evaluateBusinessHoursForDay)(dayOfWeek);
        console.log('\n📊 Business Hours Analysis Result:');
        console.log(`   - Should execute operations: ${businessHoursAnalysis.shouldExecuteOperations}`);
        console.log(`   - Reason: ${businessHoursAnalysis.reason}`);
        console.log(`   - Sites with business_hours: ${businessHoursAnalysis.sitesWithBusinessHours}`);
        console.log(`   - Sites open today: ${businessHoursAnalysis.sitesOpenToday}`);
        if (businessHoursAnalysis.openSites.length > 0) {
            console.log('\n📋 Sites that should execute today:');
            businessHoursAnalysis.openSites.forEach((site, index) => {
                console.log(`   ${index + 1}. Site ${site.siteId}: ${site.businessHours.open} - ${site.businessHours.close}`);
            });
        }
        else {
            console.log('\n⚠️ No sites have active business hours today');
        }
        // Step 2: Test DRY RUN with business hours filtering
        console.log('\n🧪 Step 2: Testing DRY RUN with business hours filtering...');
        const dryRunResult = await (0, workflowSchedulingActivities_1.executeDailyStandUpWorkflowsActivity)({
            dryRun: true,
            testMode: true,
            businessHoursAnalysis
        });
        console.log('\n📊 DRY RUN Results:');
        console.log(`   - Sites that would be executed: ${dryRunResult.scheduled}`);
        console.log(`   - Sites that would be skipped: ${dryRunResult.skipped}`);
        console.log(`   - Sites that would fail: ${dryRunResult.failed}`);
        console.log(`   - Business hours filtering: ${dryRunResult.testInfo?.businessHoursFiltering ? 'ENABLED' : 'DISABLED'}`);
        console.log(`   - Total sites found: ${dryRunResult.testInfo?.totalSites || 0}`);
        if (dryRunResult.testInfo?.siteNames) {
            console.log(`   - Sites to process: ${dryRunResult.testInfo.siteNames.join(', ')}`);
        }
        // Step 3: Validate results
        console.log('\n✅ Step 3: Validating results...');
        if (!businessHoursAnalysis.shouldExecuteOperations) {
            console.log('❌ VALIDATION FAILED: Operations should not execute today, but workflow would run');
            if (dryRunResult.scheduled > 0) {
                console.log(`   Expected: 0 workflows to be scheduled`);
                console.log(`   Actual: ${dryRunResult.scheduled} workflows would be scheduled`);
            }
        }
        else {
            const expectedSites = businessHoursAnalysis.sitesOpenToday;
            const actualSites = dryRunResult.scheduled;
            if (expectedSites === actualSites) {
                console.log('✅ VALIDATION PASSED: Correct number of sites would be executed');
                console.log(`   Expected: ${expectedSites} sites with active business hours`);
                console.log(`   Actual: ${actualSites} sites would be executed`);
            }
            else {
                console.log('❌ VALIDATION FAILED: Mismatch in number of sites');
                console.log(`   Expected: ${expectedSites} sites with active business hours`);
                console.log(`   Actual: ${actualSites} sites would be executed`);
            }
        }
        // Step 4: Test fallback behavior (no business hours analysis)
        console.log('\n🔄 Step 4: Testing fallback behavior (no business hours analysis)...');
        const fallbackResult = await (0, workflowSchedulingActivities_1.executeDailyStandUpWorkflowsActivity)({
            dryRun: true,
            testMode: true,
            maxSites: 3 // Limit for testing
        });
        console.log('\n📊 Fallback Results:');
        console.log(`   - Sites that would be executed: ${fallbackResult.scheduled}`);
        console.log(`   - Business hours filtering: ${fallbackResult.testInfo?.businessHoursFiltering ? 'ENABLED' : 'DISABLED'}`);
        console.log(`   - Mode: Fallback (all sites)`);
        // Summary
        console.log('\n🎯 Summary:');
        console.log('============');
        if (businessHoursAnalysis.shouldExecuteOperations) {
            console.log(`✅ Today (${currentDay}): Operations should execute`);
            console.log(`   - Sites with active business hours: ${businessHoursAnalysis.sitesOpenToday}`);
            console.log(`   - Sites that would be executed: ${dryRunResult.scheduled}`);
            console.log(`   - Filtering working: ${businessHoursAnalysis.sitesOpenToday === dryRunResult.scheduled ? '✅ YES' : '❌ NO'}`);
        }
        else {
            console.log(`⏭️ Today (${currentDay}): Operations should NOT execute`);
            console.log(`   - Reason: ${businessHoursAnalysis.reason}`);
        }
        console.log(`\n🔧 Fix Status: ${businessHoursAnalysis.sitesOpenToday === dryRunResult.scheduled ? '✅ WORKING' : '❌ NEEDS ATTENTION'}`);
    }
    catch (error) {
        console.error('\n❌ Test failed:', error);
        throw error;
    }
}
// Run the test
if (require.main === module) {
    testBusinessHoursFiltering()
        .then(() => {
        console.log('\n🎉 Business Hours Filtering test completed');
        process.exit(0);
    })
        .catch((error) => {
        console.error('\n💥 Business Hours Filtering test failed:', error);
        process.exit(1);
    });
}
