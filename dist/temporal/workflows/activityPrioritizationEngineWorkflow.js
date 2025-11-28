"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activityPrioritizationEngineWorkflow = activityPrioritizationEngineWorkflow;
const workflow_1 = require("@temporalio/workflow");
const { evaluateBusinessHoursForDay, scheduleIndividualDailyStandUpsActivity, scheduleIndividualSiteAnalysisActivity, scheduleIndividualLeadGenerationActivity, scheduleIndividualDailyProspectionActivity, executeDailyProspectionWorkflowsActivity, validateAndCleanStuckCronStatusActivity, scheduleLeadQualificationActivity, fetchActivitiesMapActivity } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: '10 minutes',
});
/**
 * Extract the real schedule ID from workflow info
 * This is the schedule that triggers the entire daily operations pipeline
 */
function extractScheduleId(info) {
    // Check if workflow was triggered by a schedule
    // Temporal schedules typically set search attributes or memo data
    const searchAttributes = info.searchAttributes || {};
    const memo = info.memo || {};
    // Look for common schedule-related attributes
    const scheduleId = searchAttributes['TemporalScheduledById'] ||
        searchAttributes['ScheduleId'] ||
        memo['TemporalScheduledById'] ||
        memo['scheduleId'] ||
        memo['scheduleName'];
    if (scheduleId) {
        console.log(`✅ Activity Prioritization Engine - Real schedule ID found: ${scheduleId}`);
        return scheduleId;
    }
    // If no schedule ID found, it might be a manual execution or child workflow
    console.log(`⚠️ Activity Prioritization Engine - No schedule ID found - likely manual execution`);
    return 'manual-execution';
}
/**
 * Activity Prioritization Engine Workflow
 * Decides WHETHER to execute daily operations based on business logic
 * Now considers business_hours from database for smarter scheduling
 * If YES → executes dailyOperationsWorkflow
 * Now includes time-aware logic to prevent execution outside business hours
 * WEEKEND RESTRICTION: Only schedules sites with business_hours on weekends (Fri/Sat)
 * WEEKDAY FALLBACK: Sites without business_hours use 09:00 fallback (Sun-Thu)
 * AFTER DAILY STANDUPS: Executes dailyProspectionWorkflow for lead prospection
 */
