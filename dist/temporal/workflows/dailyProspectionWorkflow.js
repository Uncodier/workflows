"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dailyProspectionWorkflow = dailyProspectionWorkflow;
const workflow_1 = require("@temporalio/workflow");
// Import specific daily prospection activities
const { getProspectionLeadsActivity, createAwarenessTaskActivity, updateLeadProspectionStatusActivity, } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: '10 minutes', // Longer timeout for prospection processes
    retry: {
        maximumAttempts: 3,
    },
});
// Import general activities
const { logWorkflowExecutionActivity, saveCronStatusActivity, getSiteActivity, } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: '5 minutes',
    retry: {
        maximumAttempts: 3,
    },
});
/**
 * Daily Prospection Workflow
 *
 * Este workflow ejecuta la prospección diaria:
 * 1. Busca leads de más de 48 horas con status 'new' sin tasks en 'awareness'
 * 2. Para cada lead encontrado, crea una tarea de awareness
 * 3. Opcionalmente actualiza el status del lead
 * 4. Retorna estadísticas del proceso
 *
 * @param options - Configuration options for daily prospection
 */
async function dailyProspectionWorkflow(options) {
    const { site_id, hoursThreshold = 48, maxLeads = 50, createTasks = true, updateStatus = false } = options;
    if (!site_id) {
        throw new Error('No site ID provided');
    }
    const workflowId = `daily-prospection-${site_id}`;
    const startTime = Date.now();
    console.log(`🎯 Starting daily prospection workflow for site ${site_id}`);
    console.log(`📋 Options:`, JSON.stringify(options, null, 2));
    // Log workflow execution start
    await logWorkflowExecutionActivity({
        workflowId,
        workflowType: 'dailyProspectionWorkflow',
        status: 'STARTED',
        input: options,
    });
    // Update cron status to indicate the workflow is running
    await saveCronStatusActivity({
        siteId: site_id,
        workflowId,
        scheduleId: `daily-prospection-${site_id}`,
        activityName: 'dailyProspectionWorkflow',
        status: 'RUNNING',
        lastRun: new Date().toISOString()
    });
    const errors = [];
    const prospectionResults = [];
    let leadsFound = 0;
    let leadsProcessed = 0;
    let tasksCreated = 0;
    let statusUpdated = 0;
    let prospectionCriteria = null;
    let siteName = '';
    let siteUrl = '';
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
        console.log(`🔍 Step 2: Getting prospection leads...`);
        // Get leads that need prospection
        const prospectionLeadsResult = await getProspectionLeadsActivity({
            site_id: site_id,
            userId: options.userId || site.user_id,
            hoursThreshold: hoursThreshold,
            additionalData: {
                ...options.additionalData,
                siteName: siteName,
                siteUrl: siteUrl
            }
        });
        if (!prospectionLeadsResult.success) {
            const errorMsg = `Failed to get prospection leads: ${prospectionLeadsResult.error}`;
            console.error(`❌ ${errorMsg}`);
            errors.push(errorMsg);
            throw new Error(errorMsg);
        }
        const leads = prospectionLeadsResult.leads || [];
        leadsFound = leads.length;
        prospectionCriteria = prospectionLeadsResult.criteria;
        console.log(`✅ Found ${leadsFound} leads for prospection`);
        if (leadsFound === 0) {
            console.log(`ℹ️ No leads found for prospection - workflow completed successfully`);
            const result = {
                success: true,
                siteId: site_id,
                siteName,
                siteUrl,
                prospectionCriteria,
                leadsFound: 0,
                leadsProcessed: 0,
                tasksCreated: 0,
                statusUpdated: 0,
                prospectionResults: [],
                errors,
                executionTime: `${((Date.now() - startTime) / 1000).toFixed(2)}s`,
                completedAt: new Date().toISOString()
            };
            // Update cron status to indicate successful completion
            await saveCronStatusActivity({
                siteId: site_id,
                workflowId,
                scheduleId: `daily-prospection-${site_id}`,
                activityName: 'dailyProspectionWorkflow',
                status: 'COMPLETED',
                lastRun: new Date().toISOString()
            });
            // Log successful completion
            await logWorkflowExecutionActivity({
                workflowId,
                workflowType: 'dailyProspectionWorkflow',
                status: 'COMPLETED',
                input: options,
                output: result,
            });
            return result;
        }
        // Limit the number of leads to process if specified
        const leadsToProcess = maxLeads ? leads.slice(0, maxLeads) : leads;
        leadsProcessed = leadsToProcess.length;
        if (maxLeads && leads.length > maxLeads) {
            console.log(`⚠️ Processing only first ${maxLeads} leads out of ${leads.length} found`);
            errors.push(`Limited processing to ${maxLeads} leads (${leads.length} total found)`);
        }
        console.log(`👥 Step 3: Processing ${leadsProcessed} leads for prospection...`);
        // Process each lead
        for (let i = 0; i < leadsToProcess.length; i++) {
            const lead = leadsToProcess[i];
            console.log(`🏢 Processing lead ${i + 1}/${leadsToProcess.length}: ${lead.name || lead.email}`);
            const prospectionResult = {
                lead: lead,
                taskCreated: false,
                statusUpdated: false,
                errors: []
            };
            try {
                // Step 3a: Create awareness task for this lead
                if (createTasks) {
                    console.log(`📝 Step 3a: Creating awareness task for lead: ${lead.name || lead.email}`);
                    const createTaskResult = await createAwarenessTaskActivity({
                        lead_id: lead.id,
                        site_id: site_id,
                        userId: options.userId || site.user_id,
                        title: `Contacto inicial con ${lead.name || lead.email}`,
                        description: `Tarea de prospección para establecer primer contacto con el lead ${lead.name || lead.email}`,
                        scheduled_date: new Date().toISOString(),
                        additionalData: {
                            ...options.additionalData,
                            workflowId: workflowId,
                            prospectionReason: 'daily_prospection_workflow',
                            leadAge: Math.floor((new Date().getTime() - new Date(lead.created_at).getTime()) / (1000 * 60 * 60 * 24))
                        }
                    });
                    if (createTaskResult.success) {
                        prospectionResult.taskCreated = true;
                        prospectionResult.taskId = createTaskResult.taskId;
                        tasksCreated++;
                        console.log(`✅ Successfully created awareness task ${createTaskResult.taskId} for ${lead.name || lead.email}`);
                    }
                    else {
                        const errorMsg = `Failed to create awareness task for ${lead.name || lead.email}: ${createTaskResult.error}`;
                        console.error(`❌ ${errorMsg}`);
                        prospectionResult.errors.push(errorMsg);
                    }
                }
                else {
                    console.log(`ℹ️ Skipping task creation (createTasks=false) for ${lead.name || lead.email}`);
                }
                // Step 3b: Optionally update lead status
                if (updateStatus && prospectionResult.taskCreated) {
                    console.log(`📝 Step 3b: Updating lead status for: ${lead.name || lead.email}`);
                    const updateStatusResult = await updateLeadProspectionStatusActivity({
                        lead_id: lead.id,
                        site_id: site_id,
                        newStatus: 'contacted',
                        userId: options.userId || site.user_id,
                        notes: `Lead incluido en prospección diaria - tarea de awareness creada`
                    });
                    if (updateStatusResult.success) {
                        prospectionResult.statusUpdated = true;
                        statusUpdated++;
                        console.log(`✅ Successfully updated status for ${lead.name || lead.email}`);
                    }
                    else {
                        const errorMsg = `Failed to update status for ${lead.name || lead.email}: ${updateStatusResult.error}`;
                        console.error(`❌ ${errorMsg}`);
                        prospectionResult.errors.push(errorMsg);
                    }
                }
                else if (updateStatus && !prospectionResult.taskCreated) {
                    console.log(`⚠️ Skipping status update for ${lead.name || lead.email} (task not created)`);
                }
                else {
                    console.log(`ℹ️ Skipping status update (updateStatus=false) for ${lead.name || lead.email}`);
                }
            }
            catch (leadError) {
                const errorMessage = leadError instanceof Error ? leadError.message : String(leadError);
                console.error(`❌ Error processing lead ${lead.name || lead.email}: ${errorMessage}`);
                prospectionResult.errors.push(errorMessage);
            }
            prospectionResults.push(prospectionResult);
            console.log(`📊 Completed processing lead ${i + 1}/${leadsToProcess.length}: ${lead.name || lead.email}`);
        }
        const executionTime = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;
        const result = {
            success: true,
            siteId: site_id,
            siteName,
            siteUrl,
            prospectionCriteria,
            leadsFound,
            leadsProcessed,
            tasksCreated,
            statusUpdated,
            prospectionResults,
            errors,
            executionTime,
            completedAt: new Date().toISOString()
        };
        console.log(`🎉 Daily prospection workflow completed successfully!`);
        console.log(`📊 Summary: Daily prospection for site ${siteName} completed in ${executionTime}`);
        console.log(`   - Site: ${siteName} (${siteUrl})`);
        console.log(`   - Leads found: ${leadsFound}`);
        console.log(`   - Leads processed: ${leadsProcessed}`);
        console.log(`   - Tasks created: ${tasksCreated}`);
        console.log(`   - Status updated: ${statusUpdated}`);
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
            scheduleId: `daily-prospection-${site_id}`,
            activityName: 'dailyProspectionWorkflow',
            status: 'COMPLETED',
            lastRun: new Date().toISOString()
        });
        // Log successful completion
        await logWorkflowExecutionActivity({
            workflowId,
            workflowType: 'dailyProspectionWorkflow',
            status: 'COMPLETED',
            input: options,
            output: result,
        });
        return result;
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Daily prospection workflow failed: ${errorMessage}`);
        const executionTime = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;
        // Update cron status to indicate failure
        await saveCronStatusActivity({
            siteId: site_id,
            workflowId,
            scheduleId: `daily-prospection-${site_id}`,
            activityName: 'dailyProspectionWorkflow',
            status: 'FAILED',
            lastRun: new Date().toISOString(),
            errorMessage: errorMessage,
            retryCount: 1
        });
        // Log workflow execution failure
        await logWorkflowExecutionActivity({
            workflowId,
            workflowType: 'dailyProspectionWorkflow',
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
            prospectionCriteria,
            leadsFound,
            leadsProcessed,
            tasksCreated,
            statusUpdated,
            prospectionResults,
            errors: [...errors, errorMessage],
            executionTime,
            completedAt: new Date().toISOString()
        };
        return result;
    }
}
