import { proxyActivities, startChild, ParentClosePolicy, upsertSearchAttributes, isCancellation } from '@temporalio/workflow';
import type { Activities } from '../activities';
import type { EmailData } from '../activities/customerSupportActivities';
import { sendEmailFromAgent } from './sendEmailFromAgentWorkflow';
import { agentSupervisorWorkflow } from './agentSupervisorWorkflow';
import { ACTIVITY_TIMEOUTS, RETRY_POLICIES } from '../config/timeouts';
import { TASK_QUEUES } from '../config/taskQueues';
import { runChannelGuidance } from './helpers/runChannelGuidance';
import { channelGuidanceEnabled } from './helpers/channelGuidanceVersion';

// Configure activity options using centralized timeouts
const { 
  sendCustomerSupportMessageActivity,
  processAnalysisDataActivity,
  startLeadAttentionWorkflowActivity,
  updateTaskStatusToCompletedActivity,
  notifyTeamOnInboundActivity,
  getSiteIdFromCommandOrConversationActivity,
  validateWorkflowConfigActivity
} = proxyActivities<Activities>({
  startToCloseTimeout: ACTIVITY_TIMEOUTS.CUSTOMER_SUPPORT, // ✅ Using centralized config (5 minutes)
  retry: RETRY_POLICIES.CUSTOMER_SUPPORT, // ✅ Using appropriate retry policy for customer support
});

/**
 * Email Customer Support Message Workflow
 * Processes one email and sends a customer support message
 * If successful, triggers sendEmailFromAgent for better traceability
 */
