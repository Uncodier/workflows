import { proxyActivities, sleep, startChild } from '@temporalio/workflow';
import type { Activities } from '../activities';
import { leadResearchWorkflow, type LeadResearchOptions, type LeadResearchResult } from './leadResearchWorkflow';

// Define the activity interface and options
const { 
  logWorkflowExecutionActivity,
  saveCronStatusActivity,
  getSiteActivity,
  getLeadActivity,
  leadFollowUpActivity,
  saveLeadFollowUpLogsActivity,
  sendEmailFromAgentActivity,
  sendWhatsAppFromAgentActivity,
  updateConversationStatusAfterFollowUpActivity,
  validateMessageAndConversationActivity,
  updateMessageStatusToSentActivity,
  updateTaskStatusToCompletedActivity,
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
  messageSent?: {
    channel: 'email' | 'whatsapp';
    recipient: string;
    success: boolean;
    messageId?: string;
  };
  errors: string[];
  executionTime: string;
  completedAt: string;
}

/**
 * Verifica si un lead necesita investigación antes del follow-up
 * Un lead necesita investigación si:
 * 1. Es de origen 'lead_generation_workflow'
 * 2. No tiene notas o las notas están vacías
 * 3. No tiene metadata o la metadata está vacía
 */
function shouldExecuteLeadResearch(leadInfo: any): boolean {
  // Verificar si es de origen lead_generation_workflow
  if (leadInfo.origin !== 'lead_generation_workflow') {
    console.log(`📋 Lead origin is '${leadInfo.origin}', not 'lead_generation_workflow' - skipping research`);
    return false;
  }

  // Verificar si tiene notas
  const hasNotes = leadInfo.notes && typeof leadInfo.notes === 'string' && leadInfo.notes.trim() !== '';
  
  // Verificar si tiene metadata
  const hasMetadata = leadInfo.metadata && 
                     typeof leadInfo.metadata === 'object' && 
                     Object.keys(leadInfo.metadata).length > 0;

  console.log(`📋 Lead research check for lead ${leadInfo.id}:`);
  console.log(`   - Origin: ${leadInfo.origin}`);
  console.log(`   - Has notes: ${hasNotes} (${leadInfo.notes ? `"${leadInfo.notes.substring(0, 50)}..."` : 'null/empty'})`);
  console.log(`   - Has metadata: ${hasMetadata} (${hasMetadata ? Object.keys(leadInfo.metadata).length : 0} keys)`);

  // Si no tiene notas NI metadata, necesita investigación
  const needsResearch = !hasNotes && !hasMetadata;
  
  if (needsResearch) {
    console.log(`✅ Lead ${leadInfo.id} needs research - missing both notes and metadata`);
  } else {
    console.log(`❌ Lead ${leadInfo.id} does not need research - has ${hasNotes ? 'notes' : ''}${hasNotes && hasMetadata ? ' and ' : ''}${hasMetadata ? 'metadata' : ''}`);
  }

  return needsResearch;
}

