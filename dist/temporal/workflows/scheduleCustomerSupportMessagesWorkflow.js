"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.customerSupportMessageWorkflow = customerSupportMessageWorkflow;
exports.scheduleCustomerSupportMessagesWorkflow = scheduleCustomerSupportMessagesWorkflow;
const workflow_1 = require("@temporalio/workflow");
const sendEmailFromAgentWorkflow_1 = require("./sendEmailFromAgentWorkflow");
// Configure activity options
const { sendCustomerSupportMessageActivity, processAnalysisDataActivity } = (0, workflow_1.proxyActivities)({
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
async function customerSupportMessageWorkflow(emailData, baseParams) {
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
        console.log(`📋 Customer support response:`, JSON.stringify(response.data, null, 2));
        // 🌟 NEW: Call sendEmailFromAgent workflow ONLY if customer support was successful
        let emailWorkflowId;
        let emailSent = false;
        try {
            // Check if we have contact email and original lead_notification indicates email should be sent
            if (emailData.contact_info.email && emailData.lead_notification === 'email') {
                console.log('📧 Starting sendEmailFromAgent workflow - customer support was successful...');
                console.log(`🔄 Original lead_notification: ${emailData.lead_notification} - proceeding with follow-up email`);
                // ✅ FIXED: Manejar analysis_id opcional para el workflowId
                const emailWorkflowSuffix = emailData.analysis_id || `temp-${Date.now()}`;
                emailWorkflowId = `send-email-agent-${emailWorkflowSuffix}`;
                // Prepare email parameters
                const emailParams = {
                    email: emailData.contact_info.email,
                    from: `support@${emailData.site_id}.com`, // Dynamic from based on site
                    subject: `Re: ${emailData.original_subject || 'Your inquiry'}`,
                    message: `Thank you for your message. We have received your inquiry and our customer support team has been notified. We will get back to you shortly.`,
                    site_id: emailData.site_id,
                    agent_id: baseParams.agentId,
                    // ✅ FIXED: Solo enviar lead_id si hay un analysis_id real
                    lead_id: emailData.analysis_id || undefined
                };
                // Start sendEmailFromAgent as child workflow
                const emailHandle = await (0, workflow_1.startChild)(sendEmailFromAgentWorkflow_1.sendEmailFromAgent, {
                    workflowId: emailWorkflowId,
                    args: [emailParams],
                    parentClosePolicy: workflow_1.ParentClosePolicy.PARENT_CLOSE_POLICY_ABANDON,
                });
                console.log(`📨 Started sendEmailFromAgent workflow: ${emailWorkflowId}`);
                console.log(`🚀 Parent close policy: ABANDON - email workflow will continue independently`);
                // Wait for email workflow to complete
                const emailResult = await emailHandle.result();
                if (emailResult.success) {
                    emailSent = true;
                    console.log('✅ Follow-up email sent successfully');
                }
                else {
                    console.log('⚠️ Follow-up email failed, but customer support was successful');
                }
            }
            else if (!emailData.contact_info.email) {
                console.log('📭 No email address available for follow-up');
            }
            else if (emailData.lead_notification !== 'email') {
                console.log(`📋 lead_notification = "${emailData.lead_notification}" - skipping follow-up email`);
            }
        }
        catch (emailError) {
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
    }
    catch (error) {
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
async function scheduleCustomerSupportMessagesWorkflow(params) {
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
    const results = [];
    let scheduled = 0;
    let skipped = 0;
    let completed = 0;
    let failed = 0;
    let emailsSent = 0; // Nueva métrica para trazabilidad
    try {
        // Process each email with 1-minute intervals
        for (let i = 0; i < emails.length; i++) {
            const emailData = emails[i];
            // ✅ IMPROVED: Usar un ID más claro para tracking interno, pero preservar analysis_id real
            const trackingId = emailData.analysis_id || `workflow-${i}-${Date.now()}`;
            const workflowId = `customer-support-message-${trackingId}`;
            // Enriquecer emailData con campos necesarios si no están presentes
            // ✅ FIXED: No sobrescribir analysis_id con un valor generado si ya existe
            const enrichedEmailData = {
                ...emailData,
                site_id: emailData.site_id || site_id,
                user_id: emailData.user_id || user_id,
                // Solo preservar analysis_id si existe y es válido
                analysis_id: emailData.analysis_id,
                lead_notification: emailData.lead_notification || 'email', // Default para procesamiento
            };
            console.log(`📋 Processing email ${i + 1}/${totalEmails} (ID: ${workflowId})`);
            console.log(`📧 Subject: ${emailData.original_subject || 'No subject'}`);
            console.log(`👤 Contact: ${emailData.contact_info.name || 'Unknown'} (${emailData.contact_info.email || 'No email'})`);
            console.log(`🆔 Analysis ID: ${emailData.analysis_id ? emailData.analysis_id + ' (real)' : 'none (will not send lead_id to API)'}`);
            try {
                // Start child workflow for this specific email
                const handle = await (0, workflow_1.startChild)(customerSupportMessageWorkflow, {
                    workflowId,
                    args: [enrichedEmailData, baseParams],
                    parentClosePolicy: workflow_1.ParentClosePolicy.PARENT_CLOSE_POLICY_ABANDON,
                });
                scheduled++;
                console.log(`✅ Scheduled customer support message workflow: ${workflowId}`);
                console.log(`🚀 Parent close policy: ABANDON - customer support workflow will continue independently`);
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
                    }
                    else {
                        skipped++;
                        console.log(`⏭️ Skipped email ${i + 1}: ${result.reason}`);
                    }
                }
                else {
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
                    emailId: trackingId,
                    emailSent: result.emailSent,
                    emailWorkflowId: result.emailWorkflowId
                });
                // Sleep for 1 minute before processing the next email (except for the last one)
                if (i < emails.length - 1) {
                    console.log('⏰ Waiting 1 minute before processing next email...');
                    await (0, workflow_1.sleep)('1m');
                }
            }
            catch (error) {
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
                    emailId: trackingId,
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
    }
    catch (error) {
        console.error('❌ Schedule customer support messages workflow failed:', error);
        throw error;
    }
}
