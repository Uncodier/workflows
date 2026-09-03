"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.performEarlyValidation = performEarlyValidation;
const workflow_1 = require("@temporalio/workflow");
const leadInvalidationWorkflow_1 = require("../leadInvalidationWorkflow");
async function performEarlyValidation({ lead_id, site_id, leadInfo, options, site, activities, startTime, workflowId }) {
    const { validateContactInformation, validateCommunicationChannelsActivity, invalidateEmailOnlyActivity, saveCronStatusActivity, logWorkflowExecutionActivity } = activities;
    const errors = [];
    let emailInvalidatedInEarlyValidation = false;
    console.log(`🔍 Step 2.1: Early validation of contact information before research to save resources...`);
    // Extract contact information for early validation
    const leadEmail = leadInfo.email;
    const leadPhone = leadInfo.phone || leadInfo.phone_number;
    console.log(`📋 Contact info for early validation:`);
    console.log(`   - Email: ${leadEmail || 'undefined'}`);
    console.log(`   - Phone: ${leadPhone || 'undefined'}`);
    // Only proceed if we have at least one valid contact method
    if (!leadEmail && !leadPhone) {
        console.log(`🚫 No contact information available (no email and no phone) - skipping research and follow-up`);
        const executionTime = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;
        const result = {
            success: false,
            leadId: lead_id,
            siteId: site_id,
            siteName: site.name,
            siteUrl: site.url,
            followUpActions: [],
            nextSteps: [],
            data: null,
            messageSent: undefined,
            errors: ['No contact information available - lead has no email and no phone'],
            executionTime,
            completedAt: new Date().toISOString()
        };
        // Update cron status
        await saveCronStatusActivity({
            siteId: site_id,
            workflowId,
            scheduleId: `lead-follow-up-${lead_id}-${site_id}`,
            activityName: 'leadFollowUpWorkflow',
            status: 'COMPLETED',
            lastRun: new Date().toISOString()
        });
        // Log completion
        await logWorkflowExecutionActivity({
            workflowId,
            workflowType: 'leadFollowUpWorkflow',
            status: 'COMPLETED',
            input: options,
            output: result,
        });
        return { shouldReturn: true, result, emailInvalidatedInEarlyValidation: false, errors };
    }
    // Perform early contact validation (without messages, just contact info)
    const earlyValidationResult = await validateContactInformation({
        email: leadEmail,
        hasEmailMessage: true, // Assume we will have messages for now
        hasWhatsAppMessage: true, // Assume we will have messages for now
        leadId: lead_id,
        phone: leadPhone,
        leadMetadata: leadInfo.metadata // Pass lead metadata to check emailVerified flag
    });
    console.log(`📊 Early validation completed: type=${earlyValidationResult.validationType}, shouldProceed=${earlyValidationResult.shouldProceed}`);
    console.log(`📋 Reason: ${earlyValidationResult.reason}`);
    console.log(`📊 Full validation result:`, JSON.stringify(earlyValidationResult, null, 2));
    // Handle specific early validation results that require immediate action
    if (earlyValidationResult.validationType === 'email' && !earlyValidationResult.isValid && earlyValidationResult.success) {
        console.log(`🚫 Email validation failed in early validation (invalid or not deliverable)`);
        console.log(`📧 Email value: ${leadEmail || 'null/undefined'}`);
        console.log(`📋 Reason: ${earlyValidationResult.reason}`);
        const hasLeadWhatsApp = leadPhone && leadPhone.trim() !== '';
        // Check if site has WhatsApp channel configured
        console.log(`🔍 Checking if site has WhatsApp channel configured...`);
        const channelsValidation = await validateCommunicationChannelsActivity({
            site_id: site_id
        });
        const hasSiteWhatsApp = channelsValidation.success && channelsValidation.hasWhatsappChannel;
        console.log(`📊 Channel validation results:`);
        console.log(`   - Lead has WhatsApp: ${hasLeadWhatsApp ? '✅' : '❌'}`);
        console.log(`   - Site has WhatsApp configured: ${hasSiteWhatsApp ? '✅' : '❌'}`);
        // Use full invalidation workflow if:
        // a) Site doesn't have WhatsApp configured (even if lead has phone)
        // b) Lead doesn't have WhatsApp phone number
        const shouldUseFullInvalidation = !hasSiteWhatsApp || !hasLeadWhatsApp;
        if (shouldUseFullInvalidation) {
            // Use full invalidation workflow - either site has no WhatsApp or lead has no phone
            const reason = !hasSiteWhatsApp ? 'Site has no WhatsApp configured' : 'Lead has no WhatsApp phone number';
            console.log(`🚫 ${reason} - using full lead invalidation workflow and stopping before research...`);
            const invalidationOptions = {
                lead_id: lead_id,
                site_id: site_id,
                reason: 'invalid_email', // This covers both invalid and non-deliverable emails
                email: leadEmail,
                userId: options.userId || site.user_id
            };
            const invalidationHandle = await (0, workflow_1.startChild)(leadInvalidationWorkflow_1.leadInvalidationWorkflow, {
                args: [invalidationOptions],
                workflowId: `lead-invalidation-${lead_id}-email-early-${Date.now()}`,
                parentClosePolicy: workflow_1.ParentClosePolicy.PARENT_CLOSE_POLICY_ABANDON // ✅ Child continues independently
            });
            console.log(`🚀 Lead invalidation workflow started (early validation), waiting for completion...`);
            try {
                const invalidationResult = await invalidationHandle.result();
                if (invalidationResult.success) {
                    console.log(`✅ Lead invalidation completed successfully (early validation)`);
                }
                else {
                    console.error(`⚠️ Lead invalidation failed (early validation): ${invalidationResult.errors.join(', ')}`);
                    errors.push(`Lead invalidation failed: ${invalidationResult.errors.join(', ')}`);
                }
            }
            catch (invalidationError) {
                const invalidationErrorMessage = invalidationError instanceof Error ? invalidationError.message : String(invalidationError);
                console.error(`⚠️ Exception during lead invalidation (early validation): ${invalidationErrorMessage}`);
                errors.push(`Lead invalidation exception: ${invalidationErrorMessage}`);
            }
            // Complete the workflow successfully after invalidation since there's no valid communication channel
            const executionTime = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;
            const result = {
                success: true, // Changed to true since invalidation completed successfully
                leadId: lead_id,
                siteId: site_id,
                siteName: site.name,
                siteUrl: site.url,
                followUpActions: [],
                nextSteps: [],
                data: null,
                messageSent: undefined,
                errors: [...errors, 'Lead invalidated due to invalid/non-deliverable email and no WhatsApp available (early validation)'],
                executionTime,
                completedAt: new Date().toISOString()
            };
            // Update cron status
            await saveCronStatusActivity({
                siteId: site_id,
                workflowId,
                scheduleId: `lead-follow-up-${lead_id}-${site_id}`,
                activityName: 'leadFollowUpWorkflow',
                status: 'COMPLETED',
                lastRun: new Date().toISOString()
            });
            // Log completion
            await logWorkflowExecutionActivity({
                workflowId,
                workflowType: 'leadFollowUpWorkflow',
                status: 'COMPLETED',
                input: options,
                output: result,
            });
            return { shouldReturn: true, result, emailInvalidatedInEarlyValidation: false, errors };
        }
        else {
            // Both lead and site have WhatsApp available, handle email invalidation appropriately
            console.log(`📱✅ Both lead and site have WhatsApp available - invalidating only email but continuing with WhatsApp workflow`);
            if (leadEmail) {
                // Email exists but is invalid or not deliverable, invalidate it
                console.log(`📧🚫 Email invalid or not deliverable but WhatsApp available - invalidating only email field...`);
                const emailInvalidationResult = await invalidateEmailOnlyActivity({
                    lead_id: lead_id,
                    failed_email: leadEmail,
                    userId: options.userId || site.user_id
                });
                if (emailInvalidationResult.success) {
                    console.log(`✅ Email invalidated successfully (early validation), site_id preserved for WhatsApp communication`);
                    emailInvalidatedInEarlyValidation = true; // Mark email as invalidated to prevent sending later
                }
                else {
                    console.error(`❌ Failed to invalidate email (early validation): ${emailInvalidationResult.error}`);
                    errors.push(`Email invalidation failed: ${emailInvalidationResult.error}`);
                }
            }
            else {
                // No email exists, but we have WhatsApp, so just mark as no email
                console.log(`📧🚫 No email exists but WhatsApp available - marking as no email for later processing`);
                emailInvalidatedInEarlyValidation = true; // Mark as no email to prevent email sending later
            }
            // Note: We don't return here - let the shouldProceed logic below handle the flow
            console.log(`📋 Email invalidation completed, proceeding to shouldProceed check...`);
        }
    }
    // If API worked but we shouldn't proceed, complete successfully after invalidation
    if (!earlyValidationResult.shouldProceed) {
        console.log(`✅ Contact validation API worked but email is invalid or not deliverable - completing workflow after successful invalidation`);
        console.log(`📋 Validation details:`);
        console.log(`   - Type: ${earlyValidationResult.validationType}`);
        console.log(`   - Valid: ${earlyValidationResult.isValid}`);
        console.log(`   - Reason: ${earlyValidationResult.reason}`);
        console.log(`   - Email: ${leadEmail || 'undefined'}`);
        console.log(`   - Phone: ${leadPhone || 'undefined'}`);
        // Create appropriate message for successful validation but invalid contact
        const validationMessage = `Contact validation completed: ${earlyValidationResult.reason}`;
        // Complete workflow successfully since validation API worked correctly
        const executionTime = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;
        console.log(`🎉 Lead follow-up workflow completed successfully after contact validation (invalid/non-deliverable email, no alternative contact)`);
        console.log(`📊 Summary: Lead ${lead_id} validation completed for ${site.name} in ${executionTime}`);
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
            output: {
                success: true,
                leadId: lead_id,
                siteId: site_id,
                siteName: site.name,
                siteUrl: site.url,
                followUpActions: [],
                nextSteps: [],
                data: null,
                messageSent: undefined,
                errors: [validationMessage],
                executionTime,
                completedAt: new Date().toISOString()
            },
        });
        // Return success result since validation worked correctly
        return {
            shouldReturn: true,
            result: {
                success: true,
                leadId: lead_id,
                siteId: site_id,
                siteName: site.name,
                siteUrl: site.url,
                followUpActions: [],
                nextSteps: [],
                data: null,
                messageSent: undefined,
                errors: [validationMessage],
                executionTime,
                completedAt: new Date().toISOString()
            },
            emailInvalidatedInEarlyValidation,
            errors
        };
    }
    // Check if the validation API itself failed (not just invalid email)
    if (!earlyValidationResult.success) {
        console.log(`❌ Contact validation API failed - failing workflow`);
        console.log(`🔍 API failure details:`);
        console.log(`   - Error: ${earlyValidationResult.error}`);
        console.log(`   - Reason: ${earlyValidationResult.reason}`);
        // Create appropriate error message for API failure
        const apiFailureError = `Contact validation API failed: ${earlyValidationResult.error || earlyValidationResult.reason}`;
        errors.push(apiFailureError);
        // Update cron status to indicate API failure
        await saveCronStatusActivity({
            siteId: site_id,
            workflowId,
            scheduleId: `lead-follow-up-${lead_id}-${site_id}`,
            activityName: 'leadFollowUpWorkflow',
            status: 'FAILED',
            lastRun: new Date().toISOString(),
            errorMessage: apiFailureError
        });
        // Log workflow failure due to API failure
        await logWorkflowExecutionActivity({
            workflowId,
            workflowType: 'leadFollowUpWorkflow',
            status: 'FAILED',
            input: options,
            error: apiFailureError,
        });
        // Throw error to properly fail the workflow when API fails
        throw new Error(apiFailureError);
    }
    console.log(`✅ Early contact validation passed - proceeding with research and follow-up`);
    return { shouldReturn: false, emailInvalidatedInEarlyValidation, errors };
}