async function activityPrioritizationEngineWorkflow() {
    console.log('🎯 Starting activity prioritization engine workflow...');
    const startTime = new Date();
    // Get REAL workflow information and schedule ID from Temporal
    const workflowInfo_real = (0, workflow_1.workflowInfo)();
    const realWorkflowId = workflowInfo_real.workflowId;
    const realScheduleId = extractScheduleId(workflowInfo_real);
    console.log(`📋 Activity Prioritization Engine Info:`);
    console.log(`   - REAL Workflow ID: ${realWorkflowId}`);
    console.log(`   - REAL Schedule ID: ${realScheduleId} (${realScheduleId === 'manual-execution' ? 'manual execution' : 'from schedule'})`);
    console.log(`   - This schedule ID will be propagated to all child workflows`);
    try {
        // Step 0: Validate and clean any stuck cron status records
        console.log('🔍 Step 0: Validating cron status for activity prioritization engine...');
        const cronValidation = await validateAndCleanStuckCronStatusActivity('activityPrioritizationEngineWorkflow', 'global', // This is a global workflow
        24 // 24 hours threshold
        );
        console.log(`📋 Cron validation result: ${cronValidation.reason}`);
        if (cronValidation.wasStuck) {
            console.log(`🧹 Cleaned stuck record: ${cronValidation.hoursStuck?.toFixed(1)}h old`);
        }
        if (!cronValidation.canProceed) {
            console.log('⏳ Another activity prioritization engine is likely running - skipping execution');
            return {
                shouldExecute: false,
                reason: cronValidation.reason,
                operationsExecuted: false,
                executionTime: `${Date.now() - startTime.getTime()}ms`,
                timingDecision: 'skip'
            };
        }
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
        // Check if daily standups should execute (only Monday and Friday)
        const isMondayOrFriday = dayOfWeek === 1 || dayOfWeek === 5; // Monday = 1, Friday = 5
        if (!isMondayOrFriday) {
            console.log(`📅 Daily standups restriction: Today is ${dayName}, standups only execute on Monday and Friday`);
            console.log(`   - Daily standups will be SKIPPED`);
            console.log(`   - Other operations (prospection, lead generation, etc.) will continue as normal`);
        }
        else {
            console.log(`📅 Daily standups allowed: Today is ${dayName}, standups will execute`);
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
                // Step 2.1: Execute daily prospection workflow after daily standups
                console.log('🎯 Step 2.1: Executing daily prospection workflow after daily standups...');
                console.log('   Daily prospection will process leads after standups complete');
                try {
                    // Build a list of candidate site IDs from business hours analysis (fallback to empty map if not available)
                    const candidateSiteIds = (businessHoursAnalysis?.openSites || []).map((s) => s.siteId);
                    const activitiesMap = await fetchActivitiesMapActivity(candidateSiteIds);
                    const dailyProspectionResult = await executeDailyProspectionWorkflowsActivity({
                        dryRun: false, // PRODUCTION: Actually execute workflows
                        testMode: false, // PRODUCTION: Full production mode
                        businessHoursAnalysis, // PASS business hours analysis for filtering
                        hoursThreshold: 48, // Look for leads older than 48 hours
                        maxLeads: 30, // Limit to 30 leads per site
                        parentScheduleId: realScheduleId, // PASS parent schedule ID for proper tracking
                        activitiesMap
                    });
                    console.log(`🎯 Daily prospection workflows execution completed:`);
                    console.log(`   ✅ Prospection executed: ${dailyProspectionResult.scheduled} sites`);
                    console.log(`   ⏭️ Skipped: ${dailyProspectionResult.skipped} sites`);
                    console.log(`   ❌ Failed: ${dailyProspectionResult.failed} sites`);
                    // Add daily prospection results to operations result
                    operationsResult.dailyProspectionExecution = {
                        scheduled: dailyProspectionResult.scheduled,
                        skipped: dailyProspectionResult.skipped,
                        failed: dailyProspectionResult.failed,
                        results: dailyProspectionResult.results,
                        errors: dailyProspectionResult.errors
                    };
                }
                catch (dailyProspectionError) {
                    console.error('❌ Error executing daily prospection workflows:', dailyProspectionError);
                    operationsResult.dailyProspectionExecution = {
                        scheduled: 0,
                        skipped: 0,
                        failed: 1,
                        results: [],
                        errors: [dailyProspectionError instanceof Error ? dailyProspectionError.message : String(dailyProspectionError)]
                    };
                }
                // Step 2.2: Schedule site analysis for sites that need initial analysis
                console.log('🔍 Step 2.2: Scheduling site analysis for sites that need initial analysis...');
                console.log('   Note: Site analysis will be scheduled even when daily standups execute immediately');
                console.log('   This ensures sites get their initial analysis regardless of timing');
                try {
                    const candidateSiteIds = (businessHoursAnalysis?.openSites || []).map((s) => s.siteId);
                    const activitiesMap = await fetchActivitiesMapActivity(candidateSiteIds);
                    const siteAnalysisResult = await scheduleIndividualSiteAnalysisActivity(businessHoursAnalysis, {
                        timezone: 'America/Mexico_City',
                        parentScheduleId: realScheduleId, // PASS parent schedule ID for proper tracking
                        activitiesMap
                    });
                    console.log(`🔍 Site analysis scheduling completed:`);
                    console.log(`   ✅ Scheduled: ${siteAnalysisResult.scheduled} sites`);
                    console.log(`   ⏭️ Skipped: ${siteAnalysisResult.skipped} sites (already analyzed)`);
                    console.log(`   ❌ Failed: ${siteAnalysisResult.failed} sites`);
                    // Add site analysis results to operations result
                    operationsResult.siteAnalysisScheduling = {
                        scheduled: siteAnalysisResult.scheduled,
                        skipped: siteAnalysisResult.skipped,
                        failed: siteAnalysisResult.failed,
                        results: siteAnalysisResult.results,
                        errors: siteAnalysisResult.errors
                    };
                }
                catch (siteAnalysisError) {
                    console.error('❌ Error scheduling site analysis:', siteAnalysisError);
                    operationsResult.siteAnalysisScheduling = {
                        scheduled: 0,
                        skipped: 0,
                        failed: 1,
                        results: [],
                        errors: [siteAnalysisError instanceof Error ? siteAnalysisError.message : String(siteAnalysisError)]
                    };
                }
                // Step 2.3: Schedule lead generation for 1 hour after daily standups
                console.log('🔥 Step 2.3: Scheduling lead generation for 1 hour after daily standups...');
                console.log('   Lead generation will execute 1 hour after daily standups complete');
                try {
                    const candidateSiteIds = (businessHoursAnalysis?.openSites || []).map((s) => s.siteId);
                    const activitiesMap = await fetchActivitiesMapActivity(candidateSiteIds);
                    const leadGenerationResult = await scheduleIndividualLeadGenerationActivity(businessHoursAnalysis, {
                        timezone: 'America/Mexico_City',
                        parentScheduleId: realScheduleId, // PASS parent schedule ID for proper tracking
                        activitiesMap
                    });
                    console.log(`🔥 Lead generation scheduling completed:`);
                    console.log(`   ✅ Scheduled: ${leadGenerationResult.scheduled} sites`);
                    console.log(`   ⏭️ Skipped: ${leadGenerationResult.skipped} sites`);
                    console.log(`   ❌ Failed: ${leadGenerationResult.failed} sites`);
                    // Add lead generation results to operations result
                    operationsResult.leadGenerationScheduling = {
                        scheduled: leadGenerationResult.scheduled,
                        skipped: leadGenerationResult.skipped,
                        failed: leadGenerationResult.failed,
                        results: leadGenerationResult.results,
                        errors: leadGenerationResult.errors
                    };
                }
                catch (leadGenerationError) {
                    console.error('❌ Error scheduling lead generation:', leadGenerationError);
                    operationsResult.leadGenerationScheduling = {
                        scheduled: 0,
                        skipped: 0,
                        failed: 1,
                        results: [],
                        errors: [leadGenerationError instanceof Error ? leadGenerationError.message : String(leadGenerationError)]
                    };
                }
                // Step 2.4: Schedule lead qualification (Tue/Wed/Thu at 09:00)
                console.log('📆 Step 2.4: Scheduling lead qualification (Tue/Wed/Thu at 09:00)...');
                try {
                    const candidateSiteIds = (businessHoursAnalysis?.openSites || []).map((s) => s.siteId);
                    const activitiesMap = await fetchActivitiesMapActivity(candidateSiteIds);
                    const leadQualificationResult = await scheduleLeadQualificationActivity(businessHoursAnalysis, {
                        timezone: 'America/Mexico_City',
                        daysWithoutReply: 7,
                        maxLeads: 30,
                        parentScheduleId: realScheduleId,
                        activitiesMap
                    });
                    operationsResult.leadQualificationScheduling = leadQualificationResult;
                }
                catch (leadQualificationError) {
                    console.error('❌ Error scheduling lead qualification:', leadQualificationError);
                    operationsResult.leadQualificationScheduling = {
                        scheduled: 0,
                        skipped: 0,
                        failed: 1,
                        results: [],
                        errors: [leadQualificationError instanceof Error ? leadQualificationError.message : String(leadQualificationError)]
                    };
                }
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
                // Only schedule daily standups on Monday and Friday
                if (isMondayOrFriday) {
                    console.log(`📅 Creating individual schedules for each site at their specific business hours`);
                    // Use the new individual scheduling approach instead of global scheduling
                    const scheduleResult = await scheduleIndividualDailyStandUpsActivity(businessHoursAnalysis, {
                        timezone: 'America/Mexico_City',
                        parentScheduleId: realScheduleId // PASS parent schedule ID for proper tracking
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
                }
                else {
                    console.log(`⏭️ Skipping daily standups scheduling - only execute on Monday and Friday`);
                    operationsResult = {
                        scheduled: false,
                        scheduledTime: scheduledForTime,
                        individualSchedules: 0,
                        failedSchedules: 0,
                        message: `Daily standups skipped - only execute on Monday and Friday (today is ${dayName})`,
                        approach: 'individual-site-schedules',
                        standupsSkipped: true,
                        skipReason: `Day restriction: standups only on Monday and Friday`
                    };
                }
                operationsExecuted = false; // Not executed now, but scheduled individually
                // Step 2.1: Schedule daily prospection workflow for later execution (using timers)
                console.log('🎯 Step 2.1: Scheduling daily prospection workflow for later execution...');
                console.log('   Daily prospection will be scheduled for 2 hours after daily standups');
                console.log('   This ensures prospection runs after standups and lead generation complete');
                try {
                    const candidateSiteIds = (businessHoursAnalysis?.openSites || []).map((s) => s.siteId);
                    const activitiesMap = await fetchActivitiesMapActivity(candidateSiteIds);
                    const dailyProspectionSchedulingResult = await scheduleIndividualDailyProspectionActivity(businessHoursAnalysis, {
                        timezone: 'America/Mexico_City',
                        hoursThreshold: 48, // Look for leads older than 48 hours
                        maxLeads: 30, // Limit to 30 leads per site
                        parentScheduleId: realScheduleId, // PASS parent schedule ID for proper tracking
                        activitiesMap
                    });
                    console.log(`🎯 Daily prospection scheduling completed:`);
                    console.log(`   ✅ Scheduled: ${dailyProspectionSchedulingResult.scheduled} sites`);
                    console.log(`   ⏭️ Skipped: ${dailyProspectionSchedulingResult.skipped} sites`);
                    console.log(`   ❌ Failed: ${dailyProspectionSchedulingResult.failed} sites`);
                    // Add daily prospection scheduling results to operations result
                    operationsResult.dailyProspectionScheduling = {
                        scheduled: dailyProspectionSchedulingResult.scheduled,
                        skipped: dailyProspectionSchedulingResult.skipped,
                        failed: dailyProspectionSchedulingResult.failed,
                        results: dailyProspectionSchedulingResult.results,
                        errors: dailyProspectionSchedulingResult.errors
                    };
                }
                catch (dailyProspectionError) {
                    console.error('❌ Error scheduling daily prospection workflows:', dailyProspectionError);
                    operationsResult.dailyProspectionScheduling = {
                        scheduled: 0,
                        skipped: 0,
                        failed: 1,
                        results: [],
                        errors: [dailyProspectionError instanceof Error ? dailyProspectionError.message : String(dailyProspectionError)]
                    };
                }
                // Step 2.1.bis: Schedule lead qualification (Tue/Wed/Thu at 09:00)
                console.log('📆 Step 2.1.bis: Scheduling lead qualification (Tue/Wed/Thu at 09:00)...');
                try {
                    const leadQualificationResult = await scheduleLeadQualificationActivity(businessHoursAnalysis, {
                        timezone: 'America/Mexico_City',
                        daysWithoutReply: 7,
                        maxLeads: 30,
                        parentScheduleId: realScheduleId
                    });
                    operationsResult.leadQualificationScheduling = leadQualificationResult;
                }
                catch (leadQualificationError) {
                    console.error('❌ Error scheduling lead qualification:', leadQualificationError);
                    operationsResult.leadQualificationScheduling = {
                        scheduled: 0,
                        skipped: 0,
                        failed: 1,
                        results: [],
                        errors: [leadQualificationError instanceof Error ? leadQualificationError.message : String(leadQualificationError)]
                    };
                }
                // Step 2.2: Now schedule site analysis since daily standups are also scheduled for later
                console.log('🔍 Step 2.2: Scheduling site analysis for sites that need initial analysis...');
                console.log('   Both daily standups and site analysis will be scheduled for their appropriate times');
                try {
                    const candidateSiteIds = (businessHoursAnalysis?.openSites || []).map((s) => s.siteId);
                    const activitiesMap = await fetchActivitiesMapActivity(candidateSiteIds);
                    const siteAnalysisResult = await scheduleIndividualSiteAnalysisActivity(businessHoursAnalysis, {
                        timezone: 'America/Mexico_City',
                        parentScheduleId: realScheduleId, // PASS parent schedule ID for proper tracking
                        activitiesMap
                    });
                    console.log(`🔍 Site analysis scheduling completed:`);
                    console.log(`   ✅ Scheduled: ${siteAnalysisResult.scheduled} sites`);
                    console.log(`   ⏭️ Skipped: ${siteAnalysisResult.skipped} sites (already analyzed)`);
                    console.log(`   ❌ Failed: ${siteAnalysisResult.failed} sites`);
                    // Add site analysis results to operations result
                    operationsResult.siteAnalysisScheduling = {
                        scheduled: siteAnalysisResult.scheduled,
                        skipped: siteAnalysisResult.skipped,
                        failed: siteAnalysisResult.failed,
                        results: siteAnalysisResult.results,
                        errors: siteAnalysisResult.errors
                    };
                }
                catch (siteAnalysisError) {
                    console.error('❌ Error scheduling site analysis:', siteAnalysisError);
                    operationsResult.siteAnalysisScheduling = {
                        scheduled: 0,
                        skipped: 0,
                        failed: 1,
                        results: [],
                        errors: [siteAnalysisError instanceof Error ? siteAnalysisError.message : String(siteAnalysisError)]
                    };
                }
                // Step 2.3: Schedule lead generation for 1 hour after daily standups
                console.log('🔥 Step 2.3: Scheduling lead generation for 1 hour after daily standups...');
                console.log('   Both daily standups and lead generation will be scheduled for their appropriate times');
                try {
                    const candidateSiteIds = (businessHoursAnalysis?.openSites || []).map((s) => s.siteId);
                    const activitiesMap = await fetchActivitiesMapActivity(candidateSiteIds);
                    const leadGenerationResult = await scheduleIndividualLeadGenerationActivity(businessHoursAnalysis, {
                        timezone: 'America/Mexico_City',
                        parentScheduleId: realScheduleId, // PASS parent schedule ID for proper tracking
                        activitiesMap
                    });
                    console.log(`🔥 Lead generation scheduling completed:`);
                    console.log(`   ✅ Scheduled: ${leadGenerationResult.scheduled} sites`);
                    console.log(`   ⏭️ Skipped: ${leadGenerationResult.skipped} sites`);
                    console.log(`   ❌ Failed: ${leadGenerationResult.failed} sites`);
                    // Add lead generation results to operations result (merge with existing leadGenerationScheduling if exists)
                    if (!operationsResult.leadGenerationScheduling) {
                        operationsResult.leadGenerationScheduling = {
                            scheduled: leadGenerationResult.scheduled,
                            skipped: leadGenerationResult.skipped,
                            failed: leadGenerationResult.failed,
                            results: leadGenerationResult.results,
                            errors: leadGenerationResult.errors
                        };
                    }
                    else {
                        // Merge results if leadGenerationScheduling already exists
                        operationsResult.leadGenerationScheduling.scheduled += leadGenerationResult.scheduled;
                        operationsResult.leadGenerationScheduling.skipped += leadGenerationResult.skipped;
                        operationsResult.leadGenerationScheduling.failed += leadGenerationResult.failed;
                        operationsResult.leadGenerationScheduling.results.push(...leadGenerationResult.results);
                        operationsResult.leadGenerationScheduling.errors.push(...leadGenerationResult.errors);
                    }
                }
                catch (leadGenerationError) {
                    console.error('❌ Error scheduling lead generation:', leadGenerationError);
                    if (!operationsResult.leadGenerationScheduling) {
                        operationsResult.leadGenerationScheduling = {
                            scheduled: 0,
                            skipped: 0,
                            failed: 1,
                            results: [],
                            errors: [leadGenerationError instanceof Error ? leadGenerationError.message : String(leadGenerationError)]
                        };
                    }
                    else {
                        operationsResult.leadGenerationScheduling.failed += 1;
                        operationsResult.leadGenerationScheduling.errors.push(leadGenerationError instanceof Error ? leadGenerationError.message : String(leadGenerationError));
                    }
                }
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
        if (operationsResult?.dailyProspectionExecution) {
            console.log(`   Daily prospection executed: ${operationsResult.dailyProspectionExecution.scheduled} sites`);
            console.log(`   🎯 Daily prospection follows after daily standups`);
        }
        if (operationsResult?.dailyProspectionScheduling) {
            console.log(`   Daily prospection scheduled: ${operationsResult.dailyProspectionScheduling.scheduled} sites`);
            console.log(`   🎯 Daily prospection will execute 2 hours after daily standups`);
        }
        if (operationsResult?.siteAnalysisScheduling) {
            console.log(`   Site analysis scheduled: ${operationsResult.siteAnalysisScheduling.scheduled} sites`);
        }
        if (operationsResult?.leadGenerationScheduling) {
            console.log(`   Lead generation scheduled: ${operationsResult.leadGenerationScheduling.scheduled} sites`);
            console.log(`   🔥 Lead generation will execute 1 hour after daily standups`);
        }
        console.log(`   Total execution time: ${executionTime}`);
        console.log('   Role: Decision maker and orchestrator with business hours respect + lead prospection');
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
