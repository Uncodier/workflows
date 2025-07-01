"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activityPrioritizationEngineWorkflow = activityPrioritizationEngineWorkflow;
const workflow_1 = require("@temporalio/workflow");
const { evaluateBusinessHoursForDay, scheduleIndividualDailyStandUpsActivity } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: '10 minutes',
});
/**
 * Activity Prioritization Engine Workflow
 * Decides WHETHER to execute daily operations based on business logic
 * Now considers business_hours from database for smarter scheduling
 * If YES → executes dailyOperationsWorkflow
 * Now includes time-aware logic to prevent execution outside business hours
 */
async function activityPrioritizationEngineWorkflow() {
    console.log('🎯 Starting activity prioritization engine workflow...');
    const startTime = new Date();
    try {
        // Step 1: Decision Logic - Should we execute operations today?
        console.log('🤔 Step 1: Analyzing if operations should execute today...');
        const today = new Date();
        const dayOfWeek = today.getDay(); // 0=Sunday, 1=Monday, etc.
        const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dayOfWeek];
        const currentHour = today.getHours();
        console.log(`📅 Today is ${dayName} (${dayOfWeek}) at ${currentHour}:${today.getMinutes().toString().padStart(2, '0')}`);
        // NEW: Evaluate business hours from database with time awareness
        console.log('🏢 Evaluating business hours from database with time awareness...');
        const businessHoursAnalysis = await evaluateBusinessHoursForDay(dayOfWeek);
        console.log('📊 Business Hours Analysis:');
        console.log(`   - Sites with business_hours: ${businessHoursAnalysis.sitesWithBusinessHours}`);
        console.log(`   - Sites open today: ${businessHoursAnalysis.sitesOpenToday}`);
        console.log(`   - Decision: ${businessHoursAnalysis.shouldExecuteOperations ? 'EXECUTE' : 'SKIP'}`);
        console.log(`   - Reason: ${businessHoursAnalysis.reason}`);
        // NEW: Time-aware analysis
        if (businessHoursAnalysis.currentTimeAnalysis) {
            const timeAnalysis = businessHoursAnalysis.currentTimeAnalysis;
            console.log('🕐 Time Analysis:');
            console.log(`   - Current time: ${timeAnalysis.currentHour}:${timeAnalysis.currentMinute.toString().padStart(2, '0')} ${timeAnalysis.timezone}`);
            console.log(`   - Sites currently in business hours: ${timeAnalysis.sitesCurrentlyOpen}`);
            console.log(`   - Should execute now: ${businessHoursAnalysis.shouldExecuteNow}`);
            console.log(`   - Should schedule for later: ${businessHoursAnalysis.shouldScheduleForLater}`);
            if (businessHoursAnalysis.nextExecutionTime) {
                console.log(`   - Next execution time: ${businessHoursAnalysis.nextExecutionTime}`);
            }
        }
        if (businessHoursAnalysis.openSites.length > 0) {
            console.log('   - Open sites today:');
            businessHoursAnalysis.openSites.forEach(site => {
                console.log(`     • Site ${site.siteId}: ${site.businessHours.open} - ${site.businessHours.close}`);
            });
        }
        // NEW: Enhanced decision logic with timing
        const shouldExecute = businessHoursAnalysis.shouldExecuteOperations;
        const shouldExecuteNow = businessHoursAnalysis.shouldExecuteNow;
        const shouldScheduleForLater = businessHoursAnalysis.shouldScheduleForLater;
        const reason = businessHoursAnalysis.reason;
        let timingDecision;
        let scheduledForTime;
        if (!shouldExecute) {
            timingDecision = 'skip';
            console.log(`📋 Final Decision: ⏭️ SKIP - ${reason}`);
        }
        else if (shouldScheduleForLater) {
            timingDecision = 'schedule_for_later';
            scheduledForTime = businessHoursAnalysis.nextExecutionTime;
            console.log(`📋 Final Decision: ⏰ SCHEDULE FOR LATER (${scheduledForTime}) - ${reason}`);
            console.log(`🚨 IMPORTANT: Execution is being SKIPPED because it's outside business hours`);
            console.log(`   - Current time is too early, should execute at: ${scheduledForTime}`);
            console.log(`   - This prevents spamming customers outside business hours`);
        }
        else if (shouldExecuteNow) {
            timingDecision = 'execute_now';
            console.log(`📋 Final Decision: ✅ EXECUTE NOW - ${reason}`);
        }
        else {
            // Fallback: if shouldExecute is true but timing flags are unclear
            timingDecision = 'execute_now';
            console.log(`📋 Final Decision: ✅ EXECUTE NOW (fallback) - ${reason}`);
        }
        let operationsResult;
        let operationsExecuted = false;
        // Step 2: Execute operations based on timing decision
        if (timingDecision === 'execute_now') {
            console.log('🚀 Step 2: Executing daily operations workflow NOW...');
            try {
                operationsResult = await (0, workflow_1.executeChild)('dailyOperationsWorkflow', {
                    workflowId: `daily-operations-${Date.now()}`,
                    args: [{ businessHoursAnalysis }],
                });
                operationsExecuted = true;
                console.log('✅ Daily operations workflow completed successfully');
            }
            catch (operationsError) {
                console.error('❌ Daily operations workflow failed:', operationsError);
                operationsResult = {
                    error: operationsError instanceof Error ? operationsError.message : String(operationsError)
                };
            }
        }
        else if (timingDecision === 'schedule_for_later') {
            console.log('⏰ Step 2: SCHEDULING operations for later execution...');
            try {
                console.log(`📅 Creating individual schedules for each site at their specific business hours`);
                // Use the new individual scheduling approach instead of global scheduling
                const scheduleResult = await scheduleIndividualDailyStandUpsActivity(businessHoursAnalysis, {
                    timezone: 'America/Mexico_City'
                });
                if (scheduleResult.scheduled > 0) {
                    console.log(`✅ Successfully created ${scheduleResult.scheduled} individual schedules`);
                    if (scheduleResult.failed > 0) {
                        console.log(`⚠️ Failed to schedule ${scheduleResult.failed} sites`);
                    }
                    operationsResult = {
                        scheduled: true,
                        scheduledTime: scheduledForTime,
                        individualSchedules: scheduleResult.scheduled,
                        failedSchedules: scheduleResult.failed,
                        scheduleDetails: scheduleResult.results,
                        message: `Individual schedules created: ${scheduleResult.scheduled} sites will execute at their specific business hours`,
                        approach: 'individual-site-schedules'
                    };
                }
                else {
                    console.error(`❌ No schedules were created successfully`);
                    operationsResult = {
                        scheduled: false,
                        scheduledTime: scheduledForTime,
                        individualSchedules: 0,
                        failedSchedules: scheduleResult.failed,
                        errors: scheduleResult.errors,
                        message: `Failed to create individual schedules: ${scheduleResult.errors.join(', ')}`,
                        approach: 'individual-site-schedules'
                    };
                }
                operationsExecuted = false; // Not executed now, but scheduled individually
            }
            catch (schedulingError) {
                console.error('❌ Error creating individual schedules:', schedulingError);
                operationsResult = {
                    scheduled: false,
                    scheduledTime: scheduledForTime,
                    error: schedulingError instanceof Error ? schedulingError.message : String(schedulingError),
                    message: `Failed to schedule individual operations: ${schedulingError instanceof Error ? schedulingError.message : String(schedulingError)}`,
                    approach: 'individual-site-schedules'
                };
                operationsExecuted = false;
            }
        }
        else {
            console.log('⏭️ Step 2: Skipping daily operations (decision was SKIP)');
        }
        const endTime = new Date();
        const executionTime = `${endTime.getTime() - startTime.getTime()}ms`;
        console.log('🎉 Activity prioritization engine workflow completed');
        console.log(`   Decision: ${shouldExecute ? 'EXECUTE' : 'SKIP'}`);
        console.log(`   Timing: ${timingDecision.toUpperCase().replace('_', ' ')}`);
        console.log(`   Operations executed: ${operationsExecuted ? 'YES' : 'NO'}`);
        if (scheduledForTime) {
            console.log(`   Scheduled for: ${scheduledForTime}`);
        }
        if (operationsResult?.individualSchedules) {
            console.log(`   Individual schedules created: ${operationsResult.individualSchedules}`);
            console.log(`   Approach: ${operationsResult.approach || 'individual-site-schedules'}`);
        }
        console.log(`   Total execution time: ${executionTime}`);
        console.log('   Role: Decision maker and orchestrator with business hours respect');
        return {
            shouldExecute,
            reason,
            operationsExecuted,
            operationsResult,
            executionTime,
            businessHoursAnalysis,
            timingDecision,
            scheduledForTime
        };
    }
    catch (error) {
        console.error('❌ Activity prioritization engine workflow failed:', error);
        throw error;
    }
}
