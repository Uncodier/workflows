"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.idealClientProfilePageSearchWorkflow = idealClientProfilePageSearchWorkflow;
const workflow_1 = require("@temporalio/workflow");
const enrichLeadWorkflow_1 = require("./enrichLeadWorkflow");
// Finder + DB activities for ICP mining (page-level only; per-person handled by enrichLeadWorkflow)
const { getRoleQueryByIdActivity, callPersonRoleSearchActivity, getSegmentIdFromRoleQueryActivity, logWorkflowExecutionActivity, } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: '10 minutes',
    retry: { maximumAttempts: 3 },
});
/**
 * Workflow that processes a SINGLE page of ICP mining
 * Returns results and pagination info for orchestrator to decide next steps
 */
async function idealClientProfilePageSearchWorkflow(options) {
    const { role_query_id, page, page_size, site_id, userId, icp_mining_id } = options;
    const workflowId = `icp-page-search-${icp_mining_id || role_query_id}-page${page}`;
    const errors = [];
    let processed = 0;
    let foundMatches = 0;
    const leadsCreated = [];
    await logWorkflowExecutionActivity({
        workflowId,
        workflowType: 'idealClientProfilePageSearchWorkflow',
        status: 'STARTED',
        input: options,
    });
    // Get role query data
    const roleQueryRes = await getRoleQueryByIdActivity(role_query_id);
    if (!roleQueryRes.success || !roleQueryRes.roleQuery) {
        const err = `Failed to get role query data: ${roleQueryRes.error}`;
        errors.push(err);
        return {
            success: false,
            processed: 0,
            foundMatches: 0,
            leadsCreated: [],
            hasMore: false,
            errors,
        };
    }
    const roleQuery = roleQueryRes.roleQuery;
    await logWorkflowExecutionActivity({
        workflowId,
        workflowType: 'idealClientProfilePageSearchWorkflow',
        status: 'INFO',
        input: options,
        output: {
            message: `Fetching page ${page} with page_size ${page_size}`,
            roleQueryId: role_query_id,
        },
    });
    // Call Finder API for this specific page
    const pageRes = await callPersonRoleSearchActivity({
        query: roleQuery.query,
        page,
        page_size,
        site_id,
        userId,
    });
    if (!pageRes.success) {
        const err = `Page ${page} fetch failed: ${pageRes.error}`;
        errors.push(err);
        return {
            success: false,
            processed: 0,
            foundMatches: 0,
            leadsCreated: [],
            hasMore: false,
            errors,
        };
    }
    const total = page === 0 ? pageRes.total : undefined;
    const hasMore = !!pageRes.hasMore;
    await logWorkflowExecutionActivity({
        workflowId,
        workflowType: 'idealClientProfilePageSearchWorkflow',
        status: 'INFO',
        input: options,
        output: {
            page,
            total,
            hasMore,
            personsInPage: pageRes.persons?.length || 0,
        },
    });
    // Extract persons from API response
    const searchResults = pageRes.data?.search_results || pageRes.data?.results || [];
    const persons = searchResults.map((result) => ({
        ...result.person,
        organization: result.organization,
        role_title: result.role_title,
        start_date: result.start_date,
        end_date: result.end_date,
        is_current: result.is_current,
        external_person_id: result.person?.id,
        external_organization_id: result.organization?.id,
        company_name: result.organization?.name,
        full_name: result.person?.full_name,
        location: result.person?.location?.name,
        raw_result: result,
    }));
    if (persons.length === 0) {
        await logWorkflowExecutionActivity({
            workflowId,
            workflowType: 'idealClientProfilePageSearchWorkflow',
            status: 'INFO',
            input: options,
            output: { message: `No persons found on page ${page}` },
        });
    }
    // Fetch segment_id once before the loop
    let segmentId = undefined;
    try {
        const segmentResult = await getSegmentIdFromRoleQueryActivity(role_query_id);
        if (segmentResult.success && segmentResult.segmentId) {
            segmentId = segmentResult.segmentId;
        }
    }
    catch { }
    // Process each person via enrichLeadWorkflow child
    for (const p of persons) {
        const external_person_id = p.external_person_id ?? p.person_id ?? p.id ?? null;
        const full_name = p.full_name || p.name || null;
        const company_name = p.company_name || p.organization_name || p.company || null;
        const linkedin_profile = p.person?.linkedin_url ??
            p.raw_result?.linkedin_info?.public_profile_url ??
            p.raw_result?.person?.linkedin_info?.public_profile_url ??
            p.raw_result?.linkedin_url ??
            undefined;
        if (!external_person_id) {
            errors.push(`Person missing external_person_id for ${full_name || 'unknown'}`);
            processed += 1;
            continue;
        }
        const childWorkflowId = `enrich-lead-icp-${icp_mining_id || role_query_id}-${external_person_id}-${page}`;
        try {
            const result = await (0, workflow_1.executeChild)(enrichLeadWorkflow_1.enrichLeadWorkflow, {
                workflowId: childWorkflowId,
                args: [{
                        person_id: String(external_person_id),
                        linkedin_profile,
                        site_id,
                        userId,
                        company_name: company_name || undefined,
                        segment_id: segmentId,
                    }],
            });
            processed += 1;
            if (result.success && result.leadId) {
                leadsCreated.push(result.leadId);
                foundMatches += 1;
            }
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            errors.push(`Enrich failed for ${full_name || external_person_id}: ${msg}`);
            processed += 1;
        }
    }
    await logWorkflowExecutionActivity({
        workflowId,
        workflowType: 'idealClientProfilePageSearchWorkflow',
        status: 'COMPLETED',
        input: options,
        output: {
            processed,
            foundMatches,
            leadsCreated: leadsCreated.length,
            hasMore,
            total,
        },
    });
    return {
        success: errors.length === 0,
        processed,
        foundMatches,
        leadsCreated,
        hasMore,
        total,
        errors,
    };
}
