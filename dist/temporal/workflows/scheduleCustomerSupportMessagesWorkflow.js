"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scheduleCustomerSupportMessagesWorkflow = scheduleCustomerSupportMessagesWorkflow;
const workflow_1 = require("@temporalio/workflow");
const customerSupportWorkflow_1 = require("./customerSupportWorkflow");
// Helper: parse an email address string like "Name <email@host>" or just "email@host"
function parseEmailAddress(address) {
    if (!address || typeof address !== 'string')
        return { name: null, email: null };
    const match = address.match(/^\s*([^<"]+)?\s*<\s*([^>\s]+@[^>\s]+)\s*>\s*$/);
    if (match) {
        const rawName = match[1]?.trim() || '';
        return {
            name: rawName || null,
            email: match[2] || null,
        };
    }
    // Fallback: if the string itself looks like an email, treat it as email with no name
    const simpleEmail = address.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/) ? address : null;
    // Derive a display name from the local-part if possible
    const derivedName = simpleEmail ? simpleEmail.split('@')[0] : null;
    return { name: derivedName, email: simpleEmail };
}
/**
 * Schedule Customer Support Messages Workflow
 * Takes an array of email data and schedules customer support messages
 * with 1-minute intervals between each message
 */
async function scheduleCustomerSupportMessagesWorkflow(params) {
    console.log('🚀 Starting schedule customer support messages workflow...');
    const startTime = new Date();
    const { emails, site_id, user_id, agentId, timestamp, origin } = params;
    const totalEmails = emails.length;
    console.log(`📊 Processing ${totalEmails} emails for customer support...`);
    console.log(`🏢 Global Site: ${site_id}, User: ${user_id}`);
    console.log(`⏰ Timestamp: ${timestamp}`);
    console.log(`🔄 Origin: ${origin || 'not specified'}`);
    const baseParams = {
        agentId,
        origin // Pasar el origen a los workflows hijos
    };
    if (site_id) {
        const searchAttributes = {
            site_id: [site_id],
        };
        const uid = user_id || agentId;
        if (uid) {
            searchAttributes.user_id = [uid];
        }
        (0, workflow_1.upsertSearchAttributes)(searchAttributes);
    }
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
            // Enriquecer/normalizar emailData con campos necesarios si no están presentes
            // ✅ FIXED: No sobrescribir analysis_id con un valor generado si ya existe
            const fromParsed = parseEmailAddress(emailData?.from);
            const toParsed = parseEmailAddress(emailData?.to);
            const enrichedEmailData = {
                // Content
                summary: emailData?.summary || emailData?.original_text || emailData?.body || emailData?.subject || 'Customer support message',
                original_text: emailData?.original_text || emailData?.body,
                original_subject: emailData?.original_subject || emailData?.subject,
                // Contact info (ensure object exists)
                contact_info: emailData?.contact_info && typeof emailData?.contact_info === 'object'
                    ? {
                        name: emailData.contact_info.name ?? fromParsed.name ?? null,
                        email: emailData.contact_info.email ?? fromParsed.email ?? toParsed.email ?? null,
                        phone: emailData.contact_info.phone ?? null,
                        company: emailData.contact_info.company ?? null,
                    }
                    : {
                        name: fromParsed.name ?? null,
                        email: fromParsed.email ?? toParsed.email ?? null,
                        phone: null,
                        company: null,
                    },
                // Identity and processing flags
                site_id: emailData?.site_id || site_id,
                user_id: emailData?.user_id || user_id,
                analysis_id: emailData?.analysis_id,
                lead_id: emailData?.lead_id,
                lead_notification: emailData?.lead_notification || 'email',
                // Optional metadata passthroughs when present
                priority: emailData?.priority,
                response_type: emailData?.response_type,
                potential_value: emailData?.potential_value,
                intent: emailData?.intent,
                conversation_id: emailData?.conversation_id,
                visitor_id: emailData?.visitor_id,
            };
            console.log(`📋 Processing email ${i + 1}/${totalEmails} (ID: ${workflowId})`);
            console.log(`📧 Subject: ${emailData?.original_subject || emailData?.subject || 'No subject'}`);
            console.log(`👤 Contact: ${enrichedEmailData.contact_info?.name || 'Unknown'} (${enrichedEmailData.contact_info?.email || 'No email'})`);
            console.log(`🆔 Analysis ID: ${emailData?.analysis_id ? emailData?.analysis_id + ' (real)' : 'none (will not send lead_id to API)'}`);
            try {
                // Preparar datos según el origen
                let messageDataForWorkflow;
                if (baseParams.origin === 'whatsapp') {
                    // Para WhatsApp, necesitamos reestructurar los datos
                    // Esto requiere que el caller pase los datos correctamente estructurados
                    console.log('📱 Processing as WhatsApp message');
                    messageDataForWorkflow = enrichedEmailData; // Por ahora, tratarlo como EmailData regular
                }
                else {
                    // Para emails, usar como siempre
                    console.log('📧 Processing as email message');
                    messageDataForWorkflow = enrichedEmailData;
                }
                // Start child workflow for this specific email/message
                const handle = await (0, workflow_1.startChild)(customerSupportWorkflow_1.customerSupportMessageWorkflow, {
                    workflowId,
                    args: [messageDataForWorkflow, baseParams],
                    parentClosePolicy: workflow_1.ParentClosePolicy.PARENT_CLOSE_POLICY_ABANDON,
                });
                scheduled++;
                console.log(`✅ Scheduled customer support workflow: ${workflowId}`);
                console.log(`🚀 Parent close policy: ABANDON - customer support workflow will continue independently`);
                // Wait for the child workflow to complete
                const result = await handle.result();
                if (result.success) {
                    if (result.data?.processed) {
                        completed++;
                        console.log(`✅ Completed processing email ${i + 1}: ${result.data.reason}`);
                        // Count emails sent for traceability
                        if (result.data?.emailSent) {
                            emailsSent++;
                            console.log(`📧 Follow-up email sent via workflow: ${result.data.emailWorkflowId}`);
                        }
                    }
                    else {
                        skipped++;
                        console.log(`⏭️ Skipped email ${i + 1}: ${result.data?.reason}`);
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
                    processed: result.data?.processed || false,
                    reason: result.data?.reason || 'No reason provided',
                    error: result.error,
                    emailId: trackingId,
                    emailSent: result.data?.emailSent || false,
                    emailWorkflowId: result.data?.emailWorkflowId
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
