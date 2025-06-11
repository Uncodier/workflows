import { proxyActivities } from '@temporalio/workflow';
import type { Activities } from '../activities';

// Define the activity interface and options
const { 
  logWorkflowExecutionActivity,
  saveCronStatusActivity,
  getSiteActivity,
  leadFollowUpActivity,
} = proxyActivities<Activities>({
  startToCloseTimeout: '5 minutes', // Reasonable timeout for lead follow-up
  retry: {
    maximumAttempts: 3,
  },
});

export interface LeadFollowUpOptions {
  lead_id: string;                    // Required: Lead ID
  site_id: string;                    // Required: Site ID
  userId?: string;
  additionalData?: any;
}

export interface LeadFollowUpResult {
  success: boolean;
  leadId: string;
  siteId: string;
  siteName?: string;
  siteUrl?: string;
  followUpActions?: any[];
  nextSteps?: string[];
  data?: any;
  errors: string[];
  executionTime: string;
  completedAt: string;
}

/**
 * Workflow to execute lead follow-up
 * 
 * This workflow:
 * 1. Gets site information by siteId to obtain site details
 * 2. Executes lead follow-up using the sales agent API
 * 
 * @param options - Configuration options for lead follow-up
 */
export async function leadFollowUpWorkflow(
  options: LeadFollowUpOptions
): Promise<LeadFollowUpResult> {
  const { lead_id, site_id } = options;
  
  if (!lead_id) {
    throw new Error('No lead ID provided');
  }
  
  if (!site_id) {
    throw new Error('No site ID provided');
  }
  
  const workflowId = `lead-follow-up-${lead_id}-${site_id}`;
  const startTime = Date.now();
  
  console.log(`📞 Starting lead follow-up workflow for lead ${lead_id} on site ${site_id}`);
  console.log(`📋 Options:`, JSON.stringify(options, null, 2));

  // Log workflow execution start
  await logWorkflowExecutionActivity({
    workflowId,
    workflowType: 'leadFollowUpWorkflow',
    status: 'STARTED',
    input: options,
  });

  // Update cron status to indicate the workflow is running
  await saveCronStatusActivity({
    siteId: site_id,
    workflowId,
    scheduleId: `lead-follow-up-${lead_id}-${site_id}`,
    activityName: 'leadFollowUpWorkflow',
    status: 'RUNNING',
    lastRun: new Date().toISOString()
  });

  const errors: string[] = [];
  let followUpActions: any[] = [];
  let nextSteps: string[] = [];
  let siteName = '';
  let siteUrl = '';
  let data: any = null;

  try {
    console.log(`🏢 Step 1: Getting site information for ${site_id}...`);
    
    // Get site information to obtain site details
    const siteResult = await getSiteActivity(site_id);
    
    if (!siteResult.success) {
      const errorMsg = `Failed to get site information: ${siteResult.error}`;
      console.error(`❌ ${errorMsg}`);
      errors.push(errorMsg);
      throw new Error(errorMsg);
    }
    
    const site = siteResult.site!;
    siteName = site.name;
    siteUrl = site.url;
    
    console.log(`✅ Retrieved site information: ${siteName} (${siteUrl})`);

    console.log(`📞 Step 2: Executing lead follow-up for lead ${lead_id}...`);
    
    // Prepare lead follow-up request
    const followUpRequest = {
      lead_id: lead_id,
      site_id: site_id,
      userId: options.userId || site.user_id,
      additionalData: options.additionalData
    };
    
    console.log(`🔧 Lead follow-up configuration:`);
    console.log(`   - Lead ID: ${followUpRequest.lead_id}`);
    console.log(`   - Site ID: ${followUpRequest.site_id}`);
    console.log(`   - User ID: ${followUpRequest.userId}`);
    
    // Execute lead follow-up
    const followUpResult = await leadFollowUpActivity(followUpRequest);
    
    if (!followUpResult.success) {
      const errorMsg = `Failed to execute lead follow-up: ${followUpResult.error}`;
      console.error(`❌ ${errorMsg}`);
      errors.push(errorMsg);
      throw new Error(errorMsg);
    }
    
    followUpActions = followUpResult.followUpActions || [];
    nextSteps = followUpResult.nextSteps || [];
    data = followUpResult.data;
    
    console.log(`✅ Successfully executed lead follow-up for lead ${lead_id}`);
    console.log(`📊 Results: ${followUpActions.length} follow-up actions, ${nextSteps.length} next steps`);
    
    if (followUpActions.length > 0) {
      console.log(`📋 Follow-up actions:`);
      followUpActions.forEach((action, index) => {
        console.log(`   ${index + 1}. ${action.title || action.name || action.type || `Action ${index + 1}`}`);
      });
    }
    
    if (nextSteps.length > 0) {
      console.log(`🎯 Next steps:`);
      nextSteps.forEach((step, index) => {
        console.log(`   ${index + 1}. ${step}`);
      });
    }

    const executionTime = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;
    const result: LeadFollowUpResult = {
      success: true,
      leadId: lead_id,
      siteId: site_id,
      siteName,
      siteUrl,
      followUpActions,
      nextSteps,
      data,
      errors,
      executionTime,
      completedAt: new Date().toISOString()
    };

    console.log(`🎉 Lead follow-up workflow completed successfully!`);
    console.log(`📊 Summary: Lead ${lead_id} follow-up completed for ${siteName} in ${executionTime}`);

    // Update cron status to indicate successful completion
    await saveCronStatusActivity({
      siteId: site_id,
      workflowId,
      scheduleId: `lead-follow-up-${lead_id}-${site_id}`,
      activityName: 'leadFollowUpWorkflow',
      status: 'COMPLETED',
      lastRun: new Date().toISOString()
    });

    // Log successful completion
    await logWorkflowExecutionActivity({
      workflowId,
      workflowType: 'leadFollowUpWorkflow',
      status: 'COMPLETED',
      input: options,
      output: result,
    });

    return result;

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Lead follow-up workflow failed: ${errorMessage}`);
    
    const executionTime = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;
    
    // Update cron status to indicate failure
    await saveCronStatusActivity({
      siteId: site_id,
      workflowId,
      scheduleId: `lead-follow-up-${lead_id}-${site_id}`,
      activityName: 'leadFollowUpWorkflow',
      status: 'FAILED',
      lastRun: new Date().toISOString(),
      errorMessage: errorMessage,
      retryCount: 1
    });

    // Log workflow execution failure
    await logWorkflowExecutionActivity({
      workflowId,
      workflowType: 'leadFollowUpWorkflow',
      status: 'FAILED',
      input: options,
      error: errorMessage,
    });

    // Return failed result instead of throwing to provide more information
    const result: LeadFollowUpResult = {
      success: false,
      leadId: lead_id,
      siteId: site_id,
      siteName,
      siteUrl,
      followUpActions,
      nextSteps,
      data,
      errors: [...errors, errorMessage],
      executionTime,
      completedAt: new Date().toISOString()
    };

    return result;
  }
} 