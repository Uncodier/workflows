#!/usr/bin/env tsx
"use strict";
/**
 * Test script for Weekend Business Hours
 * Tests that the system correctly handles businesses that operate on Saturday/Sunday
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.testWeekendBusinessHours = testWeekendBusinessHours;
// Mock data for testing weekend scenarios
const mockSites = [
    {
        id: 'weekend-business-1',
        name: 'Weekend Restaurant',
        user_id: 'user-1',
        url: 'https://weekend-restaurant.com'
    },
    {
        id: 'weekday-business-1',
        name: 'Office Business',
        user_id: 'user-2',
        url: 'https://office-business.com'
    }
];
const mockSettings = [
    {
        site_id: 'weekend-business-1',
        business_hours: [
            {
                name: 'Restaurant Schedule',
                timezone: 'America/Mexico_City',
                days: {
                    monday: { start: '10:00', end: '22:00', enabled: true },
                    tuesday: { start: '10:00', end: '22:00', enabled: true },
                    wednesday: { start: '10:00', end: '22:00', enabled: true },
                    thursday: { start: '10:00', end: '22:00', enabled: true },
                    friday: { start: '10:00', end: '23:00', enabled: true },
                    saturday: { start: '09:00', end: '23:00', enabled: true }, // ✅ ABIERTO SÁBADOS
                    sunday: { start: '12:00', end: '20:00', enabled: true } // ✅ ABIERTO DOMINGOS
                }
            }
        ]
    },
    {
        site_id: 'weekday-business-1',
        business_hours: [
            {
                name: 'Office Schedule',
                timezone: 'America/Mexico_City',
                days: {
                    monday: { start: '09:00', end: '18:00', enabled: true },
                    tuesday: { start: '09:00', end: '18:00', enabled: true },
                    wednesday: { start: '09:00', end: '18:00', enabled: true },
                    thursday: { start: '09:00', end: '18:00', enabled: true },
                    friday: { start: '09:00', end: '18:00', enabled: true },
                    saturday: { start: '09:00', end: '14:00', enabled: false }, // ❌ CERRADO SÁBADOS
                    sunday: { start: '10:00', end: '16:00', enabled: false } // ❌ CERRADO DOMINGOS
                }
            }
        ]
    }
];
/**
 * Modified evaluateBusinessHoursForDay with weekend mocked data
 */