export async function emailCustomerSupportMessageWorkflow(
  emailData: EmailData,
  baseParams: {
    agentId?: string;
    origin?: string; // Parámetro opcional para identificar el origen
    origin_message_id?: string;
  }
): Promise<{
  success: boolean;
  data?: any;
  error?: string;
}> {
  const useChannelGuidance = channelGuidanceEnabled();
  console.log('🎯 Starting email customer support message workflow...');
  console.log(`📋 Processing email ID: ${emailData.analysis_id}`);
  console.log(`🏢 Site: ${emailData.site_id}, User: ${emailData.user_id}`);
  console.log(`🔄 Origin: ${baseParams.origin || 'not specified'}`);

  if (emailData.site_id) {
    const searchAttributes: Record<string, string[]> = {
      site_id: [emailData.site_id],
    };
    if (emailData.user_id) {
      searchAttributes.user_id = [emailData.user_id];
    }
    if (emailData.analysis_id) {
      searchAttributes.lead_id = [emailData.analysis_id];
    }
    upsertSearchAttributes(searchAttributes);
  }
  
  try {
    // First, process the email to determine if action is needed
    const processResult = await processAnalysisDataActivity(emailData);
    
    if (!processResult.shouldProcess) {
      console.log('⏭️ Skipping email - not requiring immediate action');
      return {
        success: true,
        data: {
          processed: false,
          reason: processResult.reason,
          emailSent: false
        }
      };
    }
    
    console.log('📞 Processing email - sending customer support message');
    
    // Send the customer support message using data from emailData
    // Legacy email analysis can lack origin. Match the guidance channel to the
    // customer-support request without changing explicitly provided origins.
    const requestParams = useChannelGuidance && (!baseParams.origin || baseParams.origin === 'not specified')
      ? { ...baseParams, origin: 'email' }
      : baseParams;
    const requestData = useChannelGuidance
      ? { ...emailData, channel_guidance_run_plan_ids: await runChannelGuidance(emailData, requestParams) }
      : emailData;
    const response = await sendCustomerSupportMessageActivity(
      requestData, requestParams
    );
    
    // ✅ Verificar que la llamada a customer support fue exitosa antes de continuar
    if (!response || !response.success) {
      console.error('❌ Customer support message failed:', response?.error || 'Unknown error');
      throw new Error(response?.error || 'Customer support call was not successful');
    }
    
    console.log('✅ Customer support message sent successfully');
    console.log(`📋 Customer support response:`, JSON.stringify(response.data, null, 2));
    
    // 🌟 Call sendEmailFromAgent workflow ONLY if customer support was successful and origin is email
    let emailWorkflowId: string | undefined;
    let emailSent = false;
    
    try {
      // Simple validation: if origin is email and we have an email address, send the email
      if (baseParams.origin === 'email' && emailData.contact_info.email) {
        console.log('📧 Starting sendEmailFromAgent workflow - customer support was successful...');
        console.log(`🔄 Origin: ${baseParams.origin} - proceeding with follow-up email`);
        
        const emailWorkflowSuffix = emailData.analysis_id || `temp-${Date.now()}`;
        emailWorkflowId = `send-email-agent-${emailWorkflowSuffix}`;
        
        // Prepare email parameters with agent response
        const emailParams = {
          email: emailData.contact_info.email,
          subject: response.data?.conversation_title || `Re: ${emailData.original_subject || 'Your inquiry'}`,
          message: response.data?.messages?.assistant?.content ||
                  `Thank you for your message. We have received your inquiry and our customer support team has been notified. We will get back to you shortly.`,
          site_id: emailData.site_id,
          agent_id: baseParams.agentId,
          lead_id: emailData.analysis_id || undefined
        };
        
        // Start sendEmailFromAgent as child workflow
        const emailHandle = await startChild(sendEmailFromAgent, {
          workflowId: emailWorkflowId,
          args: [emailParams],
          parentClosePolicy: ParentClosePolicy.PARENT_CLOSE_POLICY_ABANDON,
        });
        
        console.log(`📨 Started sendEmailFromAgent workflow: ${emailWorkflowId}`);
        console.log(`🚀 Parent close policy: ABANDON - email workflow will continue independently`);
        
        // Wait for email workflow to complete
        const emailResult = await emailHandle.result();
        
        if (emailResult.success) {
          emailSent = true;
          console.log('✅ Follow-up email sent successfully');
        } else {
          console.log('⚠️ Follow-up email failed, but customer support was successful');
        }
        
      } else if (baseParams.origin !== 'email') {
        console.log(`📋 Origin: ${baseParams.origin} - skipping follow-up email`);
      } else if (!emailData.contact_info.email) {
        console.log('📭 No email address available for follow-up');
      }
      
    } catch (emailError) {
      if (useChannelGuidance && isCancellation(emailError)) throw emailError;
      console.error('❌ Email workflow failed, but customer support was successful:', emailError);
      // Don't fail the entire workflow if email fails
    }

    // Mark first_contact task as completed after successful email delivery
    if (emailSent) {
      console.log(`📝 Marking first_contact task as completed after successful email delivery...`);
      
      try {
        // Use lead_id from customer support response or fallback to analysis_id
        const leadId = response.data?.lead_id || emailData.analysis_id;
        
        if (leadId) {
          const taskUpdateResult = await updateTaskStatusToCompletedActivity({
            lead_id: leadId,
            site_id: emailData.site_id,
            stage: 'awareness', // First contact tasks are typically in awareness stage
            status: 'completed',
            notes: `Task completed after successful email delivery via emailCustomerSupportMessageWorkflow`
          });
          
          if (taskUpdateResult.success) {
            if (taskUpdateResult.updated_task_id) {
              console.log(`✅ First_contact task ${taskUpdateResult.updated_task_id} marked as completed`);
            } else {
              console.log(`✅ First_contact task completion update completed (${taskUpdateResult.task_found ? 'no task to update' : 'no task found'})`);
            }
          } else {
            console.error(`⚠️ Failed to mark first_contact task as completed: ${taskUpdateResult.error}`);
            // Note: We don't throw here as the main operation was successful
          }
        } else {
          console.log(`⚠️ No lead_id available for task completion update`);
        }
      } catch (taskError) {
        console.error('❌ Task completion update failed:', taskError);
        // Don't fail the entire workflow if task update fails
      }
    } else {
      console.log(`⚠️ Skipping first_contact task completion - no successful email delivery`);
    }
    
    // 🔔 Start independent leadAttentionWorkflow if we have a lead_id
    let leadAttentionWorkflowId: string | undefined;
    
    try {
      // Use lead_id from customer support response, not from input data
      const leadId = response.data?.lead_id || emailData.analysis_id;
      
      if (leadId) {
        console.log('🔔 Starting independent leadAttentionWorkflow...');
        console.log(`📋 Lead ID: ${leadId} - will check for assignee_id before sending notification`);
        console.log(`🎯 Lead source: ${response.data?.lead_id ? 'customer support response' : 'input data'}`);
        
        // Extract message content from customer support response
        const userMessage = response.data?.messages?.user?.content || 
                           emailData.original_text || 
                           emailData.summary || 
                           'Customer inquiry';
        
        const systemMessage = response.data?.messages?.assistant?.content || 
                             response.data?.message || 
                             'Customer support notification';
        
        // Start independent workflow (fire and forget - no blocking)
        const startResult = await startLeadAttentionWorkflowActivity({
          lead_id: leadId,
          user_message: userMessage,
          system_message: systemMessage
        });
        
        // Check if workflow started successfully (but don't block on failure)
        if (startResult.success && startResult.workflowId) {
          leadAttentionWorkflowId = startResult.workflowId;
          console.log(`✅ Independent leadAttentionWorkflow started: ${leadAttentionWorkflowId}`);
          console.log(`🚀 Workflow will run independently and check assignee_id`);
        } else {
          console.error(`⚠️ Failed to start leadAttentionWorkflow: ${startResult.error || 'Unknown error'}`);
          console.log(`📋 Lead notification will not be sent, but continuing with customer support workflow`);
        }
        
      } else {
        console.log('⚠️ No lead_id available for lead attention notification');
        console.log('🔍 Checked: response.data.lead_id and emailData.analysis_id');
      }
      
    } catch (leadAttentionError) {
      console.error('❌ Lead attention workflow failed to start (non-blocking):', leadAttentionError);
      console.log('⚠️ Continuing customer support workflow - lead notification is a secondary operation');
      // Don't throw - this is a non-critical operation that shouldn't fail the main workflow
    }
    
    // 🎯 Start agent supervisor workflow as child (fire-and-forget, high priority)
    try {
      const commandId = response.data?.command_id;
      const conversationId = response.data?.conversation_id;
      
      if (commandId || conversationId) {
        // Get site_id for validation
        let siteIdForValidation = response.data?.site_id || emailData.site_id;
        
        // If site_id is not available, try to get it from command_id or conversation_id
        if (!siteIdForValidation) {
          console.log('🔍 Site ID not in response, fetching from command/conversation...');
          const siteIdResult = await getSiteIdFromCommandOrConversationActivity({
            command_id: commandId,
            conversation_id: conversationId
          });
          
          if (siteIdResult.success && siteIdResult.site_id) {
            siteIdForValidation = siteIdResult.site_id;
            console.log(`✅ Found site_id from command/conversation: ${siteIdForValidation}`);
          }
        }
        
        // Validate that supervise_conversations activity is active before starting workflow
        if (siteIdForValidation) {
          console.log('🔐 Validating supervise_conversations activity status before starting supervisor workflow...');
          const configValidation = await validateWorkflowConfigActivity(
            siteIdForValidation,
            'supervise_conversations'
          );
          
          if (!configValidation.shouldExecute) {
            console.log(`⛔ Supervisor workflow blocked: ${configValidation.reason}`);
            console.log('⚠️ Skipping agent supervisor workflow - supervise_conversations is not active');
          } else {
            console.log(`✅ Activity validation passed: ${configValidation.reason}`);
            console.log('🎯 Starting agent supervisor workflow as child (high priority, fire-and-forget)...');
            
            await startChild(agentSupervisorWorkflow, {
              args: [{
                command_id: commandId,
                conversation_id: conversationId
              }],
              workflowId: `agent-supervisor-${commandId || conversationId}-${Date.now()}`,
              taskQueue: TASK_QUEUES.HIGH, // High priority task queue
              parentClosePolicy: ParentClosePolicy.PARENT_CLOSE_POLICY_ABANDON // Fire-and-forget
            });
            
            console.log('✅ Agent supervisor workflow started successfully (running independently)');
          }
        } else {
          console.log('⚠️ Could not determine site_id for validation - skipping supervisor workflow');
        }
      } else {
        console.log('⚠️ No command_id or conversation_id available for supervisor call');
      }
    } catch (supervisorError) {
      console.error('❌ Agent supervisor workflow start error (non-blocking):', supervisorError);
      // Don't throw - workflow continues normally
    }

    // 🔔 Notify team on inbound message (non-blocking, complementary activity)
    try {
      const leadId = response.data?.lead_id || emailData.analysis_id;
      const conversationId = response.data?.conversation_id;
      const userMessage = response.data?.messages?.user?.content || 
                         emailData.original_text || 
                         emailData.summary || 
                         'Customer inquiry';
      const siteId = response.data?.site_id || emailData.site_id;

      if (leadId && conversationId && siteId) {
        console.log('🔔 Calling notify team on inbound activity...');
        
        const notifyResult = await notifyTeamOnInboundActivity({
          lead_id: leadId,
          conversation_id: conversationId,
          message: userMessage,
          site_id: siteId
        });

        if (notifyResult.success) {
          console.log('✅ Team notification sent successfully');
        } else {
          console.log(`⚠️ Team notification skipped or failed (non-blocking): ${notifyResult.error}`);
        }
      } else {
        console.log('⚠️ Missing required parameters for team notification (lead_id, conversation_id, or site_id)');
      }
    } catch (notifyError) {
      console.error('❌ Notify team activity error (non-blocking):', notifyError);
      // Don't throw - workflow continues normally
    }
    
    console.log('✅ Email customer support message workflow completed successfully');
    return {
      success: true,
      data: {
        ...response.data, // ✅ Extract data directly to root level
        processed: true,
        reason: processResult.reason,
        emailSent,
        emailWorkflowId,
        leadAttentionWorkflowId
      }
    };
    
  } catch (error) {
    if (useChannelGuidance && isCancellation(error)) throw error;
    console.error('❌ Email customer support message workflow failed:', error);
    throw new Error(`Email customer support message workflow failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}


