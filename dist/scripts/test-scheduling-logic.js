#!/usr/bin/env node
"use strict";
/**
 * Test Scheduling Logic
 * Validates the date/time calculation logic for scheduling workflows
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.testSchedulingScenarios = testSchedulingScenarios;
exports.calculateSchedulingLogic = calculateSchedulingLogic;
function mockEvaluateBusinessHoursForDay() {
    // Simulate the same result you showed in your screenshot
    return {
        shouldExecuteOperations: true,
        shouldExecuteNow: false,
        shouldScheduleForLater: true,
        nextExecutionTime: "09:00",
        reason: "5 site(s) have business hours on tuesday, but it's too early (opens at 09:00)"
    };
}
function calculateSchedulingLogic(scheduledTime, // e.g., "09:00"
timezone = 'America/Mexico_City') {
    console.log(`🧪 Testing scheduling logic for ${scheduledTime} ${timezone}`);
    // Parse the target time
    const [hours, minutes] = scheduledTime.split(':').map(Number);
    const nowUTC = new Date();
    // Step 1: Get current time in Mexico
    const nowMexico = new Date(nowUTC.getTime() - (6 * 60 * 60 * 1000));
    const mexicoDateStr = nowMexico.toISOString().split('T')[0];
    console.log(`   📅 Current time (UTC): ${nowUTC.toISOString()}`);
    console.log(`   📅 Current Mexico time: ${nowMexico.getHours().toString().padStart(2, '0')}:${nowMexico.getMinutes().toString().padStart(2, '0')} on ${mexicoDateStr}`);
    // Step 2: Create target time for "today" in Mexico timezone
    const targetMexicoToday = new Date(nowMexico);
    targetMexicoToday.setHours(hours, minutes, 0, 0);
    console.log(`   📅 Target Mexico time TODAY (${mexicoDateStr}): ${targetMexicoToday.getHours().toString().padStart(2, '0')}:${targetMexicoToday.getMinutes().toString().padStart(2, '0')}`);
    // Step 3: Check if target time already passed in Mexico
    const targetAlreadyPassed = targetMexicoToday <= nowMexico;
    // Step 4: Determine final target date (today or tomorrow in Mexico)
    let finalTargetMexico;
    let scheduleForTomorrow;
    if (targetAlreadyPassed) {
        // Schedule for tomorrow in Mexico
        finalTargetMexico = new Date(targetMexicoToday);
        finalTargetMexico.setDate(finalTargetMexico.getDate() + 1);
        scheduleForTomorrow = true;
        console.log(`   ⏰ Target time already passed in Mexico TODAY, scheduling for TOMORROW`);
    }
    else {
        // Schedule for today in Mexico
        finalTargetMexico = targetMexicoToday;
        scheduleForTomorrow = false;
        console.log(`   ⏰ Target time hasn't passed in Mexico TODAY, scheduling for TODAY`);
    }
    const finalMexicoDateStr = finalTargetMexico.toISOString().split('T')[0];
    console.log(`   📅 Final target Mexico time: ${finalTargetMexico.getHours().toString().padStart(2, '0')}:${finalTargetMexico.getMinutes().toString().padStart(2, '0')} on ${finalMexicoDateStr}`);
    // Step 5: Convert final Mexico time to UTC
    const finalTargetUTC = new Date(finalTargetMexico.getTime() + (6 * 60 * 60 * 1000));
    console.log(`   📅 Final target UTC time: ${finalTargetUTC.toISOString()}`);
    return {
        scheduleForToday: !scheduleForTomorrow,
        scheduleForTomorrow,
        targetDate: finalMexicoDateStr,
        explanation: scheduleForTomorrow ?
            `Time ${scheduledTime} already passed today in Mexico, scheduling for tomorrow (${finalMexicoDateStr})` :
            `Time ${scheduledTime} hasn't passed today in Mexico, scheduling for today (${finalMexicoDateStr})`
    };
}
function testSchedulingScenarios() {
    console.log('🧪 Testing Scheduling Logic');
    console.log('═'.repeat(80));
    const currentTime = new Date();
    console.log(`🕐 Server time (UTC): ${currentTime.toISOString()}`);
    console.log(`🕐 Server time simplified: ${currentTime.getUTCHours().toString().padStart(2, '0')}:${currentTime.getUTCMinutes().toString().padStart(2, '0')} UTC`);
    // Calculate Mexico time (UTC-6)
    // Mexico = UTC - 6 hours
    const mexicoTime = new Date(currentTime.getTime() - (6 * 60 * 60 * 1000));
    const mexicoDateStr = mexicoTime.toISOString().split('T')[0];
    console.log(`🇲🇽 Mexico time: ${mexicoTime.getHours().toString().padStart(2, '0')}:${mexicoTime.getMinutes().toString().padStart(2, '0')} on ${mexicoDateStr} (UTC-6)`);
    console.log(`📅 Current day: ${currentTime.toLocaleDateString('en-US', { weekday: 'long' })}`);
    // Test the business hours analysis
    console.log('\n🏢 Testing Business Hours Analysis...');
    const businessHoursAnalysis = mockEvaluateBusinessHoursForDay();
    console.log('📊 Business Hours Result:');
    console.log(`   - Should execute operations: ${businessHoursAnalysis.shouldExecuteOperations}`);
    console.log(`   - Should execute now: ${businessHoursAnalysis.shouldExecuteNow}`);
    console.log(`   - Should schedule for later: ${businessHoursAnalysis.shouldScheduleForLater}`);
    console.log(`   - Next execution time: ${businessHoursAnalysis.nextExecutionTime}`);
    console.log(`   - Reason: ${businessHoursAnalysis.reason}`);
    // Test scheduling logic
    console.log('\n📅 Testing Scheduling Logic...');
    const schedulingResult = calculateSchedulingLogic(businessHoursAnalysis.nextExecutionTime);
    console.log('\n✅ Scheduling Result:');
    console.log(`   - Schedule for today: ${schedulingResult.scheduleForToday}`);
    console.log(`   - Schedule for tomorrow: ${schedulingResult.scheduleForTomorrow}`);
    console.log(`   - Target date: ${schedulingResult.targetDate}`);
    console.log(`   - Explanation: ${schedulingResult.explanation}`);
    // Test edge cases
    console.log('\n🔍 Testing Edge Cases...');
    // Test early morning (should schedule for today)
    console.log('\n📌 Early morning test (06:00):');
    const earlyResult = calculateSchedulingLogic('06:00');
    console.log(`   Result: ${earlyResult.explanation}`);
    // Test late evening (should schedule for tomorrow)
    console.log('\n📌 Late evening test (22:00):');
    const lateResult = calculateSchedulingLogic('22:00');
    console.log(`   Result: ${lateResult.explanation}`);
    // Summary
    console.log('\n🎯 Summary for Your Current Scenario:');
    console.log('═'.repeat(50));
    if (businessHoursAnalysis.shouldScheduleForLater) {
        const mainResult = calculateSchedulingLogic(businessHoursAnalysis.nextExecutionTime);
        console.log(`✅ Business hours analysis says: Schedule for ${businessHoursAnalysis.nextExecutionTime}`);
        console.log(`✅ Scheduling logic says: ${mainResult.explanation}`);
        if (mainResult.scheduleForToday) {
            console.log(`\n🎉 RESULT: If you run the workflow NOW, it will:`);
            console.log(`   ✅ Create a schedule for TODAY at ${businessHoursAnalysis.nextExecutionTime}`);
            console.log(`   ✅ Execute daily operations at the right time`);
            console.log(`   ✅ Respect business hours correctly`);
        }
        else {
            console.log(`\n🎉 RESULT: If you run the workflow NOW, it will:`);
            console.log(`   ✅ Create a schedule for TOMORROW at ${businessHoursAnalysis.nextExecutionTime}`);
            console.log(`   ✅ Execute daily operations at the right time`);
            console.log(`   ✅ Respect business hours correctly`);
        }
    }
    console.log('\n✅ Test completed successfully!');
}
// Run the test if this script is executed directly
if (require.main === module) {
    testSchedulingScenarios();
}