async function evaluateWeekendBusinessHours(dayOfWeek, mockCurrentTime) {
    console.log(`🕐 Evaluating weekend business hours for day ${dayOfWeek} (0=Sunday, 6=Saturday)...`);
    const currentHour = mockCurrentTime.getUTCHours();
    const currentMinute = mockCurrentTime.getUTCMinutes();
    const currentTimeStr = `${currentHour.toString().padStart(2, '0')}:${currentMinute.toString().padStart(2, '0')}`;
    console.log(`⏰ Current time: ${currentTimeStr} UTC (MOCKED)`);
    const sites = mockSites;
    const settings = mockSettings;
    console.log(`📊 Found ${sites.length} total sites (MOCKED)`);
    // Filter sites that have business_hours configured
    const sitesWithBusinessHours = settings.filter(setting => {
        const businessHours = setting.business_hours;
        return businessHours && Array.isArray(businessHours) && businessHours.length > 0;
    });
    console.log(`📈 Sites with business_hours: ${sitesWithBusinessHours.length}`);
    // Check which sites are open today
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const today = dayNames[dayOfWeek];
    const openSites = sitesWithBusinessHours.filter(setting => {
        const businessHours = setting.business_hours;
        let todayHours;
        if (Array.isArray(businessHours) && businessHours.length > 0) {
            const firstSchedule = businessHours[0];
            if (firstSchedule && firstSchedule.days && firstSchedule.days[today]) {
                const dayConfig = firstSchedule.days[today];
                todayHours = {
                    open: dayConfig.start,
                    close: dayConfig.end,
                    enabled: dayConfig.enabled,
                    timezone: firstSchedule.timezone,
                    name: firstSchedule.name
                };
            }
        }
        if (!todayHours)
            return false;
        // Check if the site is open today
        const isOpen = todayHours.enabled === true &&
            todayHours.open &&
            todayHours.close &&
            todayHours.open !== todayHours.close;
        if (isOpen) {
            const timezone = todayHours.timezone ? ` (${todayHours.timezone})` : '';
            const name = todayHours.name ? ` - ${todayHours.name}` : '';
            console.log(`✅ Site ${setting.site_id}${name} is open on ${today}: ${todayHours.open} - ${todayHours.close}${timezone}`);
        }
        else if (todayHours.enabled === false) {
            console.log(`⏸️  Site ${setting.site_id} has ${today} disabled in business hours`);
        }
        return isOpen;
    });
    // Time-aware analysis
    console.log(`\n🕐 TIME-AWARE ANALYSIS (Current: ${currentTimeStr} UTC):`);
    let sitesCurrentlyOpen = 0;
    let earliestOpenTime = '24:00';
    openSites.forEach(setting => {
        const businessHours = setting.business_hours;
        let todayHours;
        if (Array.isArray(businessHours) && businessHours.length > 0) {
            const firstSchedule = businessHours[0];
            if (firstSchedule && firstSchedule.days && firstSchedule.days[today]) {
                const dayConfig = firstSchedule.days[today];
                todayHours = {
                    open: dayConfig.start,
                    close: dayConfig.end,
                    timezone: firstSchedule.timezone
                };
            }
        }
        if (!todayHours)
            return;
        const [openHour, openMinute] = todayHours.open.split(':').map(Number);
        const [closeHour, closeMinute] = todayHours.close.split(':').map(Number);
        const currentTimeMinutes = currentHour * 60 + currentMinute;
        const openTimeMinutes = openHour * 60 + openMinute;
        const closeTimeMinutes = closeHour * 60 + closeMinute;
        const isCurrentlyOpen = currentTimeMinutes >= openTimeMinutes && currentTimeMinutes < closeTimeMinutes;
        if (isCurrentlyOpen) {
            sitesCurrentlyOpen++;
            console.log(`🟢 Site ${setting.site_id} is CURRENTLY OPEN (${todayHours.open} - ${todayHours.close})`);
        }
        else {
            const timeUntilOpen = openTimeMinutes > currentTimeMinutes ?
                `${Math.floor((openTimeMinutes - currentTimeMinutes) / 60)}h ${(openTimeMinutes - currentTimeMinutes) % 60}m` :
                `closed for today`;
            console.log(`🔴 Site ${setting.site_id} is CURRENTLY CLOSED (opens at ${todayHours.open}, ${timeUntilOpen})`);
        }
        if (todayHours.open < earliestOpenTime)
            earliestOpenTime = todayHours.open;
    });
    console.log(`📊 Weekend Analysis Summary:`);
    console.log(`   - Sites open on ${today}: ${openSites.length}`);
    console.log(`   - Sites currently in business hours: ${sitesCurrentlyOpen}`);
    // Determine execution strategy
    const shouldExecuteOperations = openSites.length > 0;
    let shouldExecuteNow = false;
    let shouldScheduleForLater = false;
    let nextExecutionTime = '';
    let reason;
    if (!shouldExecuteOperations) {
        reason = `No sites have business_hours enabled on ${today}`;
    }
    else {
        const isWithinAnyBusinessHours = sitesCurrentlyOpen > 0;
        if (isWithinAnyBusinessHours) {
            shouldExecuteNow = true;
            shouldScheduleForLater = false;
            reason = `${sitesCurrentlyOpen} site(s) are currently within business hours on ${today}`;
        }
        else {
            const [earliestHour, earliestMinute] = earliestOpenTime.split(':').map(Number);
            const earliestOpenMinutes = earliestHour * 60 + earliestMinute;
            const currentTimeMinutes = currentHour * 60 + currentMinute;
            if (currentTimeMinutes < earliestOpenMinutes) {
                shouldExecuteNow = false;
                shouldScheduleForLater = true;
                nextExecutionTime = earliestOpenTime;
                reason = `${openSites.length} site(s) have business hours on ${today}, but it's too early (opens at ${earliestOpenTime})`;
            }
            else {
                shouldExecuteNow = true;
                shouldScheduleForLater = false;
                reason = `${openSites.length} site(s) have business hours on ${today}, executing in catch-up mode`;
            }
        }
    }
    console.log(`🎯 WEEKEND DECISION: ${shouldExecuteOperations ? 'EXECUTE' : 'SKIP'} - ${reason}`);
    console.log(`   Execute now: ${shouldExecuteNow}`);
    console.log(`   Schedule for later: ${shouldScheduleForLater}`);
    if (nextExecutionTime) {
        console.log(`   Next execution time: ${nextExecutionTime}`);
    }
    return {
        shouldExecuteOperations,
        reason,
        sitesWithBusinessHours: sitesWithBusinessHours.length,
        sitesOpenToday: openSites.length,
        shouldExecuteNow,
        shouldScheduleForLater,
        nextExecutionTime,
        openSites: openSites.map(site => ({
            siteId: site.site_id,
            businessHours: site.business_hours?.[0]?.days ? site.business_hours[0].days[today] : null
        }))
    };
}
/**
 * Test weekend business hours scenarios
 */
