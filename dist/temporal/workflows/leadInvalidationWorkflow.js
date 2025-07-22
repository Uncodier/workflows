"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.leadInvalidationWorkflow = leadInvalidationWorkflow;
const workflow_1 = require("@temporalio/workflow");
// Define the activity interface and options
const { logWorkflowExecutionActivity, saveCronStatusActivity, getLeadActivity, invalidateLeadActivity, findLeadsBySharedContactActivity, checkCompanyValidLeadsActivity, addCompanyToNullListActivity, getCompanyInfoFromLeadActivity, } = (0, workflow_1.proxyActivities)({
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
 * 4. Finds other leads sharing the same failed contact information
 * 5. Invalidates shared leads and adds metadata for revalidation
 *
 * @param options - Configuration options for lead invalidation
 */
async function leadInvalidationWorkflow(options) {
    const { lead_id, site_id, reason } = options;
    if (!lead_id) {
        throw new Error('No lead ID provided');
    }
    if (!site_id) {
        throw new Error('No site ID provided');
    }
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
    let companyAddedToNullList = false;
    let nullCompanyId;
    let companyInfo = {};
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
        // Step 2: Check if lead has alternative contact methods
        console.log(`🔍 Step 2: Checking for alternative contact methods...`);
        const hasAlternative = hasAlternativeContact(lead, options);
        if (!hasAlternative) {
            console.log(`⚠️ Lead has no alternative contact methods - proceeding with invalidation`);
            // Step 2a: Remove site_id and add invalidation metadata
            console.log(`🚫 Step 2a: Invalidating lead (removing site_id)...`);
            const invalidationResult = await invalidateLeadActivity({
                lead_id: lead_id,
                original_site_id: originalSiteId,
                reason: reason,
                failed_contact: {
                    telephone: options.telephone,
                    email: options.email
                },
                userId: options.userId
            });
            if (invalidationResult.success) {
                leadInvalidated = true;
                console.log(`✅ Lead ${lead_id} invalidated successfully`);
            }
            else {
                const errorMsg = `Failed to invalidate lead: ${invalidationResult.error}`;
                console.error(`❌ ${errorMsg}`);
                errors.push(errorMsg);
            }
        }
        else {
            console.log(`✅ Lead has alternative contact methods - skipping invalidation`);
            console.log(`   - Keeping lead active with current site_id: ${lead.site_id}`);
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
                            shared_with_lead_id: lead_id
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
        // Step 4: Check if company should be added to null companies list
        console.log(`🏢 Step 4: Checking if company should be added to null companies list...`);
        try {
            // First, get company information from the lead
            console.log(`📋 Getting company information from lead ${lead_id}...`);
            const companyInfoResult = await getCompanyInfoFromLeadActivity({
                lead_id: lead_id
            });
            if (companyInfoResult.success && companyInfoResult.company) {
                companyInfo = companyInfoResult.company;
                console.log(`✅ Company info obtained: ${companyInfo.name} in ${companyInfo.city}`);
                // Only proceed if we have both company name and city
                if (companyInfo.name && companyInfo.city) {
                    console.log(`🔍 Checking if company ${companyInfo.name} has any valid leads remaining...`);
                    // Check if company has any valid leads remaining
                    const validLeadsResult = await checkCompanyValidLeadsActivity({
                        company_name: companyInfo.name,
                        company_id: companyInfo.id,
                        site_id: site_id,
                        exclude_lead_id: lead_id // Exclude the current lead being invalidated
                    });
                    if (validLeadsResult.success) {
                        console.log(`📊 Company ${companyInfo.name} validation results:`);
                        console.log(`   - Total leads: ${validLeadsResult.totalLeads}`);
                        console.log(`   - Valid leads remaining: ${validLeadsResult.validLeads}`);
                        console.log(`   - Has valid leads: ${validLeadsResult.hasValidLeads}`);
                        if (!validLeadsResult.hasValidLeads) {
                            console.log(`🚫 No valid leads remaining for ${companyInfo.name} - adding to null companies list...`);
                            // Add company to null companies list
                            const nullCompanyResult = await addCompanyToNullListActivity({
                                company_name: companyInfo.name,
                                company_id: companyInfo.id,
                                city: companyInfo.city,
                                site_id: site_id,
                                reason: reason,
                                failed_contact: {
                                    telephone: options.telephone,
                                    email: options.email
                                },
                                userId: options.userId,
                                total_leads_invalidated: 1 + invalidatedSharedLeads, // Current lead + shared leads
                                original_lead_id: lead_id
                            });
                            if (nullCompanyResult.success) {
                                companyAddedToNullList = true;
                                nullCompanyId = nullCompanyResult.nullCompanyId;
                                console.log(`✅ Company ${companyInfo.name} successfully added to null companies list for ${companyInfo.city}`);
                            }
                            else {
                                const errorMsg = `Failed to add company to null list: ${nullCompanyResult.error}`;
                                console.error(`❌ ${errorMsg}`);
                                errors.push(errorMsg);
                            }
                        }
                        else {
                            console.log(`✅ Company ${companyInfo.name} still has ${validLeadsResult.validLeads} valid leads - keeping active`);
                        }
                    }
                    else {
                        const errorMsg = `Failed to check company valid leads: ${validLeadsResult.error}`;
                        console.error(`❌ ${errorMsg}`);
                        errors.push(errorMsg);
                    }
                }
                else {
                    console.log(`⚠️ Missing company name or city information - skipping null company check`);
                    console.log(`   - Company name: ${companyInfo.name || 'N/A'}`);
                    console.log(`   - Company city: ${companyInfo.city || 'N/A'}`);
                }
            }
            else {
                const errorMsg = `Failed to get company information: ${companyInfoResult.error}`;
                console.error(`⚠️ ${errorMsg}`);
                errors.push(errorMsg);
            }
        }
        catch (companyError) {
            const errorMessage = companyError instanceof Error ? companyError.message : String(companyError);
            console.error(`⚠️ Exception during company null list check: ${errorMessage}`);
            errors.push(`Company null list check exception: ${errorMessage}`);
        }
        const executionTime = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;
        const result = {
            success: true,
            leadId: lead_id,
            originalSiteId,
            invalidatedLead: leadInvalidated,
            sharedContactLeads,
            invalidatedSharedLeads,
            companyAddedToNullList,
            nullCompanyId,
            companyInfo,
            reason,
            errors,
            executionTime,
            completedAt: new Date().toISOString()
        };
        console.log(`🎉 Lead invalidation workflow completed successfully!`);
        console.log(`📊 Summary: Lead ${lead_id} - Invalidated: ${leadInvalidated}, Shared leads: ${invalidatedSharedLeads}`);
        if (companyAddedToNullList && companyInfo.name) {
            console.log(`🚫 Company "${companyInfo.name}" added to null companies list for ${companyInfo.city}`);
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
        const executionTime = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;
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
        // Return failed result instead of throwing to provide more information
        const result = {
            success: false,
            leadId: lead_id,
            originalSiteId,
            invalidatedLead: leadInvalidated,
            sharedContactLeads,
            invalidatedSharedLeads,
            companyAddedToNullList,
            nullCompanyId,
            companyInfo,
            reason,
            errors: [...errors, errorMessage],
            executionTime,
            completedAt: new Date().toISOString()
        };
        return result;
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
