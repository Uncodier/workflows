"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dailyStrategicAccountsWorkflow = dailyStrategicAccountsWorkflow;
const workflow_1 = require("@temporalio/workflow");
// Import specific daily strategic accounts activities
const { validateCommunicationChannelsActivity, checkLeadExistingTasksActivity, updateLeadProspectionStatusActivity, sendLeadsToSalesAgentActivity, assignPriorityLeadsActivity, callRegionSearchApiActivity, } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: '10 minutes', // Longer timeout for strategic account processes
    retry: {
        maximumAttempts: 3,
    },
});
// Import general activities
const { logWorkflowExecutionActivity, saveCronStatusActivity, getSiteActivity, startLeadFollowUpWorkflowActivity, } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: '5 minutes',
    retry: {
        maximumAttempts: 3,
    },
});
/**
 * Filter leads based on available communication channels
 * Only includes leads that have contact info compatible with enabled channels
 */
function filterLeadsByAvailableChannels(leads, channelsValidation) {
    const { hasEmailChannel, hasWhatsappChannel } = channelsValidation;
    const warnings = [];
    if (!hasEmailChannel && !hasWhatsappChannel) {
        return {
            filteredLeads: [],
            filteringInfo: {
                hasEmailChannel: false,
                hasWhatsappChannel: false,
                leadsWithEmail: 0,
                leadsWithPhone: 0,
                leadsWithBoth: 0,
                leadsWithNeither: 0,
                leadsFilteredOut: leads.length
            },
            warnings: ['No communication channels available - all leads filtered out']
        };
    }
    let leadsWithEmail = 0;
    let leadsWithPhone = 0;
    let leadsWithBoth = 0;
    let leadsWithNeither = 0;
    let leadsFilteredOut = 0;
    const filteredLeads = leads.filter((lead) => {
        const hasEmail = lead.email && typeof lead.email === 'string' && lead.email.trim() !== '';
        const hasPhone = lead.phone && typeof lead.phone === 'string' && lead.phone.trim() !== '';
        // Count contact info types
        if (hasEmail && hasPhone) {
            leadsWithBoth++;
        }
        else if (hasEmail) {
            leadsWithEmail++;
        }
        else if (hasPhone) {
            leadsWithPhone++;
        }
        else {
            leadsWithNeither++;
        }
        // Filter logic: lead must have at least one channel that matches site's enabled channels
        const canContactViaEmail = hasEmail && hasEmailChannel;
        const canContactViaWhatsapp = hasPhone && hasWhatsappChannel;
        const shouldInclude = canContactViaEmail || canContactViaWhatsapp;
        if (!shouldInclude) {
            leadsFilteredOut++;
            const contactInfo = [];
            if (hasEmail)
                contactInfo.push('email');
            if (hasPhone)
                contactInfo.push('phone');
            if (contactInfo.length === 0)
                contactInfo.push('no contact info');
            console.log(`🚫 Filtering out strategic lead ${lead.name || lead.email || lead.id}: has ${contactInfo.join(' & ')} but site only supports ${hasEmailChannel ? 'email' : ''}${hasEmailChannel && hasWhatsappChannel ? ' & ' : ''}${hasWhatsappChannel ? 'WhatsApp' : ''}`);
        }
        return shouldInclude;
    });
    const filteringInfo = {
        hasEmailChannel,
        hasWhatsappChannel,
        leadsWithEmail,
        leadsWithPhone,
        leadsWithBoth,
        leadsWithNeither,
        leadsFilteredOut
    };
    // Add warnings for common filtering scenarios
    if (leadsFilteredOut > 0) {
        warnings.push(`${leadsFilteredOut} strategic lead(s) filtered out due to incompatible contact channels`);
    }
    if (leadsWithNeither > 0) {
        warnings.push(`${leadsWithNeither} strategic lead(s) had no contact information (email or phone)`);
    }
    if (!hasEmailChannel && leadsWithEmail > 0) {
        warnings.push(`${leadsWithEmail} strategic lead(s) had email but email channel is not enabled`);
    }
    if (!hasWhatsappChannel && leadsWithPhone > 0) {
        warnings.push(`${leadsWithPhone} strategic lead(s) had phone but WhatsApp channel is not enabled`);
    }
    return { filteredLeads, filteringInfo, warnings };
}
/**
 * Daily Strategic Accounts Workflow
 *
 * Este workflow ejecuta la prospección de cuentas estratégicas:
 * 1. Genera leads de las mejores capitales del mundo usando regionSearch con region "world" y keywords "key accounts"
 * 2. Filtra los leads por canales de comunicación disponibles
 * 3. Envía leads al agente de ventas para selección y priorización
 * 4. Procesa cada lead seleccionado
 * 5. Inicia workflows de seguimiento para leads no asignados a humanos
 *
 * @param options - Configuration options for daily strategic accounts
 */
