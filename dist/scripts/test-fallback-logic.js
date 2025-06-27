"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const workflowSchedulingActivities_1 = require("../temporal/activities/workflowSchedulingActivities");
/**
 * Test the new fallback logic for Daily Stand Up scheduling
 * - Sites with business_hours: Always schedule
 * - Sites without business_hours (fallback): Only immediate execution Mon-Fri 8AM-4PM Mexico
 */
async function testFallbackLogic() {
    console.log('🧪 Testing Fallback Logic for Daily Stand Up Scheduling');
    console.log('====================================================');
    const now = new Date();
    const mexicoTime = new Date(now.toLocaleString("en-US", { timeZone: 'America/Mexico_City' }));
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayOfWeek = mexicoTime.getDay();
    const currentHour = mexicoTime.getHours();
    const currentMinute = mexicoTime.getMinutes();
    console.log(`📅 Current time: ${mexicoTime.toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })}`);
    console.log(`📅 Day: ${dayNames[dayOfWeek]} (${dayOfWeek})`);
    console.log(`🕐 Time: ${currentHour}:${currentMinute.toString().padStart(2, '0')}`);
    // Check if we're in the fallback execution window
    const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5; // Monday-Friday
    const currentTimeInMinutes = currentHour * 60 + currentMinute;
    const eightAMInMinutes = 8 * 60; // 8:00 AM
    const fourPMInMinutes = 16 * 60; // 4:00 PM
    const isWithinExecutionWindow = currentTimeInMinutes >= eightAMInMinutes && currentTimeInMinutes <= fourPMInMinutes;
    console.log(`\n🔍 Fallback Logic Check:`);
    console.log(`   Is weekday (Mon-Fri): ${isWeekday ? '✅' : '❌'}`);
    console.log(`   Is within 8AM-4PM window: ${isWithinExecutionWindow ? '✅' : '❌'}`);
    console.log(`   Should fallback sites execute: ${isWeekday && isWithinExecutionWindow ? '✅ YES' : '❌ NO'}`);
    console.log(`\n📋 Expected Behavior:`);
    console.log(`   📈 Sites with business_hours: Always schedule (use their timezone/schedule)`);
    console.log(`   📉 Sites without business_hours (fallback):`);
    if (isWeekday && isWithinExecutionWindow) {
        console.log(`      ✅ Execute immediately (no recurring schedule)`);
    }
    else if (isWeekday && !isWithinExecutionWindow) {
        console.log(`      ❌ Skip (outside 8-hour window, prevents unwanted scheduling)`);
    }
    else {
        console.log(`      ❌ Skip (weekend, only business_hours sites run)`);
    }
    console.log(`\n🧪 Running DRY RUN test...`);
    try {
        const result = await (0, workflowSchedulingActivities_1.executeDailyStandUpWorkflowsActivity)({
            dryRun: true, // DRY RUN to test logic without actual scheduling
            testMode: false, // Production logic
        });
        console.log(`\n📊 Test Results:`);
        console.log(`   ✅ Scheduled: ${result.scheduled} sites`);
        console.log(`   ⏭️ Skipped: ${result.skipped} sites`);
        console.log(`   ❌ Failed: ${result.failed} sites`);
        console.log(`   📈 Sites with business_hours: ${result.testInfo?.sitesWithBusinessHours || 0}`);
        console.log(`   📉 Sites using fallback: ${result.testInfo?.sitesWithFallback || 0}`);
        if (result.errors && result.errors.length > 0) {
            console.log(`\n❌ Errors:`);
            result.errors.forEach((error, index) => {
                console.log(`   ${index + 1}. ${error}`);
            });
        }
        console.log(`\n✅ Fallback logic test completed successfully!`);
    }
    catch (error) {
        console.error(`❌ Test failed:`, error);
    }
}
// Run the test
testFallbackLogic().catch(console.error);
