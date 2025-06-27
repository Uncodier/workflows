import { proxyActivities } from '@temporalio/workflow';
import type * as activities from '../activities';

// Configure activity options
const { 
  getContext, 
  designPlan, 
  sendPlan, 
  sendPriorityMail, 
  scheduleActivities
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '2 minutes',
});

// Configure longer timeout for scheduling activities
const { 
  scheduleDailyStandUpWorkflowsActivity
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '10 minutes', // Longer timeout for site processing
});

/**
 * Activity Prioritization Engine Workflow
 * Runs once a day and manages different prioritization activities
 */
export async function activityPrioritizationEngineWorkflow(): Promise<{
  contextRetrieved: boolean;
  planDesigned: boolean;
  planSent: boolean;
  priorityMailsSent: number;
  activitiesScheduled: number;
  dailyStandUpsScheduled: number;
  executionTime: string;
}> {
  console.log('🎯 Starting activity prioritization engine workflow...');
  const startTime = new Date();

  try {
    // Step 1: Get context
    console.log('🔍 Step 1: Getting context...');
    const contextResult = await getContext();
    console.log('✅ Context retrieved successfully');

    // Step 2: Design plan
    console.log('📋 Step 2: Designing plan...');
    const planResult = await designPlan(contextResult.context);
    console.log('✅ Plan designed successfully');

    // Step 3: Send plan
    console.log('📤 Step 3: Sending plan...');
    const sendPlanResult = await sendPlan(planResult.plan);
    console.log(`✅ Plan sent to ${sendPlanResult.recipients.length} recipients`);

    // Step 4: Send priority mail
    console.log('📬 Step 4: Sending priority mails...');
    const priorityMailResult = await sendPriorityMail(planResult.activities);
    console.log(`✅ Priority mails sent: ${priorityMailResult.count}`);

    // Step 5: Schedule activities (API calls)
    console.log('📅 Step 5: Scheduling activities...');
    const scheduleResult = await scheduleActivities(planResult.activities);
    console.log(`✅ Activities scheduled via ${scheduleResult.apiCalls} API calls`);

    // Step 6: Schedule daily stand up workflows for all sites
    console.log('🌅 Step 6: Scheduling daily stand up workflows...');
    
    let dailyStandUpResult;
    try {
      console.log('🔄 About to call scheduleDailyStandUpWorkflowsActivity...');
      
      // Production mode - changed from test mode for actual scheduling
      dailyStandUpResult = await scheduleDailyStandUpWorkflowsActivity({
        dryRun: false,  // PRODUCTION: Actually create schedules
        testMode: false, // PRODUCTION: Full production mode
        // No maxSites limit for production - will process all sites
      });
      
      console.log('🎯 scheduleDailyStandUpWorkflowsActivity completed successfully');
      console.log(`✅ Daily stand ups scheduled: ${dailyStandUpResult.scheduled} sites`);
      console.log(`   Failed: ${dailyStandUpResult.failed}, Skipped: ${dailyStandUpResult.skipped}`);
      
      if (dailyStandUpResult.testInfo) {
        console.log(`   Mode: ${dailyStandUpResult.testInfo.mode}`);
        console.log(`   Duration: ${dailyStandUpResult.testInfo.duration}`);
      }
    } catch (dailyStandUpError) {
      console.error('❌ Error in scheduleDailyStandUpWorkflowsActivity:', dailyStandUpError);
      // Set default values for the failed activity
      dailyStandUpResult = {
        scheduled: 0,
        failed: 1,
        skipped: 0,
        results: [],
        errors: [dailyStandUpError instanceof Error ? dailyStandUpError.message : String(dailyStandUpError)]
      };
    }

    const endTime = new Date();
    const executionTime = `${endTime.getTime() - startTime.getTime()}ms`;

    console.log('🎉 Activity prioritization engine workflow completed successfully');
    return {
      contextRetrieved: true,
      planDesigned: true,
      planSent: true,
      priorityMailsSent: priorityMailResult.count,
      activitiesScheduled: scheduleResult.apiCalls,
      dailyStandUpsScheduled: dailyStandUpResult.scheduled,
      executionTime
    };

  } catch (error) {
    console.error('❌ Activity prioritization engine workflow failed:', error);
    throw error;
  }
} 