/**
 * Workflow to execute lead follow-up
 * 
 * This workflow:
 * 1. Gets site information by siteId to obtain site details
 * 2. Executes lead follow-up using the sales agent API
 * 3. Saves the follow-up data/logs to the database
 * 4. Sends follow-up message via email or WhatsApp based on the communication channel
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
  let response: any = null;
  let messageSent: { channel: 'email' | 'whatsapp'; recipient: string; success: boolean; messageId?: string } | undefined;
  let validationResult: any = null;

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
    console.log(`📋 Lead details:`);
    console.log(`   - Name: ${leadInfo.name || 'N/A'}`);
    console.log(`   - Email: ${leadInfo.email || 'N/A'}`);
    console.log(`   - Origin: ${leadInfo.origin || 'N/A'}`);
    console.log(`   - Has notes: ${leadInfo.notes ? 'Yes' : 'No'}`);
    console.log(`   - Has metadata: ${leadInfo.metadata && Object.keys(leadInfo.metadata).length > 0 ? 'Yes' : 'No'}`);

    // Check if lead needs research before follow-up
    if (shouldExecuteLeadResearch(leadInfo)) {
      console.log(`🔍 Step 2.1: Executing lead research before follow-up...`);
      
      try {
        const leadResearchOptions: LeadResearchOptions = {
          lead_id: lead_id,
          site_id: site_id,
          userId: options.userId || site.user_id,
          additionalData: {
            ...options.additionalData,
            executedBeforeFollowUp: true,
            followUpWorkflowId: workflowId,
            researchReason: 'missing_notes_and_metadata',
            originalLeadInfo: leadInfo
          }
        };
        
        console.log(`🚀 Starting lead research workflow as child process...`);
        
        const leadResearchHandle = await startChild(leadResearchWorkflow, {
          args: [leadResearchOptions],
          workflowId: `lead-research-followup-${lead_id}-${site_id}-${Date.now()}`,
        });
        
        const leadResearchResult: LeadResearchResult = await leadResearchHandle.result();
        
        if (leadResearchResult.success) {
          console.log(`✅ Lead research completed successfully before follow-up`);
          console.log(`📊 Research results:`);
          console.log(`   - Lead information enriched: Yes`);
          console.log(`   - Deep research executed: ${leadResearchResult.deepResearchResult ? 'Yes' : 'No'}`);
          console.log(`   - Lead segmentation executed: ${leadResearchResult.leadSegmentationResult ? 'Yes' : 'No'}`);
          console.log(`   - Execution time: ${leadResearchResult.executionTime}`);
        } else {
          console.error(`⚠️ Lead research failed, but continuing with follow-up: ${leadResearchResult.errors.join(', ')}`);
          errors.push(`Lead research failed: ${leadResearchResult.errors.join(', ')}`);
        }
        
      } catch (researchError) {
        const errorMessage = researchError instanceof Error ? researchError.message : String(researchError);
        console.error(`⚠️ Exception during lead research, but continuing with follow-up: ${errorMessage}`);
        errors.push(`Lead research exception: ${errorMessage}`);
      }
    } else {
      console.log(`⏭️ Skipping lead research - lead does not meet criteria`);
    }

    console.log(`📞 Step 3: Executing lead follow-up for lead ${lead_id}...`);
    
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
    response = followUpResult.data;
    
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

    // Early validation: Check if messages are available for sending
    const messages = response?.messages || {};
    const lead = response?.lead || {};
    const emailMessage = messages.email?.message;
    const whatsappMessage = messages.whatsapp?.message;
    
    if (!emailMessage && !whatsappMessage) {
      console.log(`⚠️ No follow-up messages found in response - skipping message sending workflow`);
      console.log(`📝 Available data: lead=${!!lead}, messages=${!!messages}, emailMsg=${!!emailMessage}, whatsappMsg=${!!whatsappMessage}`);
      
      // Save logs without message sending
      if (response) {
        console.log(`📝 Step 4: Saving lead follow-up logs to database...`);
        
        const saveLogsResult = await saveLeadFollowUpLogsActivity({
          siteId: site_id,
          leadId: lead_id,
          userId: options.userId || site.user_id,
          data: response
        });
        
        if (!saveLogsResult.success) {
          const errorMsg = `Failed to save lead follow-up logs: ${saveLogsResult.error}`;
          console.error(`⚠️ ${errorMsg}`);
          errors.push(errorMsg);
        } else {
          console.log(`✅ Lead follow-up logs saved successfully`);
        }
      }

      // Complete workflow without sending messages
      const executionTime = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;
      const result: LeadFollowUpResult = {
        success: true,
        leadId: lead_id,
        siteId: site_id,
        siteName,
        siteUrl,
        followUpActions,
        nextSteps,
        data: response,
        messageSent: undefined, // No message was sent
        errors: [...errors, 'No follow-up messages available for sending'],
        executionTime,
        completedAt: new Date().toISOString()
      };

      console.log(`🎉 Lead follow-up workflow completed (no messages to send)!`);
      console.log(`📊 Summary: Lead ${lead_id} follow-up completed for ${siteName} in ${executionTime}`);
      console.log(`⚠️ No follow-up messages were sent - no content available`);

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
    }

    console.log(`✅ Follow-up messages found - proceeding with message sending workflow`);
    console.log(`📧 Email message: ${!!emailMessage}, 📱 WhatsApp message: ${!!whatsappMessage}`);

    // Step 4: Save lead follow-up logs to database
    if (response) {
      console.log(`📝 Step 4: Saving lead follow-up logs to database...`);
      
      const saveLogsResult = await saveLeadFollowUpLogsActivity({
        siteId: site_id,
        leadId: lead_id,
        userId: options.userId || site.user_id,
        data: response
      });
      
      if (!saveLogsResult.success) {
        const errorMsg = `Failed to save lead follow-up logs: ${saveLogsResult.error}`;
        console.error(`⚠️ ${errorMsg}`);
        errors.push(errorMsg);
        // Note: We don't throw here as the main operation was successful
      } else {
        console.log(`✅ Lead follow-up logs saved successfully`);
      }
    }

    // Step 4.5: Validate message and conversation existence before proceeding
    console.log(`🔍 Step 4.5: Validating message and conversation existence...`);
    
    validationResult = await validateMessageAndConversationActivity({
      lead_id: lead_id,
      site_id: site_id,
      response_data: response,
      additional_data: options.additionalData,
      message_id: options.additionalData?.message_id
    });
    
    if (!validationResult.success) {
      const errorMsg = `Validation failed: ${validationResult.error}`;
      console.error(`❌ ${errorMsg}`);
      errors.push(errorMsg);
      console.log(`⚠️ Proceeding with follow-up despite validation issues`);
    } else {
      console.log(`✅ Validation successful - entities exist and are ready`);
      if (validationResult.conversation_id) {
        console.log(`💬 Conversation ${validationResult.conversation_id} validated`);
      }
      if (validationResult.message_id) {
        console.log(`📝 Message ${validationResult.message_id} validated`);
      }
    }

    // Step 5: Wait 2 hours before sending follow-up message
    if (response && response.messages && response.lead) {
      console.log(`⏰ Step 5: Waiting 2 hours before sending follow-up message...`);
      
      // Wait 2 hours before sending the message
      await sleep('2 hours');
      
      console.log(`📤 Step 5.1: Now sending follow-up message based on communication channel...`);
      
      try {
        const responseData = response; // response is already the response data
        const messages = responseData.messages || {};
        const lead = responseData.lead || {};
        
        // Extract contact information
        const email = lead.email || lead.contact_email;
        const phone = lead.phone || lead.phone_number;
        
        // Extract message content from the correct structure
        const emailMessage = messages.email?.message;
        const emailTitle = messages.email?.title;
        const whatsappMessage = messages.whatsapp?.message;
        
        console.log(`📞 Contact info - Email: ${email}, Phone: ${phone}`);
        console.log(`📝 Messages available - Email: ${!!emailMessage}, WhatsApp: ${!!whatsappMessage}`);
        
        let emailSent = false;
        let whatsappSent = false;
        
        // Send email if available
        if (email && emailMessage) {
          console.log(`📧 Sending follow-up email to ${email}...`);
          
          const emailResult = await sendEmailFromAgentActivity({
            email: email,
            subject: emailTitle || `Follow-up: ${lead.name || 'Lead'} - ${siteName}`,
            message: emailMessage,
            site_id: site_id,
            agent_id: options.userId || site.user_id,
            lead_id: lead_id,
            from: siteName,
          });
          
          if (emailResult.success) {
            console.log(`✅ Follow-up email sent successfully to ${email}`);
            emailSent = true;
            messageSent = {
              channel: 'email',
              recipient: email,
              success: true,
              messageId: emailResult.messageId,
            };
          } else {
            const errorMsg = `Failed to send follow-up email: ${emailResult.messageId}`;
            console.error(`⚠️ ${errorMsg}`);
            errors.push(errorMsg);
          }
        }
        
        // Send WhatsApp if available
        if (phone && whatsappMessage) {
          console.log(`📱 Sending follow-up WhatsApp to ${phone}...`);
          
          const whatsappResult = await sendWhatsAppFromAgentActivity({
            phone_number: phone,
            message: whatsappMessage,
            site_id: site_id,
            agent_id: options.userId || site.user_id,
            lead_id: lead_id,
            from: siteName,
          });
          
          if (whatsappResult.success) {
            console.log(`✅ Follow-up WhatsApp sent successfully to ${phone}`);
            whatsappSent = true;
            // If no email was sent or email failed, set WhatsApp as primary message sent
            if (!emailSent) {
              messageSent = {
                channel: 'whatsapp',
                recipient: phone,
                success: true,
                messageId: whatsappResult.messageId,
              };
            }
          } else {
            const errorMsg = `Failed to send follow-up WhatsApp: ${whatsappResult.messageId}`;
            console.error(`⚠️ ${errorMsg}`);
            errors.push(errorMsg);
          }
        }
        
        // Log results
        if (emailSent || whatsappSent) {
          console.log(`✅ Follow-up messages sent - Email: ${emailSent}, WhatsApp: ${whatsappSent}`);
        } else {
          if (!email && !phone) {
            console.log(`⚠️ No valid communication channels found (email: ${email}, phone: ${phone})`);
            errors.push('No valid communication channels found for follow-up message');
          } else if (!emailMessage && !whatsappMessage) {
            console.log(`⚠️ No message content found in follow-up response`);
            errors.push('No message content found in follow-up response');
          } else {
            console.log(`⚠️ Messages available but delivery failed`);
            errors.push('Messages available but delivery failed');
          }
        }

        // Step 5.2: Mark first_contact task as completed after successful message delivery
        if (emailSent || whatsappSent) {
          console.log(`📝 Step 5.2: Marking first_contact task as completed after successful message delivery...`);
          
          const taskUpdateResult = await updateTaskStatusToCompletedActivity({
            lead_id: lead_id,
            site_id: site_id,
            stage: 'awareness', // First contact tasks are typically in awareness stage
            status: 'completed',
            notes: `Task completed after successful ${emailSent ? 'email' : 'WhatsApp'} message delivery via leadFollowUpWorkflow`
          });
          
          if (taskUpdateResult.success) {
            if (taskUpdateResult.updated_task_id) {
              console.log(`✅ First_contact task ${taskUpdateResult.updated_task_id} marked as completed`);
            } else {
              console.log(`✅ First_contact task completion update completed (${taskUpdateResult.task_found ? 'no task to update' : 'no task found'})`);
            }
          } else {
            const errorMsg = `Failed to mark first_contact task as completed: ${taskUpdateResult.error}`;
            console.error(`⚠️ ${errorMsg}`);
            errors.push(errorMsg);
            // Note: We don't throw here as the main operation was successful
          }
        } else {
          console.log(`⚠️ Skipping first_contact task completion - no successful message delivery`);
        }
        
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`⚠️ Failed to send follow-up message: ${errorMessage}`);
        errors.push(`Failed to send follow-up message: ${errorMessage}`);
        // Note: We don't throw here as the main operation was successful
      }
    }

    // Step 5.5: Update message status to 'sent' after successful delivery
    if (messageSent && messageSent.success) {
      console.log(`📝 Step 5.5: Updating message status to 'sent'...`);
      
      const messageUpdateResult = await updateMessageStatusToSentActivity({
        message_id: validationResult?.message_id,
        conversation_id: validationResult?.conversation_id,
        lead_id: lead_id,
        site_id: site_id,
        delivery_channel: messageSent.channel,
        delivery_success: true,
        delivery_details: {
          recipient: messageSent.recipient,
          message_id: messageSent.messageId,
          timestamp: new Date().toISOString()
        }
      });
      
      if (messageUpdateResult.success) {
        if (messageUpdateResult.updated_message_id) {
          console.log(`✅ Message ${messageUpdateResult.updated_message_id} status updated to 'sent'`);
        } else {
          console.log(`✅ Message status update completed (no message to update)`);
        }
      } else {
        const errorMsg = `Failed to update message status: ${messageUpdateResult.error}`;
        console.error(`⚠️ ${errorMsg}`);
        errors.push(errorMsg);
        // Note: We don't throw here as the main operation was successful
      }
    } else {
      console.log(`⚠️ Skipping message status update - no successful delivery`);
    }

    // Step 6: Activate conversation after successful follow-up
    if (messageSent && messageSent.success) {
      console.log(`💬 Step 6: Activating conversation after successful lead follow-up...`);
      console.log(`🔍 Searching for conversation associated with lead ${lead_id}...`);
      
      const conversationUpdateResult = await updateConversationStatusAfterFollowUpActivity({
        lead_id: lead_id,
        site_id: site_id,
        response_data: response,
        additional_data: options.additionalData
      });
      
      if (conversationUpdateResult.success) {
        if (conversationUpdateResult.conversation_id) {
          console.log(`✅ Successfully activated conversation ${conversationUpdateResult.conversation_id}`);
        } else {
          console.log(`✅ Conversation activation completed (no conversation found)`);
        }
      } else {
        const errorMsg = `Failed to activate conversation: ${conversationUpdateResult.error}`;
        console.error(`⚠️ ${errorMsg}`);
        errors.push(errorMsg);
        // Note: We don't throw here as the main operation was successful
      }
    } else {
      console.log(`⚠️ Skipping conversation activation - no successful message delivery`);
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
      data: response,
      messageSent,
      errors,
      executionTime,
      completedAt: new Date().toISOString()
    };

    console.log(`🎉 Lead follow-up workflow completed successfully!`);
    console.log(`📊 Summary: Lead ${lead_id} follow-up completed for ${siteName} in ${executionTime}`);
    
    if (messageSent) {
      const status = messageSent.success ? '✅ sent' : '❌ failed';
      console.log(`📤 Follow-up message ${status} via ${messageSent.channel} to ${messageSent.recipient}`);
    }

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
      data: response,
      messageSent,
      errors: [...errors, errorMessage],
      executionTime,
      completedAt: new Date().toISOString()
    };

    return result;
  }
} 