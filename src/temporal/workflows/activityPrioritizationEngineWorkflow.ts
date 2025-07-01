import { executeChild, proxyActivities } from '@temporalio/workflow';
import type { Activities } from '../activities';

const { evaluateBusinessHoursForDay, scheduleDailyOperationsWorkflowActivity } = proxyActivities<Activities>({
  startToCloseTimeout: '10 minutes',
});

/**
 * Activity Prioritization Engine Workflow
 * Decides WHETHER to execute daily operations based on business logic
 * Now considers business_hours from database for smarter scheduling
 * If YES → executes dailyOperationsWorkflow
 * Now includes time-aware logic to prevent execution outside business hours
 */
export async function activityPrioritizationEngineWorkflow(): Promise<{
  shouldExecute: boolean;
  reason: string;
  operationsExecuted: boolean;
  operationsResult?: any;
  executionTime: string;
  businessHoursAnalysis?: any;
  timingDecision?: 'execute_now' | 'schedule_for_later' | 'skip';
  scheduledForTime?: string;
}> {
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
    
    let timingDecision: 'execute_now' | 'schedule_for_later' | 'skip';
    let scheduledForTime: string | undefined;
    
    if (!shouldExecute) {
      timingDecision = 'skip';
      console.log(`📋 Final Decision: ⏭️ SKIP - ${reason}`);
    } else if (shouldScheduleForLater) {
      timingDecision = 'schedule_for_later';
      scheduledForTime = businessHoursAnalysis.nextExecutionTime;
      console.log(`📋 Final Decision: ⏰ SCHEDULE FOR LATER (${scheduledForTime}) - ${reason}`);
      console.log(`🚨 IMPORTANT: Execution is being SKIPPED because it's outside business hours`);
      console.log(`   - Current time is too early, should execute at: ${scheduledForTime}`);
      console.log(`   - This prevents spamming customers outside business hours`);
    } else if (shouldExecuteNow) {
      timingDecision = 'execute_now';
      console.log(`📋 Final Decision: ✅ EXECUTE NOW - ${reason}`);
    } else {
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
        operationsResult = await executeChild('dailyOperationsWorkflow', {
          workflowId: `daily-operations-${Date.now()}`,
          args: [{ businessHoursAnalysis }],
        });
        
        operationsExecuted = true;
        console.log('✅ Daily operations workflow completed successfully');
      } catch (operationsError) {
        console.error('❌ Daily operations workflow failed:', operationsError);
        operationsResult = {
          error: operationsError instanceof Error ? operationsError.message : String(operationsError)
        };
      }
    } else if (timingDecision === 'schedule_for_later') {
      console.log('⏰ Step 2: SCHEDULING operations for later execution...');
      
      try {
        console.log(`📅 Creating Temporal schedule for: ${scheduledForTime}`);
        
        // Call the new scheduling activity
        const scheduleResult = await scheduleDailyOperationsWorkflowActivity(
          scheduledForTime!, // The time (e.g., "09:00")
          businessHoursAnalysis,
          {
            timezone: 'America/Mexico_City' // Default timezone from business hours
          }
        );
        
        if (scheduleResult.success) {
          console.log(`✅ Successfully created schedule: ${scheduleResult.scheduleId}`);
          operationsResult = {
            scheduled: true,
            scheduledTime: scheduledForTime,
            scheduleId: scheduleResult.scheduleId,
            workflowId: scheduleResult.workflowId,
            message: `Operations scheduled for ${scheduledForTime} (schedule created in Temporal)`
          };
        } else {
          console.error(`❌ Failed to create schedule: ${scheduleResult.error}`);
          operationsResult = {
            scheduled: false,
            scheduledTime: scheduledForTime,
            error: scheduleResult.error,
            message: `Failed to schedule operations for ${scheduledForTime}: ${scheduleResult.error}`
          };
        }
        
        operationsExecuted = false; // Not executed now, but scheduled
        
      } catch (schedulingError) {
        console.error('❌ Error creating schedule:', schedulingError);
        operationsResult = {
          scheduled: false,
          scheduledTime: scheduledForTime,
          error: schedulingError instanceof Error ? schedulingError.message : String(schedulingError),
          message: `Failed to schedule operations: ${schedulingError instanceof Error ? schedulingError.message : String(schedulingError)}`
        };
        operationsExecuted = false;
      }
    } else {
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

  } catch (error) {
    console.error('❌ Activity prioritization engine workflow failed:', error);
    throw error;
  }
} 