import { proxyActivities, patched, deprecatePatch, upsertSearchAttributes } from '@temporalio/workflow';
import type { Activities } from '../activities';
import { performEarlyValidation } from './leadFollowUp/validation';
import { performResearch } from './leadFollowUp/research';
import type { LeadFollowUpOptions, LeadFollowUpResult } from './leadFollowUp/types';
export * from './leadFollowUp/types';

// Define the activity interface and options
const { 
  logWorkflowExecutionActivity,
  saveCronStatusActivity,
  getSiteActivity,
  getLeadActivity,
  leadFollowUpActivity,
  saveLeadFollowUpLogsActivity,
  validateContactInformation,
  validateCommunicationChannelsActivity,
  invalidateEmailOnlyActivity,
} = proxyActivities<Activities>({
  startToCloseTimeout: '5 minutes', // Reasonable timeout for lead follow-up
  retry: {
    maximumAttempts: 3,
  },
});

/**
 * Workflow to execute lead follow-up
 * 
 * This workflow:
 * 1. Gets site information by siteId to obtain site details
 * 2. Executes lead follow-up using the sales agent API
 * 3. Saves the follow-up data/logs to the database
 * 4. Completes immediately (message sending is handled by sendApprovedMessagesWorkflow)
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

  const searchAttributes: Record<string, string[]> = {
    site_id: [site_id],
    lead_id: [lead_id],
  };
  if (options.userId) {
    searchAttributes.user_id = [options.userId];
  }
  upsertSearchAttributes(searchAttributes);

  const workflowId = `lead-follow-up-${lead_id}-${site_id}`;
  const startTime = Date.now();
  
  console.log(`📞 Starting lead follow-up workflow for lead ${lead_id} on site ${site_id}`);
  console.log(`📋 Workflow version: v0.3.0 - Decoupled message sending`);
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
  let response: any = null;
  let emailInvalidatedInEarlyValidation = false;

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

    // Use versioning to handle the non-deterministic change
    const shouldGetLeadInfo = patched('add-lead-info-check-v1');
    
    // Deprecate the patch after some time to encourage cleanup
    deprecatePatch('add-lead-info-check-v1');
    
    if (shouldGetLeadInfo) {
      console.log(`👤 Step 2: Getting lead information and checking if research is needed...`);
      
      // Get lead information from database to check origin, notes, and metadata
      const leadResult = await getLeadActivity(lead_id);
      
      if (!leadResult.success) {
        const errorMsg = `Failed to get lead information: ${leadResult.error}`;
        console.error(`❌ ${errorMsg}`);
        errors.push(errorMsg);
        throw new Error(errorMsg);
      }
      
      const leadInfo = leadResult.lead!;
      
      console.log(`✅ Retrieved lead information: ${leadInfo.name || leadInfo.email}`);

      // Pass activities proxy to helper function
      const activitiesProxy = {
          validateContactInformation,
          validateCommunicationChannelsActivity,
          invalidateEmailOnlyActivity,
          saveCronStatusActivity,
          logWorkflowExecutionActivity
      };

      const validationResult = await performEarlyValidation({
        lead_id,
        site_id,
        leadInfo,
        options,
        site,
        activities: activitiesProxy,
        startTime,
        workflowId
      });

      emailInvalidatedInEarlyValidation = validationResult.emailInvalidatedInEarlyValidation;
      errors.push(...validationResult.errors);

      if (validationResult.shouldReturn && validationResult.result) {
        return validationResult.result;
      }
      
      await performResearch({
        lead_id,
        site_id,
        leadInfo,
        options,
        site,
        workflowId,
        errors
      });

    } else {
      console.log(`⚠️ Running legacy path (v0) - skipping lead info check and research due to workflow versioning`);
    }

    console.log(`📞 Step 3: Executing lead follow-up for lead ${lead_id}...`);
    
    // Prepare lead follow-up request
    const followUpRequest = {
      lead_id: lead_id,
      site_id: site_id,
      userId: options.userId || site.user_id,
      message_status: options.message_status,
      additionalData: options.additionalData
    };
    
    // Execute lead follow-up
    const followUpResult = await leadFollowUpActivity(followUpRequest);
    
    if (!followUpResult.success) {
      const errorMsg = `Failed to execute lead follow-up: ${followUpResult.error}`;
      console.error(`❌ ${errorMsg}`);
      errors.push(errorMsg);
      
      // Check if this is a NO_VALID_CHANNELS error that should fail the workflow
      let isNoValidChannelsError = false;
      try {
        const errorObj = typeof followUpResult.error === 'string' ? 
          JSON.parse(followUpResult.error) : followUpResult.error;
        
        if (errorObj && errorObj.code === 'NO_VALID_CHANNELS') {
          isNoValidChannelsError = true;
        }
      } catch (parseError) {
        if (typeof followUpResult.error === 'string' && 
            followUpResult.error.includes('NO_VALID_CHANNELS')) {
          isNoValidChannelsError = true;
        }
      }
      
      if (isNoValidChannelsError) {
        await saveCronStatusActivity({
          siteId: site_id,
          workflowId,
          scheduleId: `lead-follow-up-${lead_id}-${site_id}`,
          activityName: 'leadFollowUpWorkflow',
          status: 'FAILED',
          lastRun: new Date().toISOString(),
          errorMessage: errorMsg
        });

        await logWorkflowExecutionActivity({
          workflowId,
          workflowType: 'leadFollowUpWorkflow',
          status: 'FAILED',
          input: options,
          error: errorMsg,
        });
      }
      
      throw new Error(errorMsg);
    }
    
    followUpActions = followUpResult.followUpActions || [];
    nextSteps = followUpResult.nextSteps || [];
    response = followUpResult.data;
    
    console.log(`✅ Successfully executed lead follow-up for lead ${lead_id}`);
    
    // Step 4: Save lead follow-up logs to database (creates the message in 'pending' status)
    if (response) {
      console.log(`📝 Step 4: Saving lead follow-up logs to database...`);
      
      const saveLogsResult = await saveLeadFollowUpLogsActivity({
        siteId: site_id,
        leadId: lead_id,
        userId: options.userId || site.user_id,
        message_status: options.message_status, // This should default to 'pending' in most cases
        data: response
      });
      
      if (!saveLogsResult.success) {
        const errorMsg = `Failed to save lead follow-up logs: ${saveLogsResult.error}`;
        console.error(`⚠️ ${errorMsg}`);
        errors.push(errorMsg);
      } else {
        console.log(`✅ Lead follow-up logs saved successfully`);
        if (saveLogsResult.message_ids?.length) {
            console.log(`✅ Created pending messages: ${saveLogsResult.message_ids.join(', ')}`);
        }
      }
    }

    // Step 5: Complete Workflow (Message sending delegated to separate schedule)
    const executionTime = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;
    
    console.log(`🎉 Lead follow-up workflow completed successfully! Message created and pending approval.`);
    
    const result: LeadFollowUpResult = {
      success: true,
      leadId: lead_id,
      siteId: site_id,
      siteName,
      siteUrl,
      followUpActions,
      nextSteps,
      data: response,
      messageSent: undefined, // Message is pending, not sent yet
      errors,
      executionTime,
      completedAt: new Date().toISOString()
    };

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

    await logWorkflowExecutionActivity({
      workflowId,
      workflowType: 'leadFollowUpWorkflow',
      status: 'FAILED',
      input: options,
      error: errorMessage,
    });

    throw new Error(`Lead follow-up workflow failed: ${errorMessage}`);
  }
}
