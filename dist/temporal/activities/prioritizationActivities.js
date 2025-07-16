"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateBusinessHoursForDay = evaluateBusinessHoursForDay;
exports.getContext = getContext;
exports.designPlan = designPlan;
exports.sendPlan = sendPlan;
exports.sendPriorityMail = sendPriorityMail;
exports.scheduleActivities = scheduleActivities;
const supabaseService_1 = require("../services/supabaseService");
// Prioritization Engine Activities
/**
 * Evaluates if any sites have business_hours that allow operations for the given day
 * Now includes time-aware logic to determine if execution should happen now or be scheduled
 */
async function evaluateBusinessHoursForDay(dayOfWeek) {
    console.log(`🕐 Evaluating business hours for day ${dayOfWeek} (0=Sunday, 6=Saturday)...`);
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentTimeStr = `${currentHour.toString().padStart(2, '0')}:${currentMinute.toString().padStart(2, '0')}`;
    console.log(`⏰ Current time: ${currentTimeStr} UTC`);
    try {
        const supabaseService = (0, supabaseService_1.getSupabaseService)();
        const isConnected = await supabaseService.getConnectionStatus();
        if (!isConnected) {
            console.log('⚠️  Database not connected, falling back to weekday-only logic');
            const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
            return {
                shouldExecuteOperations: isWeekday,
                reason: isWeekday ? 'Weekday (fallback mode)' : 'Weekend (fallback mode)',
                sitesWithBusinessHours: 0,
                sitesOpenToday: 0,
                openSites: [],
                shouldExecuteNow: isWeekday,
                shouldScheduleForLater: false
            };
        }
        // Get all sites
        const sites = await supabaseService.fetchSites();
        console.log(`📊 Found ${sites.length} total sites`);
        if (sites.length === 0) {
            return {
                shouldExecuteOperations: false,
                reason: 'No sites found in database',
                sitesWithBusinessHours: 0,
                sitesOpenToday: 0,
                openSites: [],
                shouldExecuteNow: false,
                shouldScheduleForLater: false
            };
        }
        // Get complete settings including business_hours
        const siteIds = sites.map(site => site.id);
        const settings = await supabaseService.fetchCompleteSettings(siteIds);
        console.log(`⚙️  Retrieved settings for ${settings.length} sites`);
        // Filter sites that have business_hours configured
        const sitesWithBusinessHours = settings.filter(setting => {
            const businessHours = setting.business_hours;
            if (!businessHours)
                return false;
            // New structure: business_hours is an array of schedule objects
            if (Array.isArray(businessHours) && businessHours.length > 0) {
                const firstSchedule = businessHours[0];
                return firstSchedule &&
                    firstSchedule.days &&
                    typeof firstSchedule.days === 'object' &&
                    Object.keys(firstSchedule.days).length > 0;
            }
            // Old structure: business_hours is a direct object with day keys
            if (typeof businessHours === 'object' && !Array.isArray(businessHours)) {
                return Object.keys(businessHours).length > 0;
            }
            return false;
        });
        console.log(`📈 Sites with business_hours: ${sitesWithBusinessHours.length}`);
        console.log(`📉 Sites without business_hours (fallback): ${settings.length - sitesWithBusinessHours.length}`);
        // Check which sites are open today
        const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const today = dayNames[dayOfWeek];
        const openSites = sitesWithBusinessHours.filter(setting => {
            const businessHours = setting.business_hours;
            // Handle both old and new business_hours structures
            let todayHours;
            if (Array.isArray(businessHours) && businessHours.length > 0) {
                // New structure: business_hours is an array of schedule objects
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
            else if (businessHours && typeof businessHours === 'object' && businessHours[today]) {
                // Old structure: business_hours is a direct object
                todayHours = businessHours[today];
            }
            if (!todayHours)
                return false;
            // Check if the site is open today
            const isOpen = todayHours.enabled !== false &&
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
        // NEW: Time-aware analysis
        console.log(`\n🕐 TIME-AWARE ANALYSIS (Current: ${currentTimeStr} UTC):`);
        let sitesCurrentlyOpen = 0;
        let earliestOpenTime = '24:00';
        let latestCloseTime = '00:00';
        openSites.filter(setting => {
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
            else if (businessHours && typeof businessHours === 'object' && businessHours[today]) {
                todayHours = businessHours[today];
            }
            if (!todayHours)
                return false;
            // Convert times to comparable format (assuming UTC for now, will improve timezone support later)
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
            // Track earliest and latest times
            if (todayHours.open < earliestOpenTime)
                earliestOpenTime = todayHours.open;
            if (todayHours.close > latestCloseTime)
                latestCloseTime = todayHours.close;
            return isCurrentlyOpen;
        });
        const isWithinAnyBusinessHours = sitesCurrentlyOpen > 0;
        console.log(`📊 Time Analysis Summary:`);
        console.log(`   - Sites open today: ${openSites.length}`);
        console.log(`   - Sites currently in business hours: ${sitesCurrentlyOpen}`);
        console.log(`   - Business hours span: ${openSites.length > 0 ? `${earliestOpenTime} - ${latestCloseTime}` : 'N/A'}`);
        console.log(`   - Should execute now: ${isWithinAnyBusinessHours}`);
        // NEW: Evaluate both groups separately
        console.log(`\n🔍 EVALUATING BOTH GROUPS SEPARATELY:`);
        // Group 1: Sites with business_hours
        const sitesWithBusinessHoursExecute = openSites.length > 0;
        console.log(`   Group 1 (sites with business_hours): ${sitesWithBusinessHoursExecute ? 'EXECUTE' : 'SKIP'} (${openSites.length} sites open)`);
        // Group 2: Sites without business_hours (fallback logic)
        const sitesWithoutBusinessHours = settings.length - sitesWithBusinessHours.length;
        const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5; // Restored original logic: Mon-Fri
        const sitesWithoutBusinessHoursExecute = sitesWithoutBusinessHours > 0 && isWeekday;
        console.log(`   Group 2 (sites without business_hours): ${sitesWithoutBusinessHoursExecute ? 'EXECUTE' : 'SKIP'} (${sitesWithoutBusinessHours} sites, ${isWeekday ? 'weekday' : 'weekend'})`);
        // Final decision: Execute if EITHER group should execute
        const shouldExecuteOperations = sitesWithBusinessHoursExecute || sitesWithoutBusinessHoursExecute;
        let shouldExecuteNow = false;
        let shouldScheduleForLater = false;
        let nextExecutionTime = '';
        let reason;
        if (!shouldExecuteOperations) {
            // Neither group should execute
            const businessHoursReason = sitesWithBusinessHours.length > 0 ? `Sites with business_hours are closed on ${today}` : 'No sites have business_hours';
            const fallbackReason = sitesWithoutBusinessHours > 0 ? (isWeekday ? 'Weekday (fallback sites available)' : 'Weekend (no fallback execution)') : 'No sites without business_hours';
            reason = `${businessHoursReason} and ${fallbackReason}`;
        }
        else {
            // At least one group should execute
            if (sitesWithBusinessHoursExecute && sitesWithoutBusinessHoursExecute) {
                // Both groups should execute
                if (isWithinAnyBusinessHours) {
                    shouldExecuteNow = true;
                    shouldScheduleForLater = false;
                    reason = `${sitesCurrentlyOpen} site(s) with business_hours are currently open AND ${sitesWithoutBusinessHours} site(s) without business_hours (weekday fallback)`;
                }
                else {
                    // Business hours sites are open but not currently, check timing
                    const [earliestHour, earliestMinute] = earliestOpenTime.split(':').map(Number);
                    const earliestOpenMinutes = earliestHour * 60 + earliestMinute;
                    const currentTimeMinutes = currentHour * 60 + currentMinute;
                    if (currentTimeMinutes < earliestOpenMinutes) {
                        shouldExecuteNow = false;
                        shouldScheduleForLater = true;
                        nextExecutionTime = earliestOpenTime;
                        reason = `${openSites.length} site(s) with business_hours open on ${today} but too early (opens at ${earliestOpenTime}) AND ${sitesWithoutBusinessHours} site(s) without business_hours (weekday fallback)`;
                    }
                    else {
                        // We're after business hours - check if it's too late for catch-up mode
                        const [latestHour, latestMinute] = latestCloseTime.split(':').map(Number);
                        const latestCloseMinutes = latestHour * 60 + latestMinute;
                        const hoursSinceClose = (currentTimeMinutes - latestCloseMinutes) / 60;
                        if (hoursSinceClose <= 6) {
                            // Execute in catch-up mode (within 6 hours after close)
                            shouldExecuteNow = true;
                            shouldScheduleForLater = false;
                            reason = `${openSites.length} site(s) with business_hours open on ${today} (catch-up mode: ${hoursSinceClose.toFixed(1)}h after close) AND ${sitesWithoutBusinessHours} site(s) without business_hours (weekday fallback)`;
                        }
                        else {
                            // Too late for catch-up, schedule for next business day
                            shouldExecuteNow = false;
                            shouldScheduleForLater = true;
                            nextExecutionTime = earliestOpenTime;
                            reason = `${openSites.length} site(s) with business_hours open on ${today}, but too late for catch-up (${hoursSinceClose.toFixed(1)}h after close) - scheduling for next business day AND ${sitesWithoutBusinessHours} site(s) without business_hours`;
                        }
                    }
                }
            }
            else if (sitesWithBusinessHoursExecute) {
                // Only business hours sites should execute
                if (isWithinAnyBusinessHours) {
                    shouldExecuteNow = true;
                    shouldScheduleForLater = false;
                    reason = `${sitesCurrentlyOpen} site(s) with business_hours are currently open`;
                }
                else {
                    const [earliestHour, earliestMinute] = earliestOpenTime.split(':').map(Number);
                    const earliestOpenMinutes = earliestHour * 60 + earliestMinute;
                    const currentTimeMinutes = currentHour * 60 + currentMinute;
                    if (currentTimeMinutes < earliestOpenMinutes) {
                        shouldExecuteNow = false;
                        shouldScheduleForLater = true;
                        nextExecutionTime = earliestOpenTime;
                        reason = `${openSites.length} site(s) with business_hours open on ${today}, but too early (opens at ${earliestOpenTime})`;
                    }
                    else {
                        // We're after business hours - check if it's too late for catch-up mode
                        const [latestHour, latestMinute] = latestCloseTime.split(':').map(Number);
                        const latestCloseMinutes = latestHour * 60 + latestMinute;
                        const currentTimeMinutes = currentHour * 60 + currentMinute;
                        const hoursSinceClose = (currentTimeMinutes - latestCloseMinutes) / 60;
                        if (hoursSinceClose <= 6) {
                            // Execute in catch-up mode (within 6 hours after close)
                            shouldExecuteNow = true;
                            shouldScheduleForLater = false;
                            reason = `${openSites.length} site(s) with business_hours open on ${today}, executing in catch-up mode (${hoursSinceClose.toFixed(1)}h after close)`;
                        }
                        else {
                            // Too late for catch-up, schedule for next business day
                            shouldExecuteNow = false;
                            shouldScheduleForLater = true;
                            nextExecutionTime = earliestOpenTime;
                            reason = `${openSites.length} site(s) with business_hours open on ${today}, but too late for catch-up (${hoursSinceClose.toFixed(1)}h after close) - scheduling for next business day`;
                        }
                    }
                }
            }
            else {
                // Only fallback sites should execute
                shouldExecuteNow = true;
                shouldScheduleForLater = false;
                reason = `${sitesWithoutBusinessHours} site(s) without business_hours (weekday fallback)`;
            }
        }
        console.log(`🎯 FINAL DECISION: ${shouldExecuteOperations ? 'EXECUTE' : 'SKIP'} - ${reason}`);
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
            currentTimeAnalysis: {
                currentHour,
                currentMinute,
                timezone: 'UTC',
                isWithinAnyBusinessHours,
                sitesCurrentlyOpen
            },
            openSites: openSites.map(site => {
                const businessHours = site.business_hours;
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
                else if (businessHours && typeof businessHours === 'object' && businessHours[today]) {
                    todayHours = businessHours[today];
                }
                return {
                    siteId: site.site_id,
                    businessHours: todayHours
                };
            })
        };
    }
    catch (error) {
        console.error('❌ Error evaluating business hours:', error);
        // Fallback to simple weekday logic on error
        const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
        return {
            shouldExecuteOperations: isWeekday,
            reason: `Error checking business_hours, fallback to ${isWeekday ? 'weekday' : 'weekend'} logic: ${error instanceof Error ? error.message : String(error)}`,
            sitesWithBusinessHours: 0,
            sitesOpenToday: 0,
            openSites: [],
            shouldExecuteNow: isWeekday,
            shouldScheduleForLater: false
        };
    }
}
async function getContext() {
    console.log('🔍 Getting context for prioritization...');
    // Simulate getting context from various sources
    // This could include user data, project status, deadlines, etc.
    const context = {
        projects: ['Project A', 'Project B', 'Project C'],
        deadlines: ['2024-01-15', '2024-01-20', '2024-01-25'],
        resources: ['Team 1', 'Team 2', 'Team 3'],
        priorities: ['High', 'Medium', 'Low']
    };
    console.log('✅ Context retrieved successfully');
    return {
        context: JSON.stringify(context),
        timestamp: new Date()
    };
}
async function designPlan(context) {
    console.log('📋 Designing prioritization plan...');
    // Parse context for future use
    JSON.parse(context);
    // Simulate AI/algorithm-based plan design
    const plan = {
        strategy: 'Priority-based resource allocation',
        timeline: '24 hours',
        methodology: 'Weighted scoring with deadline consideration'
    };
    const activities = [
        'Review project deadlines',
        'Assess resource availability',
        'Calculate priority scores',
        'Allocate resources',
        'Schedule tasks'
    ];
    console.log('✅ Plan designed successfully');
    return {
        plan: JSON.stringify(plan),
        activities
    };
}
async function sendPlan(_plan) {
    console.log('📤 Sending prioritization plan...');
    // Simulate sending plan to stakeholders
    const recipients = [
        'project-manager@company.com',
        'team-lead@company.com',
        'stakeholder@company.com'
    ];
    // Here you would integrate with email service, Slack, etc.
    console.log('📧 Plan sent to:', recipients.join(', '));
    console.log('✅ Plan sent successfully');
    return {
        sent: true,
        recipients
    };
}
async function sendPriorityMail(activities) {
    console.log('📬 Sending priority notifications...');
    // Simulate sending priority emails for each activity
    for (const activity of activities) {
        console.log(`📧 Sending priority notification for: ${activity}`);
        // Simulate email sending delay
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    console.log('✅ All priority notifications sent');
    return {
        sent: true,
        count: activities.length
    };
}
async function scheduleActivities(activities) {
    console.log('📅 Scheduling activities via API calls...');
    let apiCallCount = 0;
    for (const activity of activities) {
        console.log(`🔗 Making API call to schedule: ${activity}`);
        // Simulate different API calls for scheduling
        try {
            // This could be calls to project management tools, calendar APIs, etc.
            await simulateApiCall(activity);
            apiCallCount++;
        }
        catch (error) {
            console.error(`❌ Failed to schedule ${activity}:`, error);
        }
    }
    console.log('✅ All activities scheduled via API');
    return {
        scheduled: true,
        apiCalls: apiCallCount
    };
}
// Helper function to simulate API calls
async function simulateApiCall(activity) {
    // Simulate API call delay and potential failure
    await new Promise(resolve => setTimeout(resolve, 200));
    // Simulate 5% failure rate
    if (Math.random() < 0.05) {
        throw new Error(`API call failed for ${activity}`);
    }
    console.log(`✅ API call successful for: ${activity}`);
}