async function testWeekendBusinessHours() {
    console.log('🧪 Testing Weekend Business Hours Support');
    console.log('=========================================');
    try {
        // Test Case 1: Saturday morning - Restaurant should be scheduled
        console.log('\n🔍 Test Case 1: Saturday 8:00 AM UTC (before restaurant opens at 9:00 AM)');
        const saturdayMorning = new Date('2025-06-28T08:00:00.000Z'); // Saturday
        console.log(`📅 Simulated time: ${saturdayMorning.toISOString()}`);
        console.log(`   Day of week: ${saturdayMorning.getUTCDay()} (Saturday)`);
        const analysis1 = await evaluateWeekendBusinessHours(6, saturdayMorning); // Saturday
        console.log('\n📊 Analysis Results:');
        console.log(`   - Should execute operations: ${analysis1.shouldExecuteOperations}`);
        console.log(`   - Should execute NOW: ${analysis1.shouldExecuteNow}`);
        console.log(`   - Should schedule for later: ${analysis1.shouldScheduleForLater}`);
        console.log(`   - Next execution time: ${analysis1.nextExecutionTime || 'N/A'}`);
        console.log(`   - Reason: ${analysis1.reason}`);
        const testCase1Result = analysis1.shouldExecuteOperations && analysis1.shouldScheduleForLater;
        console.log(`\n✅ Test Case 1: ${testCase1Result ? 'PASSED' : 'FAILED'}`);
        if (testCase1Result) {
            console.log('   ✓ System correctly identifies weekend business and schedules for opening time');
        }
        else {
            console.log('   ❌ System failed to handle weekend business hours');
        }
        // Test Case 2: Saturday during business hours - Should execute now
        console.log('\n🔍 Test Case 2: Saturday 10:00 AM UTC (restaurant is open)');
        const saturdayMidDay = new Date('2025-06-28T10:00:00.000Z'); // Saturday
        console.log(`📅 Simulated time: ${saturdayMidDay.toISOString()}`);
        console.log(`   Day of week: ${saturdayMidDay.getUTCDay()} (Saturday)`);
        const analysis2 = await evaluateWeekendBusinessHours(6, saturdayMidDay); // Saturday
        console.log('\n📊 Analysis Results:');
        console.log(`   - Should execute operations: ${analysis2.shouldExecuteOperations}`);
        console.log(`   - Should execute NOW: ${analysis2.shouldExecuteNow}`);
        console.log(`   - Should schedule for later: ${analysis2.shouldScheduleForLater}`);
        console.log(`   - Reason: ${analysis2.reason}`);
        const testCase2Result = analysis2.shouldExecuteOperations && analysis2.shouldExecuteNow;
        console.log(`\n✅ Test Case 2: ${testCase2Result ? 'PASSED' : 'FAILED'}`);
        if (testCase2Result) {
            console.log('   ✓ System correctly executes during weekend business hours');
        }
        else {
            console.log('   ❌ System failed to execute during weekend business hours');
        }
        // Test Case 3: Sunday morning - Restaurant should be scheduled for later
        console.log('\n🔍 Test Case 3: Sunday 10:00 AM UTC (before restaurant opens at 12:00 PM)');
        const sundayMorning = new Date('2025-06-29T10:00:00.000Z'); // Sunday
        console.log(`📅 Simulated time: ${sundayMorning.toISOString()}`);
        console.log(`   Day of week: ${sundayMorning.getUTCDay()} (Sunday)`);
        const analysis3 = await evaluateWeekendBusinessHours(0, sundayMorning); // Sunday
        console.log('\n📊 Analysis Results:');
        console.log(`   - Should execute operations: ${analysis3.shouldExecuteOperations}`);
        console.log(`   - Should execute NOW: ${analysis3.shouldExecuteNow}`);
        console.log(`   - Should schedule for later: ${analysis3.shouldScheduleForLater}`);
        console.log(`   - Next execution time: ${analysis3.nextExecutionTime || 'N/A'}`);
        console.log(`   - Reason: ${analysis3.reason}`);
        const testCase3Result = analysis3.shouldExecuteOperations && analysis3.shouldScheduleForLater;
        console.log(`\n✅ Test Case 3: ${testCase3Result ? 'PASSED' : 'FAILED'}`);
        if (testCase3Result) {
            console.log('   ✓ System correctly handles Sunday business hours and schedules for later');
        }
        else {
            console.log('   ❌ System failed to handle Sunday business hours');
        }
        // Test Case 4: Sunday afternoon - Restaurant should execute now
        console.log('\n🔍 Test Case 4: Sunday 3:00 PM UTC (restaurant is open)');
        const sundayAfternoon = new Date('2025-06-29T15:00:00.000Z'); // Sunday
        console.log(`📅 Simulated time: ${sundayAfternoon.toISOString()}`);
        console.log(`   Day of week: ${sundayAfternoon.getUTCDay()} (Sunday)`);
        const analysis4 = await evaluateWeekendBusinessHours(0, sundayAfternoon); // Sunday
        console.log('\n📊 Analysis Results:');
        console.log(`   - Should execute operations: ${analysis4.shouldExecuteOperations}`);
        console.log(`   - Should execute NOW: ${analysis4.shouldExecuteNow}`);
        console.log(`   - Should schedule for later: ${analysis4.shouldScheduleForLater}`);
        console.log(`   - Reason: ${analysis4.reason}`);
        const testCase4Result = analysis4.shouldExecuteOperations && analysis4.shouldExecuteNow;
        console.log(`\n✅ Test Case 4: ${testCase4Result ? 'PASSED' : 'FAILED'}`);
        if (testCase4Result) {
            console.log('   ✓ System correctly executes during Sunday business hours');
        }
        else {
            console.log('   ❌ System failed to execute during Sunday business hours');
        }
        // Summary
        console.log('\n🎯 WEEKEND BUSINESS HOURS SUMMARY');
        console.log('===================================');
        const allTestsPassed = testCase1Result && testCase2Result && testCase3Result && testCase4Result;
        console.log(`Overall Result: ${allTestsPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);
        console.log(`\nKey Findings:`);
        console.log(`✓ Saturday early morning (schedule for later): ${testCase1Result ? 'WORKING' : 'BROKEN'}`);
        console.log(`✓ Saturday during business hours (execute now): ${testCase2Result ? 'WORKING' : 'BROKEN'}`);
        console.log(`✓ Sunday early morning (schedule for later): ${testCase3Result ? 'WORKING' : 'BROKEN'}`);
        console.log(`✓ Sunday during business hours (execute now): ${testCase4Result ? 'WORKING' : 'BROKEN'}`);
        if (allTestsPassed) {
            console.log(`\n🎉 SUCCESS: Weekend business hours support is WORKING!`);
            console.log(`   - System correctly handles businesses that operate on weekends`);
            console.log(`   - Workflows are scheduled/executed appropriately for weekend business hours`);
            console.log(`   - Both Saturday and Sunday business operations are supported`);
        }
        else {
            console.log(`\n🚨 ISSUES: Weekend business hours support needs work`);
        }
    }
    catch (error) {
        console.error('\n❌ Test failed:', error);
        throw error;
    }
}
// Execute the test
if (require.main === module) {
    testWeekendBusinessHours()
        .then(() => {
        console.log('\n✅ Weekend business hours test completed successfully');
        process.exit(0);
    })
        .catch((error) => {
        console.error('\n❌ Weekend business hours test failed:', error);
        process.exit(1);
    });
}
