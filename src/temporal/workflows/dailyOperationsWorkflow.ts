import { proxyActivities } from '@temporalio/workflow';
import type * as activities from '../activities';
import type { 
  executeDailyStandUpWorkflowsActivity,
} from '../activities/workflowSchedulingActivities';

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

// Configure longer timeout for executing activities
const { 
  executeDailyStandUpWorkflowsActivity: executeDailyStandUp,
} = proxyActivities<{
  executeDailyStandUpWorkflowsActivity: typeof executeDailyStandUpWorkflowsActivity;
}>({
  startToCloseTimeout: '10 minutes',
  heartbeatTimeout: '1 minute',
  retry: {
    initialInterval: '1 minute',
    maximumInterval: '5 minutes',
    maximumAttempts: 3,
  },
});

/**
 * Daily Operations Workflow
 * Executes all daily operational activities when triggered by activityPrioritizationEngine
 */
export async function dailyOperationsWorkflow(): Promise<{
  contextRetrieved: boolean;
  planDesigned: boolean;
  planSent: boolean;
  priorityMailsSent: number;
  activitiesScheduled: number;
  dailyStandUpsExecuted: number;
  executionTime: string;
}> {
  console.log('⚙️ Starting daily operations workflow...');
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

    // Step 6: Execute daily stand up workflows for all sites
    console.log('🌅 Step 6: Executing daily stand up workflows...');
    
    let dailyStandUpResult;
    try {
      console.log('🔄 About to call executeDailyStandUpWorkflowsActivity...');
      console.log('   Activity executes dailyStandUpWorkflow for all sites');
      console.log('   Simple execution without duplicate logic');
      
      // Execute the simplified activity that just runs workflows for all sites
      dailyStandUpResult = await executeDailyStandUp({
        dryRun: false,  // PRODUCTION: Actually execute workflows
        testMode: false, // PRODUCTION: Full production mode
      });
      
      console.log('🎯 executeDailyStandUpWorkflowsActivity completed successfully');
      console.log(`✅ Daily stand ups executed: ${dailyStandUpResult.scheduled} sites`);
      console.log(`   Failed: ${dailyStandUpResult.failed}, Skipped: ${dailyStandUpResult.skipped}`);
      
      if (dailyStandUpResult.testInfo) {
        console.log(`   Mode: ${dailyStandUpResult.testInfo.mode}`);
        console.log(`   Duration: ${dailyStandUpResult.testInfo.duration}`);
      }
    } catch (dailyStandUpError) {
      console.error('❌ Error in executeDailyStandUpWorkflowsActivity:', dailyStandUpError);
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

    console.log('🎉 Daily operations workflow completed successfully');
    console.log(`   Total execution time: ${executionTime}`);
    console.log('   Strategy: Operational execution under prioritization control');
    
    return {
      contextRetrieved: true,
      planDesigned: true,
      planSent: true,
      priorityMailsSent: priorityMailResult.count,
      activitiesScheduled: scheduleResult.apiCalls,
      dailyStandUpsExecuted: dailyStandUpResult.scheduled,
      executionTime
    };

  } catch (error) {
    console.error('❌ Daily operations workflow failed:', error);
    throw error;
  }
} 