async function dailyStrategicAccountsWorkflow(options) {
    const { site_id, maxLeads = 100, createTasks = true, updateStatus = false } = options;
    if (!site_id) {
        throw new Error('No site ID provided');
    }
    const workflowId = `daily-strategic-accounts-${site_id}`;
    const startTime = Date.now();
    console.log(`🎯 Starting daily strategic accounts workflow for site ${site_id}`);
    console.log(`📋 Options:`, JSON.stringify(options, null, 2));
    // Log workflow execution start
    await logWorkflowExecutionActivity({
        workflowId,
        workflowType: 'dailyStrategicAccountsWorkflow',
        status: 'STARTED',
        input: options,
    });
    // Update cron status to indicate the workflow is running
    await saveCronStatusActivity({
        siteId: site_id,
        workflowId,
        scheduleId: `daily-strategic-accounts-${site_id}`,
        activityName: 'dailyStrategicAccountsWorkflow',
        status: 'RUNNING',
        lastRun: new Date().toISOString()
    });
    const errors = [];
    const strategicAccountResults = [];
    let leadsGenerated = 0;
    let leadsProcessed = 0;
    const tasksCreated = 0;
    let statusUpdated = 0;
    const strategicCriteria = {
        region: 'world',
        keywords: 'key accounts',
        searchType: 'strategic_accounts'
    };
    let siteName = '';
    let siteUrl = '';
    let salesAgentResponse = null;
    let selectedLeads = [];
    let leadsPriority = null;
    let assignedLeads = [];
    let notificationResults = [];
    let regionSearchResult = null;
    // Channel filtering variables
    let leadsFiltered = 0;
    let leads = [];
    let filteringInfo = {
        hasEmailChannel: false,
        hasWhatsappChannel: false,
        leadsWithEmail: 0,
        leadsWithPhone: 0,
        leadsWithBoth: 0,
        leadsWithNeither: 0,
        leadsFilteredOut: 0
    };
    try {
        console.log(`📡 Step 0: Validating communication channels for ${site_id}...`);
        // Validate that the site has email or WhatsApp channels configured
        const channelsValidation = await validateCommunicationChannelsActivity({
            site_id: site_id
        });
        if (!channelsValidation.success) {
            const errorMsg = `Failed to validate communication channels: ${channelsValidation.error}`;
            console.error(`❌ ${errorMsg}`);
            errors.push(errorMsg);
            throw new Error(errorMsg);
        }
        if (!channelsValidation.hasAnyChannel) {
            const errorMsg = `No communication channels (email or WhatsApp) are configured and enabled for site ${site_id}. Strategic accounts prospection requires at least one communication channel to send follow-up messages.`;
            console.error(`❌ ${errorMsg}`);
            errors.push(errorMsg);
            // Return early failure instead of throwing to provide detailed information
            const result = {
                success: false,
                siteId: site_id,
                siteName: '',
                siteUrl: '',
                strategicCriteria: undefined,
                leadsGenerated: 0,
                leadsProcessed: 0,
                tasksCreated: 0,
                statusUpdated: 0,
                strategicAccountResults: [],
                salesAgentResponse: null,
                selectedLeads: [],
                leadsPriority: null,
                assignedLeads: [],
                notificationResults: [],
                followUpWorkflowsStarted: 0,
                followUpResults: [],
                unassignedLeads: [],
                errors: [errorMsg],
                executionTime: `${((Date.now() - startTime) / 1000).toFixed(2)}s`,
                completedAt: new Date().toISOString()
            };
            // Update cron status to indicate validation failure
            await saveCronStatusActivity({
                siteId: site_id,
                workflowId,
                scheduleId: `daily-strategic-accounts-${site_id}`,
                activityName: 'dailyStrategicAccountsWorkflow',
                status: 'FAILED',
                lastRun: new Date().toISOString(),
                errorMessage: errorMsg,
                retryCount: 1
            });
            // Log workflow execution failure
            await logWorkflowExecutionActivity({
                workflowId,
                workflowType: 'dailyStrategicAccountsWorkflow',
                status: 'FAILED',
                input: options,
                error: errorMsg,
            });
            return result;
        }
        console.log(`✅ Communication channels validated successfully:`);
        console.log(`   - Email channel: ${channelsValidation.hasEmailChannel ? 'Available' : 'Not configured'}`);
        console.log(`   - WhatsApp channel: ${channelsValidation.hasWhatsappChannel ? 'Available' : 'Not configured'}`);
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
        console.log(`🌍 Step 2: Generating strategic accounts using region search...`);
        // Call region search API to generate strategic accounts leads
        const regionSearchOptions = {
            site_id: site_id,
            userId: options.userId || site.user_id,
            additionalData: {
                ...options.additionalData,
                siteName: siteName,
                siteUrl: siteUrl,
                region: 'world',
                keywords: 'key accounts',
                searchType: 'strategic_accounts',
                workflowId: workflowId
            }
        };
        regionSearchResult = await callRegionSearchApiActivity(regionSearchOptions);
        if (!regionSearchResult.success) {
            const errorMsg = `Failed to generate strategic accounts: ${regionSearchResult.error}`;
            console.error(`❌ ${errorMsg}`);
            errors.push(errorMsg);
            throw new Error(errorMsg);
        }
        // Extract leads from region search result
        const rawLeads = regionSearchResult.leads || regionSearchResult.data?.leads || [];
        leadsGenerated = rawLeads.length;
        console.log(`✅ Generated ${leadsGenerated} strategic account leads from world capitals`);
        console.log(`📊 Region search result:`, JSON.stringify(regionSearchResult, null, 2));
        // Step 2.1: Filter leads by available communication channels
        console.log(`🔍 Step 2.1: Filtering strategic leads by available communication channels...`);
        const { filteredLeads, filteringInfo: channelFilteringInfo, warnings } = filterLeadsByAvailableChannels(rawLeads, channelsValidation);
        // Update variables that are declared at workflow scope
        filteringInfo = channelFilteringInfo;
        leads = filteredLeads;
        leadsFiltered = filteredLeads.length;
        const leadsFilteredOut = leadsGenerated - leadsFiltered;
        console.log(`📊 Channel filtering results for strategic accounts:`);
        console.log(`   - Original strategic leads generated: ${leadsGenerated}`);
        console.log(`   - Strategic leads after filtering: ${leadsFiltered}`);
        console.log(`   - Strategic leads filtered out: ${leadsFilteredOut}`);
        console.log(`   - Strategic leads with email only: ${filteringInfo.leadsWithEmail}`);
        console.log(`   - Strategic leads with phone only: ${filteringInfo.leadsWithPhone}`);
        console.log(`   - Strategic leads with both: ${filteringInfo.leadsWithBoth}`);
        console.log(`   - Strategic leads with neither: ${filteringInfo.leadsWithNeither}`);
        // Add filtering warnings to errors array
        warnings.forEach(warning => {
            console.log(`⚠️ Strategic channel filtering warning: ${warning}`);
            errors.push(warning);
        });
        // Step 2.5: Send strategic leads to sales agent for selection and prioritization
        if (leadsFiltered > 0) {
            console.log(`🎯 Step 2.5: Sending strategic leads to sales agent for selection and prioritization...`);
            const salesAgentResult = await sendLeadsToSalesAgentActivity({
                site_id: site_id,
                leads: leads,
                userId: options.userId || site.user_id,
                additionalData: {
                    ...options.additionalData,
                    siteName: siteName,
                    siteUrl: siteUrl,
                    workflowId: workflowId,
                    leadType: 'strategic_accounts',
                    searchCriteria: strategicCriteria
                }
            });
            if (salesAgentResult.success) {
                salesAgentResponse = salesAgentResult.response;
                selectedLeads = salesAgentResult.selectedLeads || [];
                leadsPriority = salesAgentResult.priority;
                console.log(`✅ Sales agent processed ${leads.length} strategic leads and selected ${selectedLeads.length} for prioritization`);
                // Step 2.6: Assign priority strategic leads based on sales agent response
                console.log(`📋 Step 2.6: Assigning priority strategic leads based on sales agent recommendations...`);
                const assignmentResult = await assignPriorityLeadsActivity({
                    site_id: site_id,
                    salesAgentResponse: salesAgentResponse,
                    userId: options.userId || site.user_id,
                    additionalData: {
                        ...options.additionalData,
                        siteName: siteName,
                        siteUrl: siteUrl,
                        workflowId: workflowId,
                        leadType: 'strategic_accounts'
                    }
                });
                if (assignmentResult.success) {
                    assignedLeads = assignmentResult.assignedLeads || [];
                    notificationResults = assignmentResult.notificationResults || [];
                    console.log(`✅ Strategic lead assignment completed: ${assignedLeads.length} leads assigned`);
                    console.log(`📧 Notifications sent: ${notificationResults.filter(r => r.success).length}/${notificationResults.length} successful`);
                }
                else {
                    const errorMsg = `Strategic lead assignment failed: ${assignmentResult.error}`;
                    console.error(`❌ ${errorMsg}`);
                    errors.push(errorMsg);
                    console.log(`⚠️ Continuing with strategic prospection despite assignment failure`);
                }
            }
            else {
                const errorMsg = `Sales agent processing failed for strategic leads: ${salesAgentResult.error}`;
                console.error(`❌ ${errorMsg}`);
                errors.push(errorMsg);
                // Continue with all leads if sales agent fails
                selectedLeads = leads;
                console.log(`⚠️ Continuing with all ${leads.length} strategic leads due to sales agent failure`);
            }
        }
        if (leadsFiltered === 0) {
            const reason = leadsGenerated === 0 ? 'No strategic leads generated' : 'All strategic leads filtered out due to incompatible communication channels';
            console.log(`ℹ️ ${reason} - workflow completed successfully`);
            const result = {
                success: true,
                siteId: site_id,
                siteName,
                siteUrl,
                strategicCriteria,
                leadsGenerated,
                leadsProcessed: 0,
                tasksCreated: 0,
                statusUpdated: 0,
                strategicAccountResults: [],
                salesAgentResponse,
                selectedLeads,
                leadsPriority,
                assignedLeads,
                notificationResults,
                leadsFiltered,
                filteredLeads: leads,
                channelFilteringInfo: filteringInfo,
                regionSearchResult,
                errors,
                executionTime: `${((Date.now() - startTime) / 1000).toFixed(2)}s`,
                completedAt: new Date().toISOString()
            };
            // Update cron status to indicate successful completion
            await saveCronStatusActivity({
                siteId: site_id,
                workflowId,
                scheduleId: `daily-strategic-accounts-${site_id}`,
                activityName: 'dailyStrategicAccountsWorkflow',
                status: 'COMPLETED',
                lastRun: new Date().toISOString()
            });
            // Log successful completion
            await logWorkflowExecutionActivity({
                workflowId,
                workflowType: 'dailyStrategicAccountsWorkflow',
                status: 'COMPLETED',
                input: options,
                output: result,
            });
            return result;
        }
        // Use selected leads from sales agent, or fall back to all leads if no selection
        const leadsToSelect = selectedLeads.length > 0 ? selectedLeads : leads;
        // Limit the number of leads to process if specified
        const leadsToProcess = maxLeads ? leadsToSelect.slice(0, maxLeads) : leadsToSelect;
        leadsProcessed = leadsToProcess.length;
        if (maxLeads && leadsToSelect.length > maxLeads) {
            console.log(`⚠️ Processing only first ${maxLeads} strategic leads out of ${leadsToSelect.length} selected by sales agent`);
            errors.push(`Limited processing to ${maxLeads} strategic leads (${leadsToSelect.length} total selected)`);
        }
        console.log(`👥 Step 3: Processing ${leadsProcessed} strategic leads...`);
        console.log(`   - Total strategic leads generated: ${leadsGenerated}`);
        console.log(`   - Selected by sales agent: ${selectedLeads.length}`);
        console.log(`   - Final strategic leads to process: ${leadsProcessed}`);
        // Process each strategic lead
        for (let i = 0; i < leadsToProcess.length; i++) {
            const lead = leadsToProcess[i];
            console.log(`🏢 Processing strategic lead ${i + 1}/${leadsToProcess.length}: ${lead.name || lead.email}`);
            const strategicResult = {
                lead: lead,
                taskCreated: false,
                statusUpdated: false,
                errors: []
            };
            try {
                // Step 3a: Check if lead already has tasks before creating new one
                if (createTasks) {
                    console.log(`🔍 Step 3a.1: Checking existing tasks for strategic lead: ${lead.name || lead.email}`);
                    const existingTasksCheck = await checkLeadExistingTasksActivity({
                        lead_id: lead.id,
                        site_id: site_id
                    });
                    if (!existingTasksCheck.success) {
                        const errorMsg = `Failed to check existing tasks for strategic lead ${lead.name || lead.email}: ${existingTasksCheck.error}`;
                        console.error(`❌ ${errorMsg}`);
                        strategicResult.errors.push(errorMsg);
                    }
                    else if (existingTasksCheck.hasExistingTasks) {
                        // Lead already has tasks, skip creating new one
                        console.log(`⚠️ Strategic lead ${lead.name || lead.email} already has ${existingTasksCheck.existingTasks.length} existing task(s) - skipping task creation`);
                        strategicResult.taskCreated = false;
                        strategicResult.errors.push(`Skipped: Strategic lead already has ${existingTasksCheck.existingTasks.length} existing task(s)`);
                    }
                    else {
                        // Lead has no existing tasks - task creation disabled
                        console.log(`📝 Step 3a.2: Task creation disabled for strategic lead: ${lead.name || lead.email} (no existing tasks found)`);
                        strategicResult.taskCreated = false;
                        strategicResult.errors.push(`Task creation disabled - would have created strategic awareness task`);
                    }
                }
                else {
                    console.log(`ℹ️ Skipping task creation (createTasks=false) for strategic lead ${lead.name || lead.email}`);
                }
                // Step 3b: Optionally update lead status
                if (updateStatus && strategicResult.taskCreated) {
                    console.log(`📝 Step 3b: Updating strategic lead status for: ${lead.name || lead.email}`);
                    const updateStatusResult = await updateLeadProspectionStatusActivity({
                        lead_id: lead.id,
                        site_id: site_id,
                        newStatus: 'contacted',
                        userId: options.userId || site.user_id,
                        notes: `Strategic lead included in daily strategic accounts prospection - awareness task created`
                    });
                    if (updateStatusResult.success) {
                        strategicResult.statusUpdated = true;
                        statusUpdated++;
                        console.log(`✅ Successfully updated status for strategic lead ${lead.name || lead.email}`);
                    }
                    else {
                        const errorMsg = `Failed to update status for strategic lead ${lead.name || lead.email}: ${updateStatusResult.error}`;
                        console.error(`❌ ${errorMsg}`);
                        strategicResult.errors.push(errorMsg);
                    }
                }
                else if (updateStatus && !strategicResult.taskCreated) {
                    console.log(`⚠️ Skipping status update for strategic lead ${lead.name || lead.email} (task not created)`);
                }
                else {
                    console.log(`ℹ️ Skipping status update (updateStatus=false) for strategic lead ${lead.name || lead.email}`);
                }
            }
            catch (leadError) {
                const errorMessage = leadError instanceof Error ? leadError.message : String(leadError);
                console.error(`❌ Error processing strategic lead ${lead.name || lead.email}: ${errorMessage}`);
                strategicResult.errors.push(errorMessage);
            }
            strategicAccountResults.push(strategicResult);
            console.log(`📊 Completed processing strategic lead ${i + 1}/${leadsToProcess.length}: ${lead.name || lead.email}`);
        }
        const executionTime = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;
        const result = {
            success: true,
            siteId: site_id,
            siteName,
            siteUrl,
            strategicCriteria,
            leadsGenerated,
            leadsProcessed,
            tasksCreated,
            statusUpdated,
            strategicAccountResults,
            salesAgentResponse,
            selectedLeads,
            leadsPriority,
            assignedLeads,
            notificationResults,
            leadsFiltered,
            filteredLeads: leads,
            channelFilteringInfo: filteringInfo,
            regionSearchResult,
            errors,
            executionTime,
            completedAt: new Date().toISOString()
        };
        // Step 7: Start follow-up workflows for strategic leads not assigned to humans
        console.log(`🔄 Step 7: Starting follow-up workflows for unassigned strategic leads...`);
        // Identify strategic leads that were NOT assigned to humans
        const assignedLeadIds = assignedLeads.map((lead) => lead.id || lead.lead_id);
        const unassignedLeads = leadsToProcess.filter((lead) => !assignedLeadIds.includes(lead.id));
        console.log(`📊 Strategic follow-up analysis:`);
        console.log(`   - Total strategic leads processed: ${leadsToProcess.length}`);
        console.log(`   - Strategic leads assigned to humans: ${assignedLeads.length}`);
        console.log(`   - Strategic leads requiring follow-up: ${unassignedLeads.length}`);
        const followUpResults = [];
        let followUpWorkflowsStarted = 0;
        if (unassignedLeads.length > 0) {
            console.log(`🚀 Starting strategic lead follow-up workflows for ${unassignedLeads.length} unassigned strategic leads...`);
            for (const lead of unassignedLeads) {
                try {
                    console.log(`📞 Starting follow-up workflow for strategic lead: ${lead.name || lead.email} (ID: ${lead.id})`);
                    const followUpResult = await startLeadFollowUpWorkflowActivity({
                        lead_id: lead.id,
                        site_id: site_id,
                        userId: options.userId || site.user_id,
                        additionalData: {
                            triggeredBy: 'dailyStrategicAccountsWorkflow',
                            reason: 'strategic_lead_not_assigned_to_human',
                            prospectionDate: new Date().toISOString(),
                            originalWorkflowId: workflowId,
                            leadType: 'strategic_account',
                            leadInfo: {
                                name: lead.name,
                                email: lead.email,
                                company: lead.company
                            }
                        }
                    });
                    if (followUpResult.success) {
                        followUpWorkflowsStarted++;
                        console.log(`✅ Follow-up workflow started for strategic lead ${lead.name || lead.email}: ${followUpResult.workflowId}`);
                        followUpResults.push({
                            lead_id: lead.id,
                            lead_name: lead.name || lead.email,
                            success: true,
                            workflowId: followUpResult.workflowId
                        });
                    }
                    else {
                        const errorMsg = `Failed to start follow-up workflow for strategic lead ${lead.name || lead.email}: ${followUpResult.error}`;
                        console.error(`❌ ${errorMsg}`);
                        errors.push(errorMsg);
                        followUpResults.push({
                            lead_id: lead.id,
                            lead_name: lead.name || lead.email,
                            success: false,
                            error: followUpResult.error
                        });
                    }
                }
                catch (followUpError) {
                    const errorMessage = followUpError instanceof Error ? followUpError.message : String(followUpError);
                    const errorMsg = `Exception starting follow-up workflow for strategic lead ${lead.name || lead.email}: ${errorMessage}`;
                    console.error(`❌ ${errorMsg}`);
                    errors.push(errorMsg);
                    followUpResults.push({
                        lead_id: lead.id,
                        lead_name: lead.name || lead.email,
                        success: false,
                        error: errorMessage
                    });
                }
            }
            console.log(`✅ Strategic follow-up workflows completed: ${followUpWorkflowsStarted}/${unassignedLeads.length} started successfully`);
        }
        else {
            console.log(`ℹ️ No strategic follow-up workflows needed (all strategic leads were assigned to humans or no leads processed)`);
        }
        // Update result with follow-up information
        result.followUpWorkflowsStarted = followUpWorkflowsStarted;
        result.followUpResults = followUpResults;
        result.unassignedLeads = unassignedLeads;
        console.log(`🎉 Daily strategic accounts workflow completed successfully!`);
        console.log(`📊 Summary: Daily strategic accounts for site ${siteName} completed in ${executionTime}`);
        console.log(`   - Site: ${siteName} (${siteUrl})`);
        console.log(`   - Strategic leads generated: ${leadsGenerated}`);
        console.log(`   - Strategic leads after channel filtering: ${leadsFiltered} (${leadsGenerated - leadsFiltered} filtered out)`);
        console.log(`   - Strategic leads processed: ${leadsProcessed}`);
        console.log(`   - Tasks created: ${tasksCreated}`);
        console.log(`   - Status updated: ${statusUpdated}`);
        console.log(`   - Strategic leads assigned: ${assignedLeads.length}`);
        console.log(`   - Notifications sent: ${notificationResults.filter(r => r.success).length}/${notificationResults.length}`);
        console.log(`   - Strategic follow-up workflows started: ${followUpWorkflowsStarted}/${unassignedLeads.length}`);
        console.log(`   - Unassigned strategic leads (auto follow-up): ${unassignedLeads.length}`);
        if (errors.length > 0) {
            console.log(`   - Errors encountered: ${errors.length}`);
            errors.forEach((error, index) => {
                console.log(`     ${index + 1}. ${error}`);
            });
        }
        // Update cron status to indicate successful completion
        await saveCronStatusActivity({
            siteId: site_id,
            workflowId,
            scheduleId: `daily-strategic-accounts-${site_id}`,
            activityName: 'dailyStrategicAccountsWorkflow',
            status: 'COMPLETED',
            lastRun: new Date().toISOString()
        });
        // Log successful completion
        await logWorkflowExecutionActivity({
            workflowId,
            workflowType: 'dailyStrategicAccountsWorkflow',
            status: 'COMPLETED',
            input: options,
            output: result,
        });
        return result;
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Daily strategic accounts workflow failed: ${errorMessage}`);
        const executionTime = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;
        // Update cron status to indicate failure
        await saveCronStatusActivity({
            siteId: site_id,
            workflowId,
            scheduleId: `daily-strategic-accounts-${site_id}`,
            activityName: 'dailyStrategicAccountsWorkflow',
            status: 'FAILED',
            lastRun: new Date().toISOString(),
            errorMessage: errorMessage,
            retryCount: 1
        });
        // Log workflow execution failure
        await logWorkflowExecutionActivity({
            workflowId,
            workflowType: 'dailyStrategicAccountsWorkflow',
            status: 'FAILED',
            input: options,
            error: errorMessage,
        });
        // Return failed result instead of throwing to provide more information
        const result = {
            success: false,
            siteId: site_id,
            siteName,
            siteUrl,
            strategicCriteria,
            leadsGenerated,
            leadsProcessed,
            tasksCreated,
            statusUpdated,
            strategicAccountResults,
            salesAgentResponse,
            selectedLeads,
            leadsPriority,
            assignedLeads,
            notificationResults,
            // Add follow-up fields with default values for error case
            followUpWorkflowsStarted: 0,
            followUpResults: [],
            unassignedLeads: [],
            // Add channel filtering fields
            leadsFiltered,
            filteredLeads: leads,
            channelFilteringInfo: filteringInfo,
            regionSearchResult,
            errors: [...errors, errorMessage],
            executionTime,
            completedAt: new Date().toISOString()
        };
        return result;
    }
}
