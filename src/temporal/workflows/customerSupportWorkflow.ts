import { proxyActivities, startChild, ParentClosePolicy, upsertSearchAttributes } from '@temporalio/workflow';
import type { Activities } from '../activities';
import type { EmailData } from '../activities/customerSupportActivities';
import { emailCustomerSupportMessageWorkflow } from './emailCustomerSupportWorkflow';
import { sendWhatsappFromAgent } from './sendWhatsappFromAgentWorkflow';
import { channelCustomerSupportMessageWorkflow } from './channelCustomerSupportWorkflow';
import { agentSupervisorWorkflow } from './agentSupervisorWorkflow';
import type { WhatsAppMessageData } from '../activities/whatsappActivities';
import { ACTIVITY_TIMEOUTS, RETRY_POLICIES } from '../config/timeouts';
import { TASK_QUEUES } from '../config/taskQueues';
import { buildWhatsAppSendParams } from './helpers/buildWhatsAppSendParams';

/**
 * Helper function to map WhatsApp intents to EmailData intents
 * Currently not used but kept for future WhatsApp integration
 */
// function mapWhatsAppIntentToEmailIntent(
//   whatsappIntent?: 'inquiry' | 'complaint' | 'purchase' | 'support' | 'greeting' | 'follow_up' | 'unknown'
// ): 'inquiry' | 'complaint' | 'purchase' | 'support' | 'partnership' | 'demo_request' | undefined {
//   switch (whatsappIntent) {
//     case 'inquiry':
//       return 'inquiry';
//     case 'complaint':
//       return 'complaint';
//     case 'purchase':
//       return 'purchase';
//     case 'support':
//       return 'support';
//     case 'greeting':
//     case 'follow_up':
//       return 'inquiry'; // Map greeting and follow_up to inquiry
//     case 'unknown':
//     default:
//       return 'inquiry'; // Default to inquiry for unknown or undefined
//   }
// }

// Configure activity options using centralized timeouts
const { 
  sendCustomerSupportMessageActivity,
  startLeadAttentionWorkflowActivity,
  updateTaskStatusToCompletedActivity,
  saveCronStatusActivity,
  logWorkflowExecutionActivity,
  notifyTeamOnInboundActivity,
  getSiteIdFromCommandOrConversationActivity,
  validateWorkflowConfigActivity
} = proxyActivities<Activities>({
  startToCloseTimeout: ACTIVITY_TIMEOUTS.CUSTOMER_SUPPORT, // ✅ Using centralized config (5 minutes)
  retry: RETRY_POLICIES.CUSTOMER_SUPPORT, // ✅ Using appropriate retry policy for customer support
});

// Note: sendWhatsAppResponseActivity available if needed in the future
// const { sendWhatsAppResponseActivity } = proxyActivities<Activities>({...});

/**
 * Customer Support Message Workflow
 * Detecta el origen (email vs whatsapp) y delega al workflow específico
 * Este es el workflow principal que debe ser llamado desde el API
 */
export async function customerSupportMessageWorkflow(
  messageData: EmailData | { whatsappData: WhatsAppMessageData } | any,
  baseParams?: {
    agentId?: string;
    origin?: string;
    origin_message_id?: string;
  }
): Promise<{
  success: boolean;
  data?: any;
  error?: string;
}> {
  console.log('🎯 Starting customer support message workflow...');
  
  // ✅ NEW: Support for parameters in root of request
  // If baseParams is undefined or missing values, look for them in messageData
  let origin = baseParams?.origin;
  let agentId = baseParams?.agentId;
  let originMessageId = baseParams?.origin_message_id;
  
  // If not found in baseParams, check messageData root level
  if (!origin && messageData && typeof messageData === 'object' && 'origin' in messageData) {
    origin = (messageData as any).origin;
    console.log(`🔍 Found origin in messageData root: ${origin}`);
  }
  
  if (!agentId && messageData && typeof messageData === 'object' && 'agentId' in messageData) {
    agentId = (messageData as any).agentId;
    console.log(`🔍 Found agentId in messageData root: ${agentId}`);
  }
  
  if (!originMessageId && messageData && typeof messageData === 'object' && 'origin_message_id' in messageData) {
    originMessageId = (messageData as any).origin_message_id;
    console.log(`🔍 Found origin_message_id in messageData root: ${originMessageId}`);
  }
  
  // Create effective baseParams for internal use
  const effectiveBaseParams = {
    origin: origin || 'not specified',
    agentId: agentId,
    origin_message_id: originMessageId
  };
  
  console.log(`🔄 Origin: ${effectiveBaseParams.origin}`);
  console.log(`🤖 Agent ID: ${effectiveBaseParams.agentId || 'not specified'}`);
  console.log(`📨 Origin Message ID: ${effectiveBaseParams.origin_message_id || 'not specified'}`);
  
  // Get workflow ID for status tracking
  const workflowId = (messageData as any)?.workflowId || `customer-support-${Date.now()}`;
  const siteId = (messageData as any)?.site_id || (messageData as any)?.siteId;

  if (siteId) {
    const searchAttributes: Record<string, string[]> = {
      site_id: [siteId],
    };
    if (effectiveBaseParams.agentId) {
      searchAttributes.user_id = [effectiveBaseParams.agentId];
    }
    // Try to find lead_id in messageData or any
    const leadId = (messageData as any)?.lead_id || (messageData as any)?.leadId;
    if (leadId) {
      searchAttributes.lead_id = [leadId];
    }
    upsertSearchAttributes(searchAttributes);
  }
  
  try {
    // ✅ NEW: If messageData has website_chat origin, process as-is without transformation
    if (effectiveBaseParams.origin === 'website_chat' && 'message' in messageData) {
      console.log('💬 Detected website chat message - processing original data without transformation');
      
      console.log('📞 Processing website chat message - sending customer support message');
      
      // Send customer support message with original data (no transformation to EmailData)
      const response = await sendCustomerSupportMessageActivity(messageData, effectiveBaseParams);
      
      if (!response || !response.success) {
        console.error('❌ Website chat customer support message failed:', response?.error || 'Unknown error');
        throw new Error(response?.error || 'Customer support call was not successful');
      }
      
      console.log('✅ Website chat customer support message sent successfully');
      console.log(`📋 Customer support response:`, JSON.stringify(response.data, null, 2));
      
      // ✅ FIXED: For website_chat, DON'T automatically send follow-up emails
      // Website chat interactions should only use the chat medium unless explicitly requested
      console.log('💬 Website chat completed - no email follow-up needed (chat is the primary communication channel)');
      
              // 🔔 Start independent leadAttentionWorkflow if we have a lead_id
        let leadAttentionWorkflowId: string | undefined;
        
        try {
          // Use lead_id from customer support response, not from input data
          const leadId = response.data?.lead_id || messageData.lead_id || messageData.analysis_id;
          
          if (leadId) {
            console.log('🔔 Starting independent leadAttentionWorkflow...');
            console.log(`📋 Lead ID: ${leadId} - will check for assignee_id before sending notification`);
            console.log(`🎯 Lead source: ${response.data?.lead_id ? 'customer support response' : 'input data'}`);
            
            // Extract message content from customer support response
            const userMessage = response.data?.messages?.user?.content || 
                               messageData.message || 
                               'Website chat inquiry';
            
            const systemMessage = response.data?.messages?.assistant?.content || 
                                 response.data?.message || 
                                 'Website chat customer support notification';
            
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
            console.log('🔍 Checked: response.data.lead_id, messageData.lead_id and messageData.analysis_id');
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
          let siteIdForValidation = response.data?.site_id || messageData.site_id || siteId;
          
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
        const leadId = response.data?.lead_id;
        const conversationId = response.data?.conversation_id;
        const userMessage = response.data?.messages?.user?.content || 
                           messageData.message || 
                           'Website chat inquiry';
        const notifySiteId = response.data?.site_id || messageData.site_id || siteId;

        if (leadId && conversationId && notifySiteId) {
          console.log('🔔 Calling notify team on inbound activity...');
          
          const notifyResult = await notifyTeamOnInboundActivity({
            lead_id: leadId,
            conversation_id: conversationId,
            message: userMessage,
            site_id: notifySiteId
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
      
      console.log('✅ Website chat customer support message workflow completed successfully');
      return {
        success: true,
        data: {
          ...response.data, // ✅ Extract data directly to root level
          processed: true,
          reason: 'Website chat message processed for customer support',
          emailSent: false, // Website chat doesn't send follow-up emails
          emailWorkflowId: undefined,
          leadAttentionWorkflowId
        }
      };
    }
    
    // Detectar si es WhatsApp o Email basado en el origen o estructura de datos
    if (effectiveBaseParams.origin === 'whatsapp' && 'whatsappData' in messageData) {
      console.log('📱 Detected WhatsApp message - processing directly');
      
      const whatsappData = messageData.whatsappData;
      
      // Prepare EmailData compatible payload without UX-altering prefixes
      const emailDataForCS: EmailData = {
        summary: whatsappData.messageContent || 'No message content',
        original_text: whatsappData.messageContent,
        original_subject: whatsappData.senderName || whatsappData.phoneNumber,
        contact_info: {
          name: whatsappData.senderName || 'WhatsApp Contact',
          email: '', // WhatsApp no tiene email
          phone: whatsappData.phoneNumber,
          company: ''
        },
        site_id: whatsappData.siteId,
        user_id: whatsappData.userId,
        lead_notification: "none", // Evitar duplicar notificaciones
        analysis_id: `whatsapp-${whatsappData.messageId || Date.now()}`,
        priority: 'medium', // Default priority for WhatsApp
        intent: 'inquiry', // Default intent for WhatsApp  
        potential_value: 'medium', // Default value for WhatsApp
        // Agregar campos específicos de WhatsApp
        conversation_id: whatsappData.conversationId, // Pasar conversation ID a la activity
        visitor_id: undefined // WhatsApp normalmente no tiene visitor_id, se maneja por phone
      };
      
      // ✅ FIXED: Para WhatsApp siempre procesar - eliminar filtro innecesario
      console.log('📞 Processing WhatsApp message - sending customer support message directly');
      
      // Enviar mensaje de customer support
      const response = await sendCustomerSupportMessageActivity(emailDataForCS, effectiveBaseParams);
      
      if (!response || !response.success) {
        console.error('❌ WhatsApp customer support message failed:', response?.error || 'Unknown error');
        throw new Error(response?.error || 'Customer support call was not successful');
      }
      
      console.log('✅ WhatsApp customer support message sent successfully');
      console.log(`📋 Customer support response:`, JSON.stringify(response.data, null, 2));
      
      // 🌟 NEW: Call sendWhatsappFromAgent workflow ONLY if customer support was successful
      let whatsappWorkflowId: string | undefined;
      let whatsappSent = false;
      
      try {
        const whatsappParams = buildWhatsAppSendParams({
          csResponse: response.data,
          whatsappData,
          agentId: effectiveBaseParams.agentId,
        });

        if (!whatsappParams) {
          console.log('⚠️ Skipping WhatsApp send - no assistant message content from customer support');
        } else {
          console.log('📱 Starting sendWhatsappFromAgent workflow - customer support was successful...');
          console.log('📋 WhatsApp send params:', {
            message_id: whatsappParams.message_id || 'not-provided',
            conversation_id: whatsappParams.conversation_id || 'not-provided',
            lead_id: whatsappParams.lead_id || 'not-provided',
            messageLength: whatsappParams.message.length,
          });

          whatsappWorkflowId = `send-whatsapp-agent-${whatsappData.messageId || Date.now()}`;

          const whatsappHandle = await startChild(sendWhatsappFromAgent, {
            workflowId: whatsappWorkflowId,
            args: [whatsappParams],
            parentClosePolicy: ParentClosePolicy.PARENT_CLOSE_POLICY_ABANDON,
          });

          console.log(`📨 Started sendWhatsappFromAgent workflow: ${whatsappWorkflowId}`);
          console.log(`🚀 Parent close policy: ABANDON - WhatsApp workflow will continue independently`);

          const whatsappResult = await whatsappHandle.result();

          if (whatsappResult.success) {
            whatsappSent = true;
            console.log('✅ Follow-up WhatsApp sent successfully');
            console.log(`📨 Message ID: ${whatsappResult.messageId}`);
          } else {
            console.log('⚠️ Follow-up WhatsApp failed, but customer support was successful');
          }
        }
      } catch (whatsappError) {
        console.error('❌ WhatsApp workflow failed, but customer support was successful:', whatsappError);
        // Don't fail the entire workflow if WhatsApp fails
      }

      // Mark first_contact task as completed after successful WhatsApp delivery
      if (whatsappSent) {
        console.log(`📝 Marking first_contact task as completed after successful WhatsApp delivery...`);
        
        try {
          // Use lead_id from customer support response or fallback to analysis_id
          const leadId = response.data?.lead_id || emailDataForCS.analysis_id;
          
          if (leadId) {
            const taskUpdateResult = await updateTaskStatusToCompletedActivity({
              lead_id: leadId,
              site_id: emailDataForCS.site_id,
              stage: 'awareness', // First contact tasks are typically in awareness stage
              status: 'completed',
              notes: `Task completed after successful WhatsApp delivery via customerSupportMessageWorkflow`
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
        console.log(`⚠️ Skipping first_contact task completion - no successful WhatsApp delivery`);
      }
      
              // 🔔 Start independent leadAttentionWorkflow if we have a lead_id
        let leadAttentionWorkflowId: string | undefined;
        
        try {
          // Use lead_id from customer support response, not from input data
          const leadId = response.data?.lead_id || emailDataForCS.analysis_id;
          
          if (leadId) {
            console.log('🔔 Starting independent leadAttentionWorkflow...');
            console.log(`📋 Lead ID: ${leadId} - will check for assignee_id before sending notification`);
            console.log(`🎯 Lead source: ${response.data?.lead_id ? 'customer support response' : 'input data'}`);
            
            // Extract message content from customer support response
            const userMessage = response.data?.messages?.user?.content || 
                               whatsappData.messageContent || 
                               'WhatsApp inquiry';
            
            const systemMessage = response.data?.messages?.assistant?.content || 
                                 response.data?.message || 
                                 'WhatsApp customer support notification';
            
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
            console.log('🔍 Checked: response.data.lead_id and emailDataForCS.analysis_id');
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
          let siteIdForValidation = response.data?.site_id || emailDataForCS.site_id;
          
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
        const leadId = response.data?.lead_id || emailDataForCS.analysis_id;
        const conversationId = response.data?.conversation_id;
        const userMessage = response.data?.messages?.user?.content || 
                           whatsappData.messageContent || 
                           'WhatsApp inquiry';
        const siteId = response.data?.site_id || emailDataForCS.site_id;

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
      
      console.log('✅ WhatsApp customer support message workflow completed successfully');
      return {
        success: true,
        data: {
          ...response.data, // ✅ Extract data directly to root level
          processed: true,
          reason: 'WhatsApp message processed for customer support',
          whatsappSent,
          whatsappWorkflowId,
          leadAttentionWorkflowId
        }
      };
      
    } else if (
      effectiveBaseParams.origin === 'telegram' ||
      effectiveBaseParams.origin === 'messenger' ||
      (messageData?.channel_delivery === true &&
        (effectiveBaseParams.origin === 'whatsapp' || effectiveBaseParams.origin === 'email'))
    ) {
      return await channelCustomerSupportMessageWorkflow(messageData, effectiveBaseParams);
    } else {
      console.log('📧 Detected email message - delegating to email workflow');
      
      // Usar el workflow específico para emails
      return await emailCustomerSupportMessageWorkflow(messageData as EmailData, effectiveBaseParams);
    }
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Customer support workflow failed:', errorMessage);
    
    // Update cron status to FAILED if we have a siteId
    if (siteId) {
      try {
        await saveCronStatusActivity({
          siteId,
          workflowId,
          scheduleId: `customer-support-${siteId}`,
          activityName: 'customerSupportMessageWorkflow',
          status: 'FAILED',
          lastRun: new Date().toISOString(),
          errorMessage: errorMessage,
          retryCount: 1
        });
        console.log('✅ Updated cron status to FAILED');
      } catch (statusError) {
        console.error(`❌ Failed to update cron status to FAILED: ${statusError}`);
        // Continue even if status update fails
      }
    }
    
    // Log workflow execution failure
    try {
      await logWorkflowExecutionActivity({
        workflowId,
        workflowType: 'customerSupportMessageWorkflow',
        status: 'FAILED',
        input: messageData,
        error: errorMessage,
      });
      console.log('✅ Logged workflow execution as FAILED');
    } catch (logError) {
      console.error(`❌ Failed to log workflow execution failure: ${logError}`);
      // Continue even if logging fails
    }
    
    // Throw error to properly fail the workflow
    throw new Error(`Customer support workflow failed: ${errorMessage}`);
  }
} 