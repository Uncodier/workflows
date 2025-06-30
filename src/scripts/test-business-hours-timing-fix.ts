#!/usr/bin/env tsx
/**
 * Test script for Business Hours Timing Fix
 * Tests that the system respects business hours and doesn't execute outside them
 */

import { evaluateBusinessHoursForDay } from '../temporal/activities/prioritizationActivities';

/**
 * Test the business hours timing fix
 */
async function testBusinessHoursTimingFix() {
  console.log('🧪 Testing Business Hours Timing Fix');
  console.log('=====================================');
  
  const originalDate = Date.now;
  
  try {
    // Test Case 1: Sunday 6 PM Mexico (should be Monday 12 AM UTC - outside business hours)
    console.log('\n🔍 Test Case 1: Simulating Sunday 6 PM Mexico (Monday 12 AM UTC)');
    console.log('This simulates the exact scenario the user reported');
    
    // Mock current time to Monday 12:00 AM UTC (Sunday 6 PM Mexico)
    const mondayMidnightUTC = new Date();
    mondayMidnightUTC.setUTCHours(0, 0, 0, 0); // 12:00 AM UTC
    // Set to Monday (1) - adjust date to ensure it's Monday
    const currentDay = mondayMidnightUTC.getUTCDay();
    const daysUntilMonday = (1 - currentDay + 7) % 7;
    mondayMidnightUTC.setUTCDate(mondayMidnightUTC.getUTCDate() + daysUntilMonday);
    
    Date.now = () => mondayMidnightUTC.getTime();
    
    console.log(`📅 Simulated time: ${mondayMidnightUTC.toISOString()}`);
    console.log(`   Day of week: ${mondayMidnightUTC.getUTCDay()} (Monday)`);
    console.log(`   Hour: ${mondayMidnightUTC.getUTCHours()}:${mondayMidnightUTC.getUTCMinutes().toString().padStart(2, '0')} UTC`);
    
    const analysis1 = await evaluateBusinessHoursForDay(1); // Monday
    
    console.log('\n📊 Analysis Results:');
    console.log(`   - Should execute operations: ${analysis1.shouldExecuteOperations}`);
    console.log(`   - Should execute NOW: ${analysis1.shouldExecuteNow}`);
    console.log(`   - Should schedule for later: ${analysis1.shouldScheduleForLater}`);
    console.log(`   - Next execution time: ${analysis1.nextExecutionTime || 'N/A'}`);
    console.log(`   - Reason: ${analysis1.reason}`);
    
    const testCase1Result = analysis1.shouldScheduleForLater && !analysis1.shouldExecuteNow;
    console.log(`\n✅ Test Case 1: ${testCase1Result ? 'PASSED' : 'FAILED'}`);
    if (testCase1Result) {
      console.log('   ✓ System correctly identified it should NOT execute at midnight');
      console.log('   ✓ System wants to schedule for business hours instead');
    } else {
      console.log('   ❌ System would still execute at midnight (BAD!)');
    }
    
    // Test Case 2: Monday 9 AM UTC (within business hours)
    console.log('\n🔍 Test Case 2: Simulating Monday 9 AM UTC (within business hours)');
    
    const mondayNineAM = new Date();
    mondayNineAM.setUTCHours(9, 0, 0, 0); // 9:00 AM UTC
    // Set to Monday (1) - adjust date to ensure it's Monday
    const currentDay2 = mondayNineAM.getUTCDay();
    const daysUntilMonday2 = (1 - currentDay2 + 7) % 7;
    mondayNineAM.setUTCDate(mondayNineAM.getUTCDate() + daysUntilMonday2);
    
    Date.now = () => mondayNineAM.getTime();
    
    console.log(`📅 Simulated time: ${mondayNineAM.toISOString()}`);
    console.log(`   Day of week: ${mondayNineAM.getUTCDay()} (Monday)`);
    console.log(`   Hour: ${mondayNineAM.getUTCHours()}:${mondayNineAM.getUTCMinutes().toString().padStart(2, '0')} UTC`);
    
    const analysis2 = await evaluateBusinessHoursForDay(1); // Monday
    
    console.log('\n📊 Analysis Results:');
    console.log(`   - Should execute operations: ${analysis2.shouldExecuteOperations}`);
    console.log(`   - Should execute NOW: ${analysis2.shouldExecuteNow}`);
    console.log(`   - Should schedule for later: ${analysis2.shouldScheduleForLater}`);
    console.log(`   - Sites currently open: ${analysis2.currentTimeAnalysis?.sitesCurrentlyOpen || 0}`);
    console.log(`   - Reason: ${analysis2.reason}`);
    
    const testCase2Result = analysis2.shouldExecuteNow && !analysis2.shouldScheduleForLater;
    console.log(`\n✅ Test Case 2: ${testCase2Result ? 'PASSED' : 'FAILED'}`);
    if (testCase2Result) {
      console.log('   ✓ System correctly identified it should execute during business hours');
    } else {
      console.log('   ❌ System failed to execute during business hours');
    }
    
    // Test Case 3: Sunday (weekend - should skip)
    console.log('\n🔍 Test Case 3: Simulating Sunday (weekend - should skip)');
    
    const sunday = new Date();
    sunday.setUTCHours(14, 0, 0, 0); // 2:00 PM UTC
    // Set to Sunday (0) - adjust date to ensure it's Sunday
    const currentDay3 = sunday.getUTCDay();
    const daysUntilSunday = (0 - currentDay3 + 7) % 7;
    sunday.setUTCDate(sunday.getUTCDate() + daysUntilSunday);
    
    Date.now = () => sunday.getTime();
    
    console.log(`📅 Simulated time: ${sunday.toISOString()}`);
    console.log(`   Day of week: ${sunday.getUTCDay()} (Sunday)`);
    console.log(`   Hour: ${sunday.getUTCHours()}:${sunday.getUTCMinutes().toString().padStart(2, '0')} UTC`);
    
    const analysis3 = await evaluateBusinessHoursForDay(0); // Sunday
    
    console.log('\n📊 Analysis Results:');
    console.log(`   - Should execute operations: ${analysis3.shouldExecuteOperations}`);
    console.log(`   - Should execute NOW: ${analysis3.shouldExecuteNow}`);
    console.log(`   - Should schedule for later: ${analysis3.shouldScheduleForLater}`);
    console.log(`   - Reason: ${analysis3.reason}`);
    
    const testCase3Result = !analysis3.shouldExecuteOperations;
    console.log(`\n✅ Test Case 3: ${testCase3Result ? 'PASSED' : 'FAILED'}`);
    if (testCase3Result) {
      console.log('   ✓ System correctly skips Sunday execution');
    } else {
      console.log('   ❌ System would execute on Sunday (should skip)');
    }
    
    // Test Case 4: Monday 6 PM UTC (after business hours - catch-up mode)
    console.log('\n🔍 Test Case 4: Simulating Monday 6 PM UTC (after business hours)');
    
    const mondaySixPM = new Date();
    mondaySixPM.setUTCHours(18, 0, 0, 0); // 6:00 PM UTC
    // Set to Monday (1) - adjust date to ensure it's Monday
    const currentDay4 = mondaySixPM.getUTCDay();
    const daysUntilMonday4 = (1 - currentDay4 + 7) % 7;
    mondaySixPM.setUTCDate(mondaySixPM.getUTCDate() + daysUntilMonday4);
    
    Date.now = () => mondaySixPM.getTime();
    
    console.log(`📅 Simulated time: ${mondaySixPM.toISOString()}`);
    console.log(`   Day of week: ${mondaySixPM.getUTCDay()} (Monday)`);
    console.log(`   Hour: ${mondaySixPM.getUTCHours()}:${mondaySixPM.getUTCMinutes().toString().padStart(2, '0')} UTC`);
    
    const analysis4 = await evaluateBusinessHoursForDay(1); // Monday
    
    console.log('\n📊 Analysis Results:');
    console.log(`   - Should execute operations: ${analysis4.shouldExecuteOperations}`);
    console.log(`   - Should execute NOW: ${analysis4.shouldExecuteNow}`);
    console.log(`   - Should schedule for later: ${analysis4.shouldScheduleForLater}`);
    console.log(`   - Reason: ${analysis4.reason}`);
    
    // After hours should execute in catch-up mode
    const testCase4Result = analysis4.shouldExecuteNow && !analysis4.shouldScheduleForLater;
    console.log(`\n✅ Test Case 4: ${testCase4Result ? 'PASSED' : 'FAILED'}`);
    if (testCase4Result) {
      console.log('   ✓ System correctly executes in catch-up mode after business hours');
    } else {
      console.log('   ❌ System failed to handle after-hours execution');
    }
    
    // Summary
    console.log('\n🎯 SUMMARY');
    console.log('===========');
    
    const allTestsPassed = testCase1Result && testCase2Result && testCase3Result && testCase4Result;
    
    console.log(`Overall Result: ${allTestsPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);
    console.log(`\nKey Findings:`);
    console.log(`✓ Test 1 - Midnight execution prevention: ${testCase1Result ? 'FIXED' : 'STILL BROKEN'}`);
    console.log(`✓ Test 2 - Business hours execution: ${testCase2Result ? 'WORKING' : 'BROKEN'}`);
    console.log(`✓ Test 3 - Weekend skipping: ${testCase3Result ? 'WORKING' : 'BROKEN'}`);
    console.log(`✓ Test 4 - After hours catch-up: ${testCase4Result ? 'WORKING' : 'BROKEN'}`);
    
    if (testCase1Result) {
      console.log(`\n🎉 SUCCESS: The user's reported issue has been FIXED!`);
      console.log(`   - System will no longer execute daily standups at midnight`);
      console.log(`   - Workflows will be scheduled for appropriate business hours`);
      console.log(`   - This prevents spamming customers outside business hours`);
    } else {
      console.log(`\n🚨 FAILURE: The user's issue is NOT fixed yet`);
      console.log(`   - System would still execute at inappropriate times`);
      console.log(`   - Additional work needed`);
    }
    
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    throw error;
  } finally {
    // Restore original Date.now
    Date.now = originalDate;
  }
}

// Execute the test
if (require.main === module) {
  testBusinessHoursTimingFix()
    .then(() => {
      console.log('\n✅ Test completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Test failed:', error);
      process.exit(1);
    });
}

export { testBusinessHoursTimingFix }; 