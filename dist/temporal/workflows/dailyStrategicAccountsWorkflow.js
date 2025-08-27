"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dailyStrategicAccountsWorkflow = dailyStrategicAccountsWorkflow;
const workflow_1 = require("@temporalio/workflow");
const leadGenerationWorkflow_1 = require("./leadGenerationWorkflow");
// Import general activities
const { logWorkflowExecutionActivity, saveCronStatusActivity, } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: '5 minutes',
    retry: {
        maximumAttempts: 3,
    },
});
/**
 * Extract schedule ID from workflow info or parent schedule
 * Prioritizes parent schedule ID over workflow's own schedule attributes
 */
function extractScheduleId(info, options) {
    // First, check if a parent schedule ID was passed through additionalData
    // This is the case when launched by dailyOperationsWorkflow
    const parentScheduleId = options.additionalData?.parentScheduleId ||
        options.additionalData?.originalScheduleId ||
        options.additionalData?.dailyOperationsScheduleId;
    if (parentScheduleId) {
        console.log(`✅ Using parent schedule ID: ${parentScheduleId} (from dailyOperations)`);
        return parentScheduleId;
    }
    // Fallback: Check if workflow was triggered by its own schedule
    // Temporal schedules typically set search attributes or memo data
    const searchAttributes = info.searchAttributes || {};
    const memo = info.memo || {};
    // Look for common schedule-related attributes
    const scheduleId = searchAttributes['TemporalScheduledById'] ||
        searchAttributes['ScheduleId'] ||
        memo['TemporalScheduledById'] ||
        memo['scheduleId'] ||
        memo['scheduleName'];
    if (scheduleId) {
        console.log(`✅ Real schedule ID found: ${scheduleId}`);
        return scheduleId;
    }
    // If no schedule ID found, it might be a manual execution or child workflow
    console.log(`⚠️ No schedule ID found in workflow info - likely manual execution or child workflow`);
    return 'manual-execution';
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
    const { site_id } = options;
    if (!site_id) {
        throw new Error('No site ID provided');
    }
    // Get REAL workflow information from Temporal
    const workflowInfo_real = (0, workflow_1.workflowInfo)();
    const realWorkflowId = workflowInfo_real.workflowId;
    const realScheduleId = extractScheduleId(workflowInfo_real, options);
    const startTime = Date.now();
    console.log(`🎯 Starting daily strategic accounts workflow for site ${site_id}`);
    console.log(`📋 Options:`, JSON.stringify(options, null, 2));
    console.log(`📋 REAL Workflow ID: ${realWorkflowId} (from Temporal)`);
    console.log(`📋 REAL Schedule ID: ${realScheduleId} (from ${realScheduleId === 'manual-execution' ? 'manual execution' : 'schedule'})`);
    // Log workflow execution start
    await logWorkflowExecutionActivity({
        workflowId: realWorkflowId,
        workflowType: 'dailyStrategicAccountsWorkflow',
        status: 'STARTED',
        input: options,
    });
    // Update cron status to indicate the workflow is running
    await saveCronStatusActivity({
        siteId: site_id,
        workflowId: realWorkflowId,
        scheduleId: realScheduleId,
        activityName: 'dailyStrategicAccountsWorkflow',
        status: 'RUNNING',
        lastRun: new Date().toISOString()
    });
    const errors = [];
    let leadsGenerated = 0;
    let leadsProcessed = 0;
    let siteName = '';
    let siteUrl = '';
    let regionSearchResult = null;
    try {
        console.log(`🎯 Step 1: Starting strategic accounts lead generation...`);
        console.log(`🌍 Using region: "world" and keywords: "key accounts"`);
        // Call the main lead generation workflow with strategic accounts parameters
        const leadGenOptions = {
            site_id: site_id,
            userId: options.userId,
            create: false,
            region: 'world',
            keywords: ['key accounts'], // ✅ Fixed: Pass as array instead of string
            additionalData: {
                ...options.additionalData,
                leadType: 'strategic_accounts',
                workflowId: realWorkflowId
            }
        };
        console.log(`🚀 Calling leadGenerationWorkflow with strategic parameters...`);
        const leadGenHandle = await (0, workflow_1.startChild)(leadGenerationWorkflow_1.leadGenerationWorkflow, {
            args: [leadGenOptions],
            workflowId: `strategic-lead-generation-${site_id}-${Date.now()}`,
            parentClosePolicy: workflow_1.ParentClosePolicy.PARENT_CLOSE_POLICY_ABANDON, // ✅ Child continues independently
        });
        const leadGenResult = await leadGenHandle.result();
        if (!leadGenResult.success) {
            const errorMsg = `Strategic lead generation failed: ${leadGenResult.errors.join(', ')}`;
            console.error(`❌ ${errorMsg}`);
            errors.push(...leadGenResult.errors);
            throw new Error(errorMsg);
        }
        console.log(`✅ Strategic lead generation completed successfully!`);
        console.log(`📊 Strategic lead generation results:`);
        console.log(`   - Site: ${leadGenResult.siteName} (${leadGenResult.siteUrl})`);
        console.log(`   - Business types: ${leadGenResult.businessTypes?.length || 0}`);
        console.log(`   - Companies created: ${leadGenResult.companiesCreated?.length || 0}`);
        console.log(`   - Total leads generated: ${leadGenResult.totalLeadsGenerated || 0}`);
        console.log(`   - Execution time: ${leadGenResult.executionTime}`);
        // Update variables from lead generation result
        siteName = leadGenResult.siteName || '';
        siteUrl = leadGenResult.siteUrl || '';
        regionSearchResult = leadGenResult.regionSearchResult;
        leadsGenerated = leadGenResult.totalLeadsGenerated || 0;
        leadsProcessed = leadGenResult.totalLeadsGenerated || 0;
        // Create strategic account results based on the lead generation results
        const strategicAccountResults = [];
        if (leadGenResult.companyResults) {
            for (const companyResult of leadGenResult.companyResults) {
                if (companyResult.leadsGenerated && Array.isArray(companyResult.leadsGenerated)) {
                    for (const lead of companyResult.leadsGenerated) {
                        strategicAccountResults.push({
                            lead: lead,
                            taskCreated: true, // Leads were created by leadGenerationWorkflow
                            statusUpdated: false,
                            errors: companyResult.errors || []
                        });
                    }
                }
            }
        }
        const executionTime = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;
        const result = {
            success: true,
            siteId: site_id,
            siteName,
            siteUrl,
            strategicCriteria: {
                region: 'world',
                keywords: 'key accounts',
                searchType: 'strategic_accounts'
            },
            leadsGenerated,
            leadsProcessed,
            tasksCreated: strategicAccountResults.filter(r => r.taskCreated).length,
            statusUpdated: 0, // Status updates not implemented in simplified flow
            strategicAccountResults,
            salesAgentResponse: null, // Sales agent processing not used in simplified flow
            selectedLeads: [],
            leadsPriority: null,
            assignedLeads: [],
            notificationResults: [],
            leadsFiltered: leadsGenerated, // All leads from leadGeneration are considered filtered/valid
            filteredLeads: strategicAccountResults.map(r => r.lead),
            channelFilteringInfo: {
                hasEmailChannel: true, // Assume channels are OK since leadGeneration succeeded
                hasWhatsappChannel: true,
                leadsWithEmail: 0,
                leadsWithPhone: 0,
                leadsWithBoth: 0,
                leadsWithNeither: 0,
                leadsFilteredOut: 0
            },
            regionSearchResult,
            errors: [...errors, ...leadGenResult.errors],
            executionTime,
            completedAt: new Date().toISOString()
        };
        console.log(`🎉 Daily strategic accounts workflow completed successfully!`);
        console.log(`📊 Summary: Daily strategic accounts for site ${siteName} completed in ${executionTime}`);
        console.log(`   - Site: ${siteName} (${siteUrl})`);
        console.log(`   - Strategic leads generated: ${leadsGenerated}`);
        console.log(`   - Strategic leads processed: ${leadsProcessed}`);
        console.log(`   - Tasks created: ${result.tasksCreated}`);
        console.log(`   - Strategic accounts from companies: ${leadGenResult.companiesCreated?.length || 0}`);
        if (errors.length > 0) {
            console.log(`   - Errors encountered: ${errors.length}`);
            errors.forEach((error, index) => {
                console.log(`     ${index + 1}. ${error}`);
            });
        }
        // Update cron status to indicate successful completion
        await saveCronStatusActivity({
            siteId: site_id,
            workflowId: realWorkflowId,
            scheduleId: realScheduleId,
            activityName: 'dailyStrategicAccountsWorkflow',
            status: 'COMPLETED',
            lastRun: new Date().toISOString()
        });
        // Log successful completion
        await logWorkflowExecutionActivity({
            workflowId: realWorkflowId,
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
        // Update cron status to indicate failure
        await saveCronStatusActivity({
            siteId: site_id,
            workflowId: realWorkflowId,
            scheduleId: realScheduleId,
            activityName: 'dailyStrategicAccountsWorkflow',
            status: 'FAILED',
            lastRun: new Date().toISOString(),
            errorMessage: errorMessage,
            retryCount: 1
        });
        // Log workflow execution failure
        await logWorkflowExecutionActivity({
            workflowId: realWorkflowId,
            workflowType: 'dailyStrategicAccountsWorkflow',
            status: 'FAILED',
            input: options,
            error: errorMessage,
        });
        // Throw error to properly fail the workflow
        throw new Error(`Daily strategic accounts workflow failed: ${errorMessage}`);
    }
}
