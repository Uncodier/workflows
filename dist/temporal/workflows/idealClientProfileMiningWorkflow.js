"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.idealClientProfileMiningWorkflow = idealClientProfileMiningWorkflow;
const workflow_1 = require("@temporalio/workflow");
const idealClientProfilePageSearchWorkflow_1 = require("./idealClientProfilePageSearchWorkflow");
const selectIcp_1 = require("./icpMining/selectIcp");
const processSingle_1 = require("./icpMining/processSingle");
// Generic supabase and logging activities
const { logWorkflowExecutionActivity, saveCronStatusActivity, validateWorkflowConfigActivity, } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: '5 minutes',
    retry: { maximumAttempts: 3 },
});
// DB activities for ICP mining orchestration
const { getIcpMiningByIdActivity, getPendingIcpMiningActivity, markIcpMiningStartedActivity, updateIcpMiningProgressActivity, markIcpMiningCompletedActivity, getSiteActivity, } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: '10 minutes',
    retry: { maximumAttempts: 3 },
});
/**
 * Orchestrator workflow for ICP mining
 * Iterates through pages using idealClientProfilePageSearchWorkflow until target is reached
 */
async function idealClientProfileMiningWorkflow(options) {
    const workflowId = `icp-mining-${options.icp_mining_id || 'batch'}`;
    const maxPages = options.maxPages ?? 300;
    const pageSize = options.pageSize ?? 20;
    const targetLeadsWithEmail = options.targetLeadsWithEmail ?? 150;
    const errors = [];
    // STEP 0: Validate workflow configuration
    console.log('🔐 Step 0: Validating workflow configuration...');
    const configValidation = await validateWorkflowConfigActivity(options.site_id, 'icp_lead_generation');
    if (!configValidation.shouldExecute) {
        console.log(`⛔ Workflow execution blocked: ${configValidation.reason}`);
        // Log blocked execution
        await logWorkflowExecutionActivity({
            workflowId,
            workflowType: 'idealClientProfileMiningWorkflow',
            status: 'BLOCKED',
            input: options,
            error: `Workflow is ${configValidation.activityStatus} in site settings`,
        });
        return {
            success: false,
            icp_mining_id: options.icp_mining_id || 'unknown',
            processed: 0,
            foundMatches: 0,
            errors: [`Workflow is ${configValidation.activityStatus} in site settings`],
        };
    }
    console.log(`✅ Configuration validated: ${configValidation.reason}`);
    await logWorkflowExecutionActivity({
        workflowId,
        workflowType: 'idealClientProfileMiningWorkflow',
        status: 'STARTED',
        input: options,
    });
    await saveCronStatusActivity({
        siteId: options.site_id,
        workflowId,
        scheduleId: workflowId,
        activityName: 'idealClientProfileMiningWorkflow',
        status: 'RUNNING',
        lastRun: new Date().toISOString(),
    });
    // Get site information to extract user_id if not provided
    let actualUserId = options.userId;
    if (!actualUserId) {
        const siteResult = await getSiteActivity(options.site_id);
        if (!siteResult.success || !siteResult.site) {
            const errorMsg = `Failed to get site information: ${siteResult.error}`;
            errors.push(errorMsg);
            await logWorkflowExecutionActivity({
                workflowId,
                workflowType: 'idealClientProfileMiningWorkflow',
                status: 'FAILED',
                input: options,
                output: { error: errorMsg },
            });
            return {
                success: false,
                icp_mining_id: options.icp_mining_id || 'batch',
                processed: 0,
                foundMatches: 0,
                errors: [errorMsg],
            };
        }
        actualUserId = siteResult.site.user_id;
    }
    // Helper to process a single ICP mining record (moved to separate module)
    // Decide processing mode: single id or batch pending
    const isBatch = !options.icp_mining_id || options.icp_mining_id === 'ALL';
    if (!isBatch) {
        // Single processing path
        const icpRes = await getIcpMiningByIdActivity(options.icp_mining_id);
        if (!icpRes.success || !icpRes.icp) {
            const msg = icpRes.error || 'icp_mining not found';
            errors.push(msg);
            await markIcpMiningCompletedActivity({
                id: options.icp_mining_id,
                failed: true,
                last_error: msg,
            });
            return {
                success: false,
                icp_mining_id: options.icp_mining_id,
                processed: 0,
                foundMatches: 0,
                errors,
            };
        }
        const res = await (0, processSingle_1.processSingleIcp)({
            icp: icpRes.icp,
            options,
            workflowId,
            maxPages,
            pageSize,
            targetLeadsWithEmail,
            actualUserId: actualUserId,
            deps: {
                logWorkflowExecutionActivity,
                markIcpMiningStartedActivity,
                updateIcpMiningProgressActivity,
                markIcpMiningCompletedActivity,
                executePageSearch: async (pageSearchOptions) => {
                    return await (0, workflow_1.executeChild)(idealClientProfilePageSearchWorkflow_1.idealClientProfilePageSearchWorkflow, {
                        workflowId: `icp-page-search-${pageSearchOptions.icp_mining_id || pageSearchOptions.role_query_id}-page${pageSearchOptions.page}`,
                        args: [pageSearchOptions],
                    });
                },
            },
        });
        return {
            success: errors.length === 0,
            icp_mining_id: options.icp_mining_id,
            processed: res.processed,
            foundMatches: res.foundMatches,
            totalTargets: res.totalTargets,
            errors: errors.length ? errors : undefined,
        };
    }
    // Batch processing: fetch multiple pending records for this site_id
    const pending = await getPendingIcpMiningActivity({ limit: 50, site_id: options.site_id });
    if (!pending.success) {
        const errorMsg = pending.error || 'failed to list pending';
        errors.push(errorMsg);
        await logWorkflowExecutionActivity({
            workflowId,
            workflowType: 'idealClientProfileMiningWorkflow',
            status: 'FAILED',
            input: options,
            output: { error: errorMsg },
        });
        return {
            success: false,
            icp_mining_id: 'batch',
            processed: 0,
            foundMatches: 0,
            errors: [errorMsg],
        };
    }
    const items = pending.items || [];
    await logWorkflowExecutionActivity({
        workflowId,
        workflowType: 'idealClientProfileMiningWorkflow',
        status: 'INFO',
        input: options,
        output: {
            pendingItemsCount: items.length,
            pendingItems: items.map((i) => ({
                id: i.id,
                role_query_id: i.role_query_id,
                status: i.status,
                name: i.name,
                total_targets: i.total_targets,
                processed_targets: i.processed_targets,
            })),
        },
    });
    if (items.length === 0) {
        await logWorkflowExecutionActivity({
            workflowId,
            workflowType: 'idealClientProfileMiningWorkflow',
            status: 'COMPLETED',
            input: options,
            output: { message: 'No pending ICP mining records found for this site' },
        });
        return { success: true, icp_mining_id: 'batch', processed: 0, foundMatches: 0 };
    }
    // Select the next ICP prioritizing 'running' items, then highest remaining targets
    const icp = (0, selectIcp_1.selectNextIcp)(items);
    await logWorkflowExecutionActivity({
        workflowId,
        workflowType: 'idealClientProfileMiningWorkflow',
        status: 'INFO',
        input: options,
        output: {
            selectedIcp: {
                id: icp.id,
                name: icp.name,
                role_query_id: icp.role_query_id,
                total_targets: icp.total_targets,
                processed_targets: icp.processed_targets,
                pending_targets: (typeof icp.total_targets === 'number' ? icp.total_targets : 0) - (typeof icp.processed_targets === 'number' ? icp.processed_targets : 0),
            },
        },
    });
    const res = await (0, processSingle_1.processSingleIcp)({
        icp,
        options,
        workflowId,
        maxPages,
        pageSize,
        targetLeadsWithEmail,
        actualUserId: actualUserId,
        deps: {
            logWorkflowExecutionActivity,
            markIcpMiningStartedActivity,
            updateIcpMiningProgressActivity,
            markIcpMiningCompletedActivity,
            executePageSearch: async (pageSearchOptions) => {
                return await (0, workflow_1.executeChild)(idealClientProfilePageSearchWorkflow_1.idealClientProfilePageSearchWorkflow, {
                    workflowId: `icp-page-search-${pageSearchOptions.icp_mining_id || pageSearchOptions.role_query_id}-page${pageSearchOptions.page}`,
                    args: [pageSearchOptions],
                });
            },
        },
    });
    return {
        success: errors.length === 0,
        icp_mining_id: icp.id,
        processed: res.processed,
        foundMatches: res.foundMatches,
        totalTargets: res.totalTargets,
        errors: errors.length ? errors : undefined,
    };
}
