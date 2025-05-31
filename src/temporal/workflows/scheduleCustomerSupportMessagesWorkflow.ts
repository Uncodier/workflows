import { proxyActivities, sleep, startChild } from '@temporalio/workflow';
import type { Activities } from '../activities';
import type { EmailData, ScheduleCustomerSupportParams } from '../activities/customerSupportActivities';

// Configure activity options
const { 
  sendCustomerSupportMessageActivity,
  processAnalysisDataActivity 
} = proxyActivities<Activities>({
  startToCloseTimeout: '2 minutes',
  retry: {
    maximumAttempts: 3,
  },
});

/**
 * Single Customer Support Message Workflow
 * Processes one email and sends a customer support message
 */
export async function customerSupportMessageWorkflow(
  emailData: EmailData,
  baseParams: {
    site_id: string;
    user_id: string;
    agentId?: string;
  }
): Promise<{
  success: boolean;
  processed: boolean;
  reason: string;
  response?: any;
  error?: string;
}> {
  console.log('🎯 Starting single customer support message workflow...');
  console.log(`📋 Processing email ID: ${emailData.analysis_id || 'no-id'}`);
  
  try {
    // First, process the email to determine if action is needed
    const processResult = await processAnalysisDataActivity(emailData);
    
    if (!processResult.shouldProcess) {
      console.log('⏭️ Skipping email - not requiring immediate action');
      return {
        success: true,
        processed: false,
        reason: processResult.reason
      };
    }
    
    console.log('📞 Processing email - sending customer support message');
    
    // Send the customer support message using data from emailData and baseParams
    const response = await sendCustomerSupportMessageActivity(emailData, baseParams);
    
    console.log('✅ Customer support message workflow completed successfully');
    return {
      success: true,
      processed: true,
      reason: processResult.reason,
      response
    };
    
  } catch (error) {
    console.error('❌ Customer support message workflow failed:', error);
    return {
      success: false,
      processed: false,
      reason: 'Workflow execution failed',
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Schedule Customer Support Messages Workflow
 * Takes an array of email data and schedules customer support messages
 * with 1-minute intervals between each message
 */
export async function scheduleCustomerSupportMessagesWorkflow(
  params: ScheduleCustomerSupportParams
): Promise<{
  totalEmails: number;
  scheduled: number;
  skipped: number;
  completed: number;
  failed: number;
  results: Array<{
    index: number;
    workflowId: string;
    success: boolean;
    processed: boolean;
    reason: string;
    error?: string;
    emailId: string;
  }>;
  executionTime: string;
}> {
  console.log('🚀 Starting schedule customer support messages workflow...');
  const startTime = new Date();
  
  const { emails, site_id, user_id, agentId } = params;
  const totalEmails = emails.length;
  
  console.log(`📊 Processing ${totalEmails} emails for customer support...`);
  console.log(`🏢 Site: ${site_id}, User: ${user_id}`);
  
  const baseParams = {
    site_id,
    user_id,
    agentId
  };
  
  const results: Array<{
    index: number;
    workflowId: string;
    success: boolean;
    processed: boolean;
    reason: string;
    error?: string;
    emailId: string;
  }> = [];
  
  let scheduled = 0;
  let skipped = 0;
  let completed = 0;
  let failed = 0;
  
  try {
    // Process each email with 1-minute intervals
    for (let i = 0; i < emails.length; i++) {
      const emailData = emails[i];
      const emailId = emailData.analysis_id || `email_${Date.now()}_${i}`;
      const workflowId = `customer-support-message-${emailId}`;
      
      console.log(`📋 Processing email ${i + 1}/${totalEmails} (ID: ${workflowId})`);
      
      try {
        // Start child workflow for this specific email
        const handle = await startChild(customerSupportMessageWorkflow, {
          workflowId,
          args: [emailData, baseParams],
        });
        
        scheduled++;
        console.log(`✅ Scheduled customer support message workflow: ${workflowId}`);
        
        // Wait for the child workflow to complete
        const result = await handle.result();
        
        if (result.success) {
          if (result.processed) {
            completed++;
            console.log(`✅ Completed processing email ${i + 1}: ${result.reason}`);
          } else {
            skipped++;
            console.log(`⏭️ Skipped email ${i + 1}: ${result.reason}`);
          }
        } else {
          failed++;
          console.error(`❌ Failed email ${i + 1}: ${result.error}`);
        }
        
        results.push({
          index: i,
          workflowId,
          success: result.success,
          processed: result.processed,
          reason: result.reason,
          error: result.error,
          emailId: emailId
        });
        
        // Sleep for 1 minute before processing the next email (except for the last one)
        if (i < emails.length - 1) {
          console.log('⏰ Waiting 1 minute before processing next email...');
          await sleep('1m');
        }
        
      } catch (error) {
        failed++;
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Failed to start workflow for email ${i + 1}:`, errorMessage);
        
        results.push({
          index: i,
          workflowId,
          success: false,
          processed: false,
          reason: 'Failed to start workflow',
          error: errorMessage,
          emailId: emailId
        });
      }
    }
    
    const endTime = new Date();
    const executionTime = `${endTime.getTime() - startTime.getTime()}ms`;
    
    console.log('🎉 Schedule customer support messages workflow completed');
    console.log(`📊 Summary: ${completed} completed, ${skipped} skipped, ${failed} failed`);
    
    return {
      totalEmails,
      scheduled,
      skipped,
      completed,
      failed,
      results,
      executionTime
    };
    
  } catch (error) {
    console.error('❌ Schedule customer support messages workflow failed:', error);
    throw error;
  }
} 