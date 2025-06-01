import { proxyActivities, sleep, startChild } from '@temporalio/workflow';
import type { Activities } from '../activities';
import type { EmailData, ScheduleCustomerSupportParams } from '../activities/customerSupportActivities';
import { sendEmailFromAgent } from './sendEmailFromAgentWorkflow';

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
 * If successful, triggers sendEmailFromAgent for better traceability
 */
export async function customerSupportMessageWorkflow(
  emailData: EmailData,
  baseParams: {
    agentId?: string;
  }
): Promise<{
  success: boolean;
  processed: boolean;
  reason: string;
  response?: any;
  emailSent?: boolean;
  emailWorkflowId?: string;
  error?: string;
}> {
  console.log('🎯 Starting single customer support message workflow...');
  console.log(`📋 Processing email ID: ${emailData.analysis_id}`);
  console.log(`🏢 Site: ${emailData.site_id}, User: ${emailData.user_id}`);
  
  try {
    // First, process the email to determine if action is needed
    const processResult = await processAnalysisDataActivity(emailData);
    
    if (!processResult.shouldProcess) {
      console.log('⏭️ Skipping email - not requiring immediate action');
      return {
        success: true,
        processed: false,
        reason: processResult.reason,
        emailSent: false
      };
    }
    
    console.log('📞 Processing email - sending customer support message');
    
    // Send the customer support message using data from emailData
    const response = await sendCustomerSupportMessageActivity(emailData, baseParams);
    
    // ✅ Verificar que la llamada a customer support fue exitosa antes de continuar
    if (!response || !response.success) {
      console.error('❌ Customer support message failed:', response?.error || 'Unknown error');
      return {
        success: false,
        processed: true,
        reason: 'Customer support message failed',
        error: response?.error || 'Customer support call was not successful',
        emailSent: false
      };
    }
    
    console.log('✅ Customer support message sent successfully');
    console.log(`📋 Customer support response:`, JSON.stringify(response, null, 2));
    
    // 🌟 NEW: Call sendEmailFromAgent workflow ONLY if customer support was successful
    let emailWorkflowId: string | undefined;
    let emailSent = false;
    
    try {
      // Check if we have contact email and original lead_notification indicates email should be sent
      if (emailData.email.contact_info.email && emailData.lead_notification === 'email') {
        console.log('📧 Starting sendEmailFromAgent workflow - customer support was successful...');
        console.log(`🔄 Original lead_notification: ${emailData.lead_notification} - proceeding with follow-up email`);
        
        emailWorkflowId = `send-email-agent-${emailData.analysis_id}`;
        
        // Prepare email parameters
        const emailParams = {
          email: emailData.email.contact_info.email,
          from: `support@${emailData.site_id}.com`, // Dynamic from based on site
          subject: `Re: ${emailData.email.original_subject || 'Your inquiry'}`,
          message: `Thank you for your message. We have received your inquiry and our customer support team has been notified. We will get back to you shortly.`,
          site_id: emailData.site_id,
          agent_id: baseParams.agentId,
          lead_id: emailData.analysis_id
        };
        
        // Start sendEmailFromAgent as child workflow
        const emailHandle = await startChild(sendEmailFromAgent, {
          workflowId: emailWorkflowId,
          args: [emailParams],
        });
        
        console.log(`📨 Started sendEmailFromAgent workflow: ${emailWorkflowId}`);
        
        // Wait for email workflow to complete
        const emailResult = await emailHandle.result();
        
        if (emailResult.success) {
          emailSent = true;
          console.log('✅ Follow-up email sent successfully');
        } else {
          console.log('⚠️ Follow-up email failed, but customer support was successful');
        }
        
      } else if (!emailData.email.contact_info.email) {
        console.log('📭 No email address available for follow-up');
      } else if (emailData.lead_notification !== 'email') {
        console.log(`📋 lead_notification = "${emailData.lead_notification}" - skipping follow-up email`);
      }
      
    } catch (emailError) {
      console.error('❌ Email workflow failed, but customer support was successful:', emailError);
      // Don't fail the entire workflow if email fails
    }
    
    console.log('✅ Customer support message workflow completed successfully');
    return {
      success: true,
      processed: true,
      reason: processResult.reason,
      response,
      emailSent,
      emailWorkflowId
    };
    
  } catch (error) {
    console.error('❌ Customer support message workflow failed:', error);
    return {
      success: false,
      processed: false,
      reason: 'Workflow execution failed',
      error: error instanceof Error ? error.message : String(error),
      emailSent: false
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
  emailsSent: number; // Nueva métrica para trazabilidad
  results: Array<{
    index: number;
    workflowId: string;
    success: boolean;
    processed: boolean;
    reason: string;
    error?: string;
    emailId: string;
    emailSent?: boolean;
    emailWorkflowId?: string;
  }>;
  executionTime: string;
}> {
  console.log('🚀 Starting schedule customer support messages workflow...');
  const startTime = new Date();
  
  const { emails, site_id, user_id, agentId, timestamp } = params;
  const totalEmails = emails.length;
  
  console.log(`📊 Processing ${totalEmails} emails for customer support...`);
  console.log(`🏢 Global Site: ${site_id}, User: ${user_id}`);
  console.log(`⏰ Timestamp: ${timestamp}`);
  
  const baseParams = {
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
    emailSent?: boolean;
    emailWorkflowId?: string;
  }> = [];
  
  let scheduled = 0;
  let skipped = 0;
  let completed = 0;
  let failed = 0;
  let emailsSent = 0; // Nueva métrica para trazabilidad
  
  try {
    // Process each email with 1-minute intervals
    for (let i = 0; i < emails.length; i++) {
      const emailData = emails[i];
      const emailId = emailData.analysis_id;
      const workflowId = `customer-support-message-${emailId}`;
      
      console.log(`📋 Processing email ${i + 1}/${totalEmails} (ID: ${workflowId})`);
      console.log(`📧 Subject: ${emailData.email.original_subject || 'No subject'}`);
      console.log(`👤 Contact: ${emailData.email.contact_info.name || 'Unknown'} (${emailData.email.contact_info.email || 'No email'})`);
      
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
            
            // Count emails sent for traceability
            if (result.emailSent) {
              emailsSent++;
              console.log(`📧 Follow-up email sent via workflow: ${result.emailWorkflowId}`);
            }
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
          emailId: emailId,
          emailSent: result.emailSent,
          emailWorkflowId: result.emailWorkflowId
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
          emailId: emailId,
          emailSent: false,
          emailWorkflowId: undefined
        });
      }
    }
    
    const endTime = new Date();
    const executionTime = `${endTime.getTime() - startTime.getTime()}ms`;
    
    console.log('🎉 Schedule customer support messages workflow completed');
    console.log(`📊 Summary: ${completed} completed, ${skipped} skipped, ${failed} failed`);
    console.log(`📧 Emails sent: ${emailsSent}/${completed} (follow-up emails sent via sendEmailFromAgent)`);
    console.log(`🔍 Traceability: Each email creates 2 workflows - customerSupport + sendEmailFromAgent`);
    
    return {
      totalEmails,
      scheduled,
      skipped,
      completed,
      failed,
      emailsSent,
      results,
      executionTime
    };
    
  } catch (error) {
    console.error('❌ Schedule customer support messages workflow failed:', error);
    throw error;
  }
}

