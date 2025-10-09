"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.idealClientProfileMiningWorkflow = idealClientProfileMiningWorkflow;
const workflow_1 = require("@temporalio/workflow");
const idealClientProfilePageSearchWorkflow_1 = require("./idealClientProfilePageSearchWorkflow");
// Generic supabase and logging activities
const { logWorkflowExecutionActivity, saveCronStatusActivity, } = (0, workflow_1.proxyActivities)({
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
    const maxPages = options.maxPages ?? 20;
    const pageSize = options.pageSize ?? 20;
    const targetLeadsWithEmail = options.targetLeadsWithEmail ?? 40;
    const errors = [];
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
    // Helper to process a single ICP mining record
    const processSingle = async (icp) => {
        const icpId = icp.id;
        const roleQueryId = icp.role_query_id;
        await logWorkflowExecutionActivity({
            workflowId,
            workflowType: 'idealClientProfileMiningWorkflow',
            status: 'INFO',
            input: options,
            output: {
                processingIcp: {
                    icpId,
                    roleQueryId,
                    icpName: icp.name,
                    status: icp.status,
                },
            },
        });
        await markIcpMiningStartedActivity({ id: icpId });
        let totalProcessed = 0;
        let totalFoundMatches = 0;
        let totalTargets = icp.total_targets || undefined;
        // Calculate starting page from DB or processed targets
        const processedTargets = icp.processed_targets || 0;
        const dbCurrentPage = typeof icp.current_page === 'number'
            ? icp.current_page
            : icp.current_page
                ? Number(icp.current_page)
                : 0;
        const startingPage = (() => {
            if (dbCurrentPage !== undefined && dbCurrentPage !== null) {
                const n = Number(dbCurrentPage);
                if (!Number.isNaN(n) && n >= 0)
                    return n;
            }
            if (processedTargets > 0) {
                const derived = Math.floor(processedTargets / pageSize);
                return derived >= 0 ? derived : 0;
            }
            return 0;
        })();
        await logWorkflowExecutionActivity({
            workflowId,
            workflowType: 'idealClientProfileMiningWorkflow',
            status: 'INFO',
            input: options,
            output: {
                paginationStart: {
                    icpId,
                    processedTargets,
                    pageSize,
                    startingPage,
                    maxPages,
                    targetLeadsWithEmail,
                    dbCurrentPage,
                    resumeOrigin: dbCurrentPage !== undefined && dbCurrentPage !== null && !Number.isNaN(Number(dbCurrentPage))
                        ? 'db_current_page'
                        : processedTargets > 0
                            ? 'derived_from_processed_targets'
                            : 'default_start',
                    message: `Starting from page ${startingPage} (0-based). Target: ${targetLeadsWithEmail} leads with email. Resume origin: ${dbCurrentPage !== undefined && dbCurrentPage !== null && !Number.isNaN(Number(dbCurrentPage))
                        ? 'db_current_page'
                        : processedTargets > 0
                            ? 'derived_from_processed_targets'
                            : 'default_start'}`,
                },
            },
        });
        let currentPage = startingPage;
        await updateIcpMiningProgressActivity({ id: icpId, currentPage });
        let hasMore = true;
        // Iterate pages until target reached or no more pages
        while (currentPage < maxPages && hasMore && totalFoundMatches < targetLeadsWithEmail) {
            await logWorkflowExecutionActivity({
                workflowId,
                workflowType: 'idealClientProfileMiningWorkflow',
                status: 'INFO',
                input: options,
                output: {
                    callingPageSearch: {
                        icpId,
                        roleQueryId,
                        page: currentPage,
                        pageSize,
                        totalFoundMatches,
                        targetLeadsWithEmail,
                        message: `Calling page search for page ${currentPage}. Progress: ${totalFoundMatches}/${targetLeadsWithEmail}`,
                    },
                },
            });
            const pageSearchOptions = {
                role_query_id: roleQueryId,
                page: currentPage,
                page_size: pageSize,
                site_id: options.site_id,
                userId: actualUserId,
                icp_mining_id: icpId,
            };
            let pageResult;
            try {
                pageResult = await (0, workflow_1.executeChild)(idealClientProfilePageSearchWorkflow_1.idealClientProfilePageSearchWorkflow, {
                    workflowId: `icp-page-search-${icpId}-page${currentPage}`,
                    args: [pageSearchOptions],
                });
            }
            catch (error) {
                const err = `Page ${currentPage} search failed: ${error}`;
                errors.push(err);
                await updateIcpMiningProgressActivity({ id: icpId, appendError: err });
                break;
            }
            if (!pageResult.success) {
                const err = `Page ${currentPage} returned errors: ${pageResult.errors.join(', ')}`;
                errors.push(err);
                await updateIcpMiningProgressActivity({ id: icpId, appendError: err });
                // Continue to next page instead of breaking
            }
            // Update totals
            totalProcessed += pageResult.processed;
            totalFoundMatches += pageResult.foundMatches;
            hasMore = pageResult.hasMore;
            // Update total targets from first page
            if (currentPage === 0 && pageResult.total !== undefined) {
                totalTargets = pageResult.total;
                await updateIcpMiningProgressActivity({ id: icpId, totalTargets });
            }
            // Update progress in DB
            await updateIcpMiningProgressActivity({
                id: icpId,
                deltaProcessed: pageResult.processed,
                deltaFound: pageResult.foundMatches,
                currentPage,
            });
            await logWorkflowExecutionActivity({
                workflowId,
                workflowType: 'idealClientProfileMiningWorkflow',
                status: 'INFO',
                input: options,
                output: {
                    pageCompleted: {
                        page: currentPage,
                        processed: pageResult.processed,
                        foundMatches: pageResult.foundMatches,
                        leadsCreated: pageResult.leadsCreated.length,
                        hasMore: pageResult.hasMore,
                        totalProcessed,
                        totalFoundMatches,
                        targetLeadsWithEmail,
                        progress: `${totalFoundMatches}/${targetLeadsWithEmail} leads with email`,
                    },
                },
            });
            // Check if target reached
            if (totalFoundMatches >= targetLeadsWithEmail) {
                await logWorkflowExecutionActivity({
                    workflowId,
                    workflowType: 'idealClientProfileMiningWorkflow',
                    status: 'INFO',
                    input: options,
                    output: {
                        targetReached: {
                            totalFoundMatches,
                            targetLeadsWithEmail,
                            message: `Target reached! Found ${totalFoundMatches}/${targetLeadsWithEmail} leads with valid email`,
                        },
                    },
                });
                break;
            }
            if (!hasMore) {
                await logWorkflowExecutionActivity({
                    workflowId,
                    workflowType: 'idealClientProfileMiningWorkflow',
                    status: 'INFO',
                    input: options,
                    output: {
                        noMorePages: {
                            totalFoundMatches,
                            targetLeadsWithEmail,
                            message: `No more pages available. Found ${totalFoundMatches}/${targetLeadsWithEmail} leads`,
                        },
                    },
                });
                break;
            }
            // Move to next page
            currentPage = currentPage + 1;
            await updateIcpMiningProgressActivity({ id: icpId, currentPage });
        }
        // Determine completion status
        const targetReached = totalFoundMatches >= targetLeadsWithEmail;
        const allTargetsProcessed = totalTargets !== undefined && totalTargets > 0 && totalProcessed >= totalTargets;
        const hasValidTotalTargets = totalTargets !== undefined && totalTargets > 0;
        if (targetReached) {
            const success = errors.length === 0;
            await markIcpMiningCompletedActivity({
                id: icpId,
                failed: !success,
                last_error: success ? null : errors[errors.length - 1],
            });
            await logWorkflowExecutionActivity({
                workflowId,
                workflowType: 'idealClientProfileMiningWorkflow',
                status: 'INFO',
                input: options,
                output: {
                    icpMiningCompleted: {
                        icpId,
                        totalProcessed,
                        totalFoundMatches,
                        targetLeadsWithEmail,
                        reason: 'target_reached',
                        message: `ICP mining completed - target reached! Found ${totalFoundMatches}/${targetLeadsWithEmail} leads with valid email.`,
                    },
                },
            });
        }
        else if (allTargetsProcessed) {
            const success = errors.length === 0;
            await markIcpMiningCompletedActivity({
                id: icpId,
                failed: !success,
                last_error: success ? null : errors[errors.length - 1],
            });
            await logWorkflowExecutionActivity({
                workflowId,
                workflowType: 'idealClientProfileMiningWorkflow',
                status: 'INFO',
                input: options,
                output: {
                    icpMiningCompleted: {
                        icpId,
                        totalProcessed,
                        totalTargets,
                        reason: 'all_targets_processed',
                        message: `ICP mining completed - processed ${totalProcessed}/${totalTargets} targets.`,
                    },
                },
            });
        }
        else if (!hasValidTotalTargets) {
            await updateIcpMiningProgressActivity({
                id: icpId,
                status: 'pending',
                last_error: errors.length > 0 ? errors[errors.length - 1] : null,
            });
            await logWorkflowExecutionActivity({
                workflowId,
                workflowType: 'idealClientProfileMiningWorkflow',
                status: 'INFO',
                input: options,
                output: {
                    icpMiningPending: {
                        icpId,
                        totalProcessed,
                        totalFoundMatches,
                        targetLeadsWithEmail,
                        totalTargets,
                        reason: 'no_valid_total_targets',
                        message: `ICP mining not completed - no valid total targets (${totalTargets}). Found ${totalFoundMatches}/${targetLeadsWithEmail} leads. Setting to pending.`,
                    },
                },
            });
        }
        else {
            await updateIcpMiningProgressActivity({
                id: icpId,
                status: 'pending',
                last_error: errors.length > 0 ? errors[errors.length - 1] : null,
            });
            await logWorkflowExecutionActivity({
                workflowId,
                workflowType: 'idealClientProfileMiningWorkflow',
                status: 'INFO',
                input: options,
                output: {
                    icpMiningPending: {
                        icpId,
                        totalProcessed,
                        totalFoundMatches,
                        targetLeadsWithEmail,
                        totalTargets,
                        reason: 'not_all_targets_processed',
                        message: `ICP mining not completed - processed ${totalProcessed}/${totalTargets} targets. Found ${totalFoundMatches}/${targetLeadsWithEmail} leads. Setting to pending.`,
                    },
                },
            });
        }
        return { processed: totalProcessed, foundMatches: totalFoundMatches, totalTargets };
    };
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
        const res = await processSingle(icpRes.icp);
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
    // Select the item with the highest number of pending targets
    const computePendingTargets = (it) => {
        const total = typeof it?.total_targets === 'number' ? it.total_targets : 0;
        const processed = typeof it?.processed_targets === 'number' ? it.processed_targets : 0;
        const remaining = total - processed;
        return remaining > 0 ? remaining : 0;
    };
    const sortedByPendingDesc = items
        .slice()
        .sort((a, b) => computePendingTargets(b) - computePendingTargets(a));
    const icp = sortedByPendingDesc[0];
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
                pending_targets: computePendingTargets(icp),
            },
        },
    });
    const res = await processSingle(icp);
    return {
        success: errors.length === 0,
        icp_mining_id: icp.id,
        processed: res.processed,
        foundMatches: res.foundMatches,
        totalTargets: res.totalTargets,
        errors: errors.length ? errors : undefined,
    };
}
