"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.leadFollowUpWorkflow = leadFollowUpWorkflow;
const workflow_1 = require("@temporalio/workflow");
// Define the activity interface and options
const { logWorkflowExecutionActivity, saveCronStatusActivity, getSiteActivity, leadFollowUpActivity, saveLeadFollowUpLogsActivity, sendEmailFromAgentActivity, sendWhatsAppFromAgentActivity, updateConversationStatusAfterFollowUpActivity, validateMessageAndConversationActivity, updateMessageStatusToSentActivity, } = (0, workflow_1.proxyActivities)({
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
 * 4. Sends follow-up message via email or WhatsApp based on the communication channel
 *
 * @param options - Configuration options for lead follow-up
 */
async function leadFollowUpWorkflow(options) {
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
    const errors = [];
    let followUpActions = [];
    let nextSteps = [];
    let siteName = '';
    let siteUrl = '';
    let response = null;
    let messageSent;
    let validationResult = null;
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
        const site = siteResult.site;
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
        // Step 3: Save lead follow-up logs to database
        if (response) {
            console.log(`📝 Step 3: Saving lead follow-up logs to database...`);
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
            }
            else {
                console.log(`✅ Lead follow-up logs saved successfully`);
            }
        }
        // Step 3.5: Validate message and conversation existence before proceeding
        console.log(`🔍 Step 3.5: Validating message and conversation existence...`);
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
        }
        else {
            console.log(`✅ Validation successful - entities exist and are ready`);
            if (validationResult.conversation_id) {
                console.log(`💬 Conversation ${validationResult.conversation_id} validated`);
            }
            if (validationResult.message_id) {
                console.log(`📝 Message ${validationResult.message_id} validated`);
            }
        }
        // Step 4: Wait 2 hours before sending follow-up message
        if (response && response.messages && response.lead) {
            console.log(`⏰ Step 4: Waiting 2 hours before sending follow-up message...`);
            // Wait 2 hours before sending the message
            await (0, workflow_1.sleep)('2 hours');
            console.log(`📤 Step 4.1: Now sending follow-up message based on communication channel...`);
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
                    }
                    else {
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
                    }
                    else {
                        const errorMsg = `Failed to send follow-up WhatsApp: ${whatsappResult.messageId}`;
                        console.error(`⚠️ ${errorMsg}`);
                        errors.push(errorMsg);
                    }
                }
                // Log results
                if (emailSent || whatsappSent) {
                    console.log(`✅ Follow-up messages sent - Email: ${emailSent}, WhatsApp: ${whatsappSent}`);
                }
                else {
                    if (!email && !phone) {
                        console.log(`⚠️ No valid communication channels found (email: ${email}, phone: ${phone})`);
                        errors.push('No valid communication channels found for follow-up message');
                    }
                    else if (!emailMessage && !whatsappMessage) {
                        console.log(`⚠️ No message content found in follow-up response`);
                        errors.push('No message content found in follow-up response');
                    }
                    else {
                        console.log(`⚠️ Messages available but delivery failed`);
                        errors.push('Messages available but delivery failed');
                    }
                }
            }
            catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                console.error(`⚠️ Failed to send follow-up message: ${errorMessage}`);
                errors.push(`Failed to send follow-up message: ${errorMessage}`);
                // Note: We don't throw here as the main operation was successful
            }
        }
        // Step 4.5: Update message status to 'sent' after successful delivery
        if (messageSent && messageSent.success) {
            console.log(`📝 Step 4.5: Updating message status to 'sent'...`);
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
                }
                else {
                    console.log(`✅ Message status update completed (no message to update)`);
                }
            }
            else {
                const errorMsg = `Failed to update message status: ${messageUpdateResult.error}`;
                console.error(`⚠️ ${errorMsg}`);
                errors.push(errorMsg);
                // Note: We don't throw here as the main operation was successful
            }
        }
        else {
            console.log(`⚠️ Skipping message status update - no successful delivery`);
        }
        // Step 5: Activate conversation after successful follow-up
        if (messageSent && messageSent.success) {
            console.log(`💬 Step 5: Activating conversation after successful lead follow-up...`);
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
                }
                else {
                    console.log(`✅ Conversation activation completed (no conversation found)`);
                }
            }
            else {
                const errorMsg = `Failed to activate conversation: ${conversationUpdateResult.error}`;
                console.error(`⚠️ ${errorMsg}`);
                errors.push(errorMsg);
                // Note: We don't throw here as the main operation was successful
            }
        }
        else {
            console.log(`⚠️ Skipping conversation activation - no successful message delivery`);
        }
        const executionTime = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;
        const result = {
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
    }
    catch (error) {
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
        const result = {
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
