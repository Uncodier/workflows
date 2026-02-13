"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.leadInvalidationWorkflow = leadInvalidationWorkflow;
const workflow_1 = require("@temporalio/workflow");
const leadFollowUpWorkflow_1 = require("./leadFollowUpWorkflow");
// Force worker restart - v2.0
// Define the activity interface and options
const { logWorkflowExecutionActivity, saveCronStatusActivity, getLeadActivity, invalidateLeadActivity, invalidateReferredLeads, findLeadsBySharedContactActivity, updateTaskStatusToCompletedActivity, deleteLeadConversationsActivity, updateLeadActivity, checkLeadExistingTasksActivity, } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: '3 minutes', // Reasonable timeout for lead invalidation
    retry: {
        maximumAttempts: 3,
    },
});
/**
 * Workflow to invalidate leads when communication fails
 *
 * This workflow:
 * 1. Gets the lead information from database
 * 2. Checks if lead has alternative contact methods
 * 3. If no alternative contact, removes site_id and adds invalidation metadata
 * 4. For hard invalidation (no alternative contact), deletes all conversations and messages
 * 5. Finds other leads sharing the same failed contact information
 * 6. Invalidates shared leads and adds metadata for revalidation
 *
 * @param options - Configuration options for lead invalidation
 */
async function leadInvalidationWorkflow(options) {
    const { lead_id, site_id } = options;
    // Set default reason if not provided and map legacy reasons
    let reason = options.reason || 'invalid_contact';
    // Map legacy reasons to proper communication failure reasons for metadata tracking
    if (reason === 'invalid_email') {
        reason = 'email_failed';
    }
    else if (reason === 'invalid_phone') {
        reason = 'whatsapp_failed';
    }
    console.log(`📋 Original reason: ${options.reason}, Mapped reason: ${reason}`);
    if (!lead_id) {
        throw new Error('No lead ID provided');
    }
    if (!site_id) {
        throw new Error('No site ID provided');
    }
    const searchAttributes = {
        site_id: [site_id],
        lead_id: [lead_id],
    };
    if (options.userId) {
        searchAttributes.user_id = [options.userId];
    }
    (0, workflow_1.upsertSearchAttributes)(searchAttributes);
    const workflowId = `lead-invalidation-${lead_id}-${Date.now()}`;
    const startTime = Date.now();
    console.log(`🚫 Starting lead invalidation workflow for lead ${lead_id}`);
    console.log(`📋 Reason: ${reason}`);
    console.log(`📞 Failed telephone: ${options.telephone || 'N/A'}`);
    console.log(`📧 Failed email: ${options.email || 'N/A'}`);
    // Log workflow execution start
    await logWorkflowExecutionActivity({
        workflowId,
        workflowType: 'leadInvalidationWorkflow',
        status: 'STARTED',
        input: options,
    });
    // Update cron status to indicate the workflow is running
    await saveCronStatusActivity({
        siteId: site_id,
        workflowId,
        scheduleId: `lead-invalidation-${lead_id}`,
        activityName: 'leadInvalidationWorkflow',
        status: 'RUNNING',
        lastRun: new Date().toISOString()
    });
    const errors = [];
    let leadInvalidated = false;
    let sharedContactLeads = [];
    let invalidatedSharedLeads = 0;
    let originalSiteId = site_id;
    let conversationsDeleted = 0;
    let messagesDeleted = 0;
    try {
        console.log(`👤 Step 1: Getting lead information for ${lead_id}...`);
        // Get lead information to check current contact methods
        const leadResult = await getLeadActivity(lead_id);
        if (!leadResult.success) {
            const errorMsg = `Failed to get lead information: ${leadResult.error}`;
            console.error(`❌ ${errorMsg}`);
            errors.push(errorMsg);
            throw new Error(errorMsg);
        }
        const lead = leadResult.lead;
        originalSiteId = lead.site_id || site_id;
        console.log(`✅ Retrieved lead information: ${lead.name || lead.email}`);
        console.log(`📋 Lead details:`);
        console.log(`   - Current site_id: ${lead.site_id}`);
        console.log(`   - Email: ${lead.email || 'N/A'}`);
        console.log(`   - Phone: ${lead.phone || 'N/A'}`);
        console.log(`   - Has alternative contact: ${hasAlternativeContact(lead, options)}`);
        // Early guard: if lead is qualified/converted or has consideration+ tasks, do not invalidate; only append note
        const leadStatus = lead.status;
        const protectedStatuses = new Set(['qualified', 'converted']);
        // Check existing tasks to detect any in consideration or later stages
        let hasConsiderationOrLaterTasks = false;
        try {
            const tasksInfo = await checkLeadExistingTasksActivity({
                lead_id,
                site_id: originalSiteId
            });
            if (tasksInfo.success && tasksInfo.existingTasks && tasksInfo.existingTasks.length > 0) {
                const considerationStages = new Set(['consideration', 'decision', 'purchase', 'retention', 'referral']);
                hasConsiderationOrLaterTasks = tasksInfo.existingTasks.some((t) => considerationStages.has(t.stage));
                if (hasConsiderationOrLaterTasks) {
                    console.log(`🛑 Lead has tasks in consideration+ stages. Stages found: ${tasksInfo.existingTasks.map((t) => t.stage).join(', ')}`);
                }
            }
        }
        catch (taskCheckErr) {
            const taskCheckMsg = taskCheckErr instanceof Error ? taskCheckErr.message : String(taskCheckErr);
            console.error(`⚠️ Failed to check existing tasks for early guard: ${taskCheckMsg}`);
            errors.push(`Task check failure: ${taskCheckMsg}`);
        }
        const shouldSkipInvalidation = (leadStatus && protectedStatuses.has(leadStatus)) || hasConsiderationOrLaterTasks;
        if (shouldSkipInvalidation) {
            console.log(`🛑 Lead has protected status (${leadStatus}). Skipping invalidation and deletions. Will only append note.`);
            if (options.response_message) {
                try {
                    await updateLeadActivity({
                        lead_id,
                        updateData: {
                            // Concatenate: existing notes + new message. We rely on updateLeadActivity safeUpdate, so we just set notes to append-friendly value.
                            // Since updateLeadActivity doesn't read existing notes, we pass a marker for concatenation via a minimal pattern: prefix with "\n" if needed is handled at DB trigger or leave as overwrite if none.
                            notes: (lead.notes ? `${lead.notes}\n${options.response_message}` : options.response_message)
                        },
                        safeUpdate: true
                    });
                    console.log(`📝 Appended note to lead ${lead_id} due to protected criteria.`);
                }
                catch (noteError) {
                    const noteErrMsg = noteError instanceof Error ? noteError.message : String(noteError);
                    console.error(`⚠️ Failed to append note for protected lead: ${noteErrMsg}`);
                    errors.push(`Note append failure: ${noteErrMsg}`);
                }
            }
            const executionTime = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;
            const result = {
                success: true,
                leadId: lead_id,
                originalSiteId,
                invalidatedLead: false,
                sharedContactLeads,
                invalidatedSharedLeads,
                reason,
                errors,
                executionTime,
                completedAt: new Date().toISOString(),
                conversationsDeleted,
                messagesDeleted,
                hardInvalidation: false
            };
            // Update cron status and log, then return early
            await saveCronStatusActivity({
                siteId: site_id,
                workflowId,
                scheduleId: `lead-invalidation-${lead_id}`,
                activityName: 'leadInvalidationWorkflow',
                status: 'COMPLETED',
                lastRun: new Date().toISOString()
            });
            await logWorkflowExecutionActivity({
                workflowId,
                workflowType: 'leadInvalidationWorkflow',
                status: 'COMPLETED',
                input: options,
                output: result,
            });
            return result;
        }
        // Step 2: Invalidate lead (remove site_id and add metadata)
        console.log(`🔍 Step 2: Invalidating lead (removing site_id and adding metadata)...`);
        // Always invalidate the lead when this workflow is called
        // This ensures proper tracking even if lead has alternative contact methods
        const hasAlternative = hasAlternativeContact(lead, options);
        console.log(`📋 Lead has alternative contact methods: ${hasAlternative}`);
        console.log(`🚫 Proceeding with invalidation regardless (for tracking purposes)`);
        const invalidationResult = await invalidateLeadActivity({
            lead_id: lead_id,
            original_site_id: originalSiteId,
            reason: reason,
            failed_contact: {
                telephone: options.telephone,
                email: options.email
            },
            userId: options.userId,
            response_message: options.response_message
        });
        if (invalidationResult.success) {
            leadInvalidated = true;
            console.log(`✅ Lead ${lead_id} invalidated successfully`);
            console.log(`📝 site_id removed and invalidation metadata added`);
            // Step 2a: Delete conversations if this is a hard invalidation (no alternative contact methods)
            if (!hasAlternative) {
                console.log(`🗑️ Step 2a: Hard invalidation detected - deleting conversations for lead with no contact methods...`);
                console.log(`📋 Lead has no alternative contact methods, cleaning up conversation data`);
                try {
                    const conversationCleanupResult = await deleteLeadConversationsActivity({
                        lead_id: lead_id,
                        site_id: originalSiteId,
                        reason: `hard_invalidation_${reason}`
                    });
                    if (conversationCleanupResult.success) {
                        conversationsDeleted = conversationCleanupResult.conversations_deleted;
                        messagesDeleted = conversationCleanupResult.messages_deleted;
                        console.log(`✅ Conversation cleanup completed successfully:`);
                        console.log(`   - Conversations deleted: ${conversationsDeleted}`);
                        console.log(`   - Messages deleted: ${messagesDeleted}`);
                        console.log(`   - Reason: No valid contact methods available`);
                    }
                    else {
                        const errorMsg = `Failed to cleanup conversations: ${conversationCleanupResult.error}`;
                        console.error(`⚠️ ${errorMsg}`);
                        errors.push(errorMsg);
                        // Note: We don't throw here as the invalidation was successful
                    }
                }
                catch (cleanupError) {
                    const cleanupErrorMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
                    console.error(`⚠️ Exception during conversation cleanup: ${cleanupErrorMessage}`);
                    errors.push(`Conversation cleanup exception: ${cleanupErrorMessage}`);
                    // Note: We don't throw here as the invalidation was successful
                }
            }
            else {
                console.log(`ℹ️ Lead has alternative contact methods - preserving conversation data for potential future use`);
            }
        }
        else {
            const errorMsg = `Failed to invalidate lead: ${invalidationResult.error}`;
            console.error(`❌ ${errorMsg}`);
            errors.push(errorMsg);
        }
        // Step 3: Find and invalidate leads with shared contact information
        console.log(`🔍 Step 3: Finding leads with shared failed contact information...`);
        if (options.email || options.telephone) {
            const sharedLeadsResult = await findLeadsBySharedContactActivity({
                email: options.email,
                telephone: options.telephone,
                exclude_lead_id: lead_id,
                site_id: site_id
            });
            if (sharedLeadsResult.success && sharedLeadsResult.leads && sharedLeadsResult.leads.length > 0) {
                sharedContactLeads = sharedLeadsResult.leads.map((l) => l.id);
                console.log(`🔍 Found ${sharedContactLeads.length} leads sharing failed contact information`);
                // Step 3a: Invalidate shared leads
                console.log(`🚫 Step 3a: Invalidating shared contact leads...`);
                for (const sharedLeadId of sharedContactLeads) {
                    try {
                        const sharedInvalidationResult = await invalidateLeadActivity({
                            lead_id: sharedLeadId,
                            original_site_id: site_id,
                            reason: `shared_${reason}`,
                            failed_contact: {
                                telephone: options.telephone,
                                email: options.email
                            },
                            userId: options.userId,
                            shared_with_lead_id: lead_id,
                            response_message: options.response_message ? `${options.response_message} (shared contact invalidation)` : undefined
                        });
                        if (sharedInvalidationResult.success) {
                            invalidatedSharedLeads++;
                            console.log(`✅ Shared lead ${sharedLeadId} invalidated successfully`);
                        }
                        else {
                            const errorMsg = `Failed to invalidate shared lead ${sharedLeadId}: ${sharedInvalidationResult.error}`;
                            console.error(`⚠️ ${errorMsg}`);
                            errors.push(errorMsg);
                        }
                    }
                    catch (sharedError) {
                        const errorMessage = sharedError instanceof Error ? sharedError.message : String(sharedError);
                        console.error(`⚠️ Exception invalidating shared lead ${sharedLeadId}: ${errorMessage}`);
                        errors.push(`Shared lead invalidation exception: ${errorMessage}`);
                    }
                }
                console.log(`📊 Shared leads invalidation summary: ${invalidatedSharedLeads}/${sharedContactLeads.length} successful`);
            }
            else {
                console.log(`ℹ️ No other leads found sharing the failed contact information`);
            }
        }
        else {
            console.log(`⚠️ No contact information provided for shared lead search`);
        }
        // Step 3b: Check and invalidate referred leads if lead has referral_lead_id
        console.log(`🔍 Step 3b: Checking for referral relationships...`);
        if (lead.referral_lead_id) {
            console.log(`🔗 Lead has referral_lead_id: ${lead.referral_lead_id}, invalidating related leads...`);
            try {
                const referralInvalidationResult = await invalidateReferredLeads({
                    lead_id: lead_id,
                    referral_lead_id: lead.referral_lead_id,
                    original_site_id: originalSiteId,
                    reason: reason,
                    original_email: lead.email,
                    original_phone: lead.phone,
                    userId: options.userId,
                    response_message: options.response_message
                });
                if (referralInvalidationResult.success) {
                    console.log(`✅ Referral invalidation completed successfully`);
                    console.log(`📊 Invalidated ${referralInvalidationResult.invalidated_leads.length} referred leads`);
                    if (referralInvalidationResult.errors.length > 0) {
                        console.log(`⚠️ Some errors occurred during referral invalidation:`);
                        referralInvalidationResult.errors.forEach(error => console.log(`   - ${error}`));
                        errors.push(...referralInvalidationResult.errors);
                    }
                }
                else {
                    const errorMsg = `Referral invalidation failed: ${referralInvalidationResult.errors.join(', ')}`;
                    console.error(`❌ ${errorMsg}`);
                    errors.push(errorMsg);
                }
            }
            catch (referralError) {
                const errorMessage = referralError instanceof Error ? referralError.message : String(referralError);
                console.error(`❌ Exception during referral invalidation: ${errorMessage}`);
                errors.push(`Referral invalidation exception: ${errorMessage}`);
            }
        }
        else {
            console.log(`ℹ️ Lead has no referral_lead_id, skipping referral invalidation`);
        }
        console.log(`✅ Lead invalidation process completed - skipping company null list functionality`);
        console.log(`📝 Note: Company tracking has been simplified to focus on lead-level invalidation`);
        const executionTime = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;
        const result = {
            success: true,
            leadId: lead_id,
            originalSiteId,
            invalidatedLead: leadInvalidated,
            sharedContactLeads,
            invalidatedSharedLeads,
            reason,
            errors,
            executionTime,
            completedAt: new Date().toISOString(),
            conversationsDeleted,
            messagesDeleted,
            hardInvalidation: !hasAlternative
        };
        // Step 4: Delete initial task regardless of outcome
        console.log(`📝 Step 4: Deleting initial task for lead ${lead_id}...`);
        try {
            const taskDeleteResult = await updateTaskStatusToCompletedActivity({
                lead_id: lead_id,
                site_id: originalSiteId,
                stage: 'awareness', // Initial tasks are typically in awareness stage
                status: 'completed',
                notes: `Task completed after lead invalidation workflow (${reason})`
            });
            if (taskDeleteResult.success) {
                if (taskDeleteResult.updated_task_id) {
                    console.log(`✅ Initial task ${taskDeleteResult.updated_task_id} marked as completed after invalidation`);
                }
                else {
                    console.log(`✅ Task completion update completed (${taskDeleteResult.task_found ? 'no task to update' : 'no task found'})`);
                }
            }
            else {
                const errorMsg = `Failed to mark initial task as completed: ${taskDeleteResult.error}`;
                console.error(`⚠️ ${errorMsg}`);
                errors.push(errorMsg);
                // Note: We don't throw here as the invalidation was successful
            }
        }
        catch (taskError) {
            const taskErrorMessage = taskError instanceof Error ? taskError.message : String(taskError);
            console.error(`⚠️ Exception deleting initial task: ${taskErrorMessage}`);
            errors.push(`Task deletion exception: ${taskErrorMessage}`);
            // Note: We don't throw here as the invalidation was successful
        }
        // Step 5: If lead has valid phone number after invalidation, schedule follow-up
        console.log(`📞 Step 5: Checking if lead has valid phone number for follow-up...`);
        try {
            // Re-fetch lead to get current state after invalidation
            const updatedLeadResult = await getLeadActivity(lead_id);
            if (updatedLeadResult.success && updatedLeadResult.lead) {
                const updatedLead = updatedLeadResult.lead;
                const hasValidPhone = updatedLead.phone &&
                    updatedLead.phone.trim() !== '' &&
                    updatedLead.phone !== options.telephone; // Different from failed phone
                console.log(`📋 Post-invalidation lead contact check:`);
                console.log(`   - Phone: ${updatedLead.phone || 'N/A'}`);
                console.log(`   - Failed phone: ${options.telephone || 'N/A'}`);
                console.log(`   - Has valid phone: ${hasValidPhone}`);
                if (hasValidPhone) {
                    console.log(`🚀 Lead has valid phone number, scheduling follow-up workflow...`);
                    const followUpOptions = {
                        lead_id: lead_id,
                        site_id: originalSiteId,
                        userId: options.userId,
                        researchEnabled: options.researchEnabled ?? false,
                        additionalData: {
                            source: 'lead_invalidation_recovery',
                            previous_failed_contact: options.telephone || options.email,
                            invalidation_reason: reason
                        }
                    };
                    // Use versioning to handle non-deterministic changes in child workflow options
                    // This allows in-flight workflows to replay correctly with old behavior
                    // while new workflows use the updated code path with ABANDON policy
                    const shouldUseAbandonPolicy = (0, workflow_1.patched)('start-followup-child-recovery-v1');
                    // Deprecate to encourage cleanup after migration period (30-60 days)
                    (0, workflow_1.deprecatePatch)('start-followup-child-recovery-v1');
                    if (shouldUseAbandonPolicy) {
                        // NEW PATH: Start child workflow with ABANDON policy to prevent cascading cancellation
                        await (0, workflow_1.startChild)(leadFollowUpWorkflow_1.leadFollowUpWorkflow, {
                            args: [followUpOptions],
                            workflowId: `lead-follow-up-recovery-${lead_id}-${Date.now()}`,
                            parentClosePolicy: workflow_1.ParentClosePolicy.PARENT_CLOSE_POLICY_ABANDON
                        });
                    }
                    else {
                        // OLD PATH: Start child workflow without ABANDON policy (original behavior)
                        // This ensures deterministic replay for workflows started before the patch
                        await (0, workflow_1.startChild)(leadFollowUpWorkflow_1.leadFollowUpWorkflow, {
                            args: [followUpOptions],
                            workflowId: `lead-follow-up-recovery-${lead_id}-${Date.now()}`
                        });
                    }
                    console.log(`✅ Lead follow-up workflow started for lead ${lead_id} with valid phone number`);
                    console.log(`📞 Will attempt follow-up via WhatsApp to: ${updatedLead.phone}`);
                    // Don't wait for the result, just start it and continue
                }
                else {
                    console.log(`ℹ️ Lead ${lead_id} has no valid phone number for follow-up after invalidation`);
                }
            }
            else {
                console.log(`⚠️ Could not re-fetch lead information for follow-up check: ${updatedLeadResult.error}`);
            }
        }
        catch (followUpError) {
            const followUpErrorMessage = followUpError instanceof Error ? followUpError.message : String(followUpError);
            console.error(`⚠️ Exception checking for follow-up opportunity: ${followUpErrorMessage}`);
            errors.push(`Follow-up check exception: ${followUpErrorMessage}`);
            // Note: We don't throw here as the invalidation was successful
        }
        console.log(`🎉 Lead invalidation workflow completed successfully!`);
        console.log(`📊 Summary: Lead ${lead_id} - Invalidated: ${leadInvalidated}, Shared leads: ${invalidatedSharedLeads}`);
        if (conversationsDeleted > 0 || messagesDeleted > 0) {
            console.log(`🗑️ Conversation cleanup: ${conversationsDeleted} conversations, ${messagesDeleted} messages deleted (hard invalidation)`);
        }
        console.log(`⏱️ Execution time: ${executionTime}`);
        // Update cron status to indicate successful completion
        await saveCronStatusActivity({
            siteId: site_id,
            workflowId,
            scheduleId: `lead-invalidation-${lead_id}`,
            activityName: 'leadInvalidationWorkflow',
            status: 'COMPLETED',
            lastRun: new Date().toISOString()
        });
        // Log successful completion
        await logWorkflowExecutionActivity({
            workflowId,
            workflowType: 'leadInvalidationWorkflow',
            status: 'COMPLETED',
            input: options,
            output: result,
        });
        return result;
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Lead invalidation workflow failed: ${errorMessage}`);
        // Step 4: Even if workflow failed, try to delete initial task
        console.log(`📝 Step 4: Attempting to delete initial task for lead ${lead_id} despite workflow failure...`);
        try {
            const taskDeleteResult = await updateTaskStatusToCompletedActivity({
                lead_id: lead_id,
                site_id: site_id,
                stage: 'awareness', // Initial tasks are typically in awareness stage
                status: 'completed',
                notes: `Task completed after failed lead invalidation workflow (${errorMessage})`
            });
            if (taskDeleteResult.success) {
                if (taskDeleteResult.updated_task_id) {
                    console.log(`✅ Initial task ${taskDeleteResult.updated_task_id} marked as completed despite workflow failure`);
                }
                else {
                    console.log(`✅ Task completion update completed (${taskDeleteResult.task_found ? 'no task to update' : 'no task found'})`);
                }
            }
            else {
                console.error(`⚠️ Failed to mark initial task as completed: ${taskDeleteResult.error}`);
                errors.push(`Task deletion after failure: ${taskDeleteResult.error}`);
            }
        }
        catch (taskError) {
            const taskErrorMessage = taskError instanceof Error ? taskError.message : String(taskError);
            console.error(`⚠️ Exception deleting initial task after workflow failure: ${taskErrorMessage}`);
            errors.push(`Task deletion exception after failure: ${taskErrorMessage}`);
        }
        // Update cron status to indicate failure
        await saveCronStatusActivity({
            siteId: site_id,
            workflowId,
            scheduleId: `lead-invalidation-${lead_id}`,
            activityName: 'leadInvalidationWorkflow',
            status: 'FAILED',
            lastRun: new Date().toISOString(),
            errorMessage: errorMessage,
            retryCount: 1
        });
        // Log workflow execution failure
        await logWorkflowExecutionActivity({
            workflowId,
            workflowType: 'leadInvalidationWorkflow',
            status: 'FAILED',
            input: options,
            error: errorMessage,
        });
        // Throw error to properly fail the workflow
        throw new Error(`Lead invalidation workflow failed: ${errorMessage}`);
    }
}
/**
 * Helper function to check if lead has alternative contact methods
 * Returns true if lead has other ways to be contacted besides the failed method
 */
function hasAlternativeContact(lead, options) {
    const failedEmail = options.email;
    const failedPhone = options.telephone;
    // Check if lead has email that's different from failed email
    const hasValidEmail = lead.email &&
        lead.email.trim() !== '' &&
        (!failedEmail || lead.email !== failedEmail);
    // Check if lead has phone that's different from failed phone
    const hasValidPhone = lead.phone &&
        lead.phone.trim() !== '' &&
        (!failedPhone || lead.phone !== failedPhone);
    console.log(`📋 Alternative contact check for lead ${lead.id}:`);
    console.log(`   - Has valid email: ${hasValidEmail} (current: ${lead.email}, failed: ${failedEmail})`);
    console.log(`   - Has valid phone: ${hasValidPhone} (current: ${lead.phone}, failed: ${failedPhone})`);
    return hasValidEmail || hasValidPhone;
}
