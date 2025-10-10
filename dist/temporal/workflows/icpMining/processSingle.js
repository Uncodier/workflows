"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processSingleIcp = processSingleIcp;
async function processSingleIcp(args) {
    const { icp, options, workflowId, maxPages, pageSize, targetLeadsWithEmail, actualUserId, deps } = args;
    const icpId = icp.id;
    const roleQueryId = icp.role_query_id;
    await deps.logWorkflowExecutionActivity({
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
    await deps.markIcpMiningStartedActivity({ id: icpId });
    let totalProcessed = 0;
    let totalFoundMatches = 0;
    let effectivePageSize = 10; // Finder API fixed page size
    // Read total targets from DB value
    let totalTargets = typeof icp.total_targets === 'number'
        ? icp.total_targets
        : icp.total_targets
            ? Number(icp.total_targets)
            : undefined;
    const processedTargets = icp.processed_targets || 0;
    const dbCurrentPage = typeof icp.current_page === 'number'
        ? icp.current_page
        : icp.current_page
            ? Number(icp.current_page)
            : 0;
    // We may need to hydrate effective page size and totals before computing starting page
    // Hydrate total targets if unknown: call page 0 once and persist
    if (!(typeof totalTargets === 'number' && totalTargets > 0)) {
        try {
            const hydrateRes = await deps.executePageSearch({
                role_query_id: roleQueryId,
                page: 0,
                page_size: effectivePageSize,
                site_id: options.site_id,
                userId: args.actualUserId,
                icp_mining_id: icpId,
            });
            if (hydrateRes.success && typeof hydrateRes.total === 'number' && hydrateRes.total > 0) {
                totalTargets = hydrateRes.total;
                await deps.updateIcpMiningProgressActivity({ id: icpId, totalTargets, status: 'running' });
                await deps.logWorkflowExecutionActivity({
                    workflowId,
                    workflowType: 'idealClientProfileMiningWorkflow',
                    status: 'INFO',
                    input: options,
                    output: {
                        hydratedTotals: { icpId, totalTargets },
                    },
                });
            }
            // page size is fixed by API; ignore hydrateRes.pageSize if present
        }
        catch (e) {
            await deps.updateIcpMiningProgressActivity({ id: icpId, appendError: `Hydration error: ${e}` });
        }
    }
    const startingPage = (() => {
        const n = Number(dbCurrentPage);
        const hasDb = !Number.isNaN(n) && n > 0; // only trust DB current_page when > 0
        if (processedTargets > 0) {
            const ceilPage = Math.ceil(processedTargets / effectivePageSize);
            return hasDb ? Math.max(n, ceilPage) : ceilPage;
        }
        return hasDb ? n : 0;
    })();
    await deps.logWorkflowExecutionActivity({
        workflowId,
        workflowType: 'idealClientProfileMiningWorkflow',
        status: 'INFO',
        input: options,
        output: {
            paginationStart: {
                icpId,
                processedTargets,
                pageSize: effectivePageSize,
                startingPage,
                maxPages,
                targetLeadsWithEmail,
                dbCurrentPage,
                resumeOrigin: dbCurrentPage !== undefined && dbCurrentPage !== null && !Number.isNaN(Number(dbCurrentPage))
                    ? 'db_current_page'
                    : processedTargets > 0
                        ? 'derived_from_processed_targets'
                        : 'default_start',
                message: `Starting from page ${startingPage} (0-based). Target: ${targetLeadsWithEmail} leads with email.`,
            },
        },
    });
    let currentPage = startingPage;
    await deps.updateIcpMiningProgressActivity({ id: icpId, currentPage });
    // If still unknown, proceed by pages until target reached using hasMore as guard
    const shouldUseGuardedPaging = !(typeof totalTargets === 'number' && totalTargets > 0);
    while (currentPage < maxPages &&
        totalFoundMatches < targetLeadsWithEmail &&
        (shouldUseGuardedPaging || (typeof totalTargets === 'number' && totalProcessed < totalTargets))) {
        await deps.logWorkflowExecutionActivity({
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
        let pageResult;
        try {
            pageResult = await deps.executePageSearch({
                role_query_id: roleQueryId,
                page: currentPage,
                page_size: effectivePageSize,
                site_id: options.site_id,
                userId: args.actualUserId,
                icp_mining_id: icpId,
            });
        }
        catch (error) {
            const err = `Page ${currentPage} search failed: ${error}`;
            await deps.updateIcpMiningProgressActivity({ id: icpId, appendError: err });
            break;
        }
        if (!pageResult.success) {
            const err = `Page ${currentPage} returned errors: ${pageResult.errors.join(', ')}`;
            await deps.updateIcpMiningProgressActivity({ id: icpId, appendError: err });
            // Continue to next page
        }
        // If we learned total on first page fetch, persist it
        if (currentPage === 0 && typeof pageResult.total === 'number' && pageResult.total > 0 && totalTargets !== pageResult.total) {
            totalTargets = pageResult.total;
            await deps.updateIcpMiningProgressActivity({ id: icpId, totalTargets, status: 'running' });
        }
        totalProcessed += pageResult.processed;
        totalFoundMatches += pageResult.foundMatches;
        await deps.updateIcpMiningProgressActivity({
            id: icpId,
            deltaProcessed: pageResult.processed,
            deltaFound: pageResult.foundMatches,
            currentPage,
        });
        await deps.logWorkflowExecutionActivity({
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
                },
            },
        });
        if (totalFoundMatches >= targetLeadsWithEmail) {
            break;
        }
        if (!shouldUseGuardedPaging && typeof totalTargets === 'number' && !(totalProcessed < totalTargets)) {
            break;
        }
        if (shouldUseGuardedPaging && pageResult.hasMore === false) {
            break;
        }
        currentPage = currentPage + 1;
        await deps.updateIcpMiningProgressActivity({ id: icpId, currentPage });
    }
    const targetReached = totalFoundMatches >= targetLeadsWithEmail;
    const allTargetsProcessed = typeof totalTargets === 'number' && totalTargets > 0 && totalProcessed >= totalTargets;
    if (targetReached || allTargetsProcessed) {
        const failed = false;
        await deps.markIcpMiningCompletedActivity({ id: icpId, failed, last_error: null });
        await deps.logWorkflowExecutionActivity({
            workflowId,
            workflowType: 'idealClientProfileMiningWorkflow',
            status: 'INFO',
            input: options,
            output: {
                icpMiningCompleted: {
                    icpId,
                    totalProcessed,
                    totalFoundMatches,
                    totalTargets,
                    reason: targetReached ? 'target_reached' : 'all_targets_processed',
                },
            },
        });
    }
    else {
        await deps.updateIcpMiningProgressActivity({ id: icpId, status: 'pending', last_error: null });
        await deps.logWorkflowExecutionActivity({
            workflowId,
            workflowType: 'idealClientProfileMiningWorkflow',
            status: 'INFO',
            input: options,
            output: {
                icpMiningPending: {
                    icpId,
                    totalProcessed,
                    totalFoundMatches,
                    totalTargets,
                    reason: typeof totalTargets === 'number' ? 'not_all_targets_processed' : 'no_valid_total_targets',
                },
            },
        });
    }
    return { processed: totalProcessed, foundMatches: totalFoundMatches, totalTargets };
}