/**
 * Main API Email Processing Workflow
 * Processes API email response and calls scheduleCustomerSupportMessagesWorkflow
 */
export async function processApiEmailsWorkflow(
  apiResponse: any // ApiEmailResponse but using any to avoid import issues
): Promise<{
  success: boolean;
  scheduledWorkflowId?: string;
  totalEmails: number;
  emailsSent?: number;
  error?: string;
  results?: any;
}> {
  console.log('🌟 Starting API emails processing workflow...');
  
  try {
    const { site_id, user_id, total_emails, timestamp, childWorkflow } = apiResponse;
    
    console.log(`📨 Received ${total_emails} emails from API`);
    console.log(`🏢 Site: ${site_id}, User: ${user_id}`);
    console.log(`⏰ Timestamp: ${timestamp}`);
    
    if (!childWorkflow || childWorkflow.type !== 'scheduleCustomerSupportMessagesWorkflow') {
      throw new Error('Invalid or missing childWorkflow configuration');
    }
    
    // Prepare parameters for the customer support workflow
    const scheduleParams = childWorkflow.args;
    
    // Start the customer support scheduling workflow
    const workflowId = `schedule-customer-support-${timestamp?.replace(/[:.]/g, '-') || Date.now()}`;
    
    console.log(`🚀 Starting scheduleCustomerSupportMessagesWorkflow with ID: ${workflowId}`);
    
    const handle = await startChild(scheduleCustomerSupportMessagesWorkflow, {
      workflowId,
      args: [scheduleParams],
    });
    
    console.log(`✅ Scheduled customer support messages workflow: ${workflowId}`);
    
    // Wait for the workflow to complete
    const result = await handle.result();
    
    console.log('🎉 API emails processing workflow completed successfully');
    
    return {
      success: true,
      scheduledWorkflowId: workflowId,
      totalEmails: result.totalEmails,
      emailsSent: result.emailsSent,
      results: result
    };
    
  } catch (error) {
    console.error('❌ API emails processing workflow failed:', error);
    return {
      success: false,
      totalEmails: 0,
      error: error instanceof Error ? error.message : String(error)
    };
  }
} 