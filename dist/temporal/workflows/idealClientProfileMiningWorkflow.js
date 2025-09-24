"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.idealClientProfileMiningWorkflow = idealClientProfileMiningWorkflow;
const workflow_1 = require("@temporalio/workflow");
// Generic supabase and logging activities already used across workflows
const { logWorkflowExecutionActivity, saveCronStatusActivity, } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: '5 minutes',
    retry: { maximumAttempts: 3 },
});
// Finder + DB activities for ICP mining
const { getIcpMiningByIdActivity, markIcpMiningStartedActivity, updateIcpMiningProgressActivity, markIcpMiningCompletedActivity, callPersonRoleSearchActivity, callPersonContactsLookupActivity, upsertPersonActivity, updatePersonEmailsActivity, leadContactGenerationActivity, validateContactInformation, } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: '10 minutes',
    retry: { maximumAttempts: 3 },
});
async function idealClientProfileMiningWorkflow(options) {
    const workflowId = `icp-mining-${options.icp_mining_id}`;
    const maxPages = options.maxPages ?? 10; // 10 hojas
    const pageSize = options.pageSize ?? 10; // 10 registros por hoja
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
    // Load ICP mining row and mark started
    const icpRes = await getIcpMiningByIdActivity(options.icp_mining_id);
    if (!icpRes.success || !icpRes.icp) {
        const msg = icpRes.error || 'icp_mining not found';
        errors.push(msg);
        await markIcpMiningCompletedActivity({ id: options.icp_mining_id, failed: true, last_error: msg });
        return { success: false, icp_mining_id: options.icp_mining_id, processed: 0, foundMatches: 0, errors };
    }
    const icp = icpRes.icp;
    const roleQueryId = icp.role_query_id;
    await markIcpMiningStartedActivity({ id: options.icp_mining_id });
    let processed = 0;
    let foundMatches = 0;
    let totalTargets = icp.total_targets || undefined;
    // Iterate pages
    for (let page = 1; page <= maxPages; page++) {
        const pageRes = await callPersonRoleSearchActivity({
            role_query_id: roleQueryId,
            page,
            page_size: pageSize,
            site_id: options.site_id,
            userId: options.userId,
        });
        if (!pageRes.success) {
            const err = `page ${page} fetch failed: ${pageRes.error}`;
            errors.push(err);
            await updateIcpMiningProgressActivity({ id: options.icp_mining_id, appendError: err });
            break;
        }
        if (page === 1) {
            totalTargets = pageRes.total ?? totalTargets;
            if (totalTargets !== undefined) {
                await updateIcpMiningProgressActivity({ id: options.icp_mining_id, totalTargets });
            }
        }
        const persons = pageRes.persons || [];
        if (persons.length === 0) {
            // No more results
            break;
        }
        for (const p of persons) {
            // Normalize input from external API result
            const external_person_id = p.external_person_id ?? p.person_id ?? p.id ?? null;
            const external_role_id = p.external_role_id ?? p.role_id ?? null;
            const external_organization_id = p.external_organization_id ?? p.organization_id ?? p.company_id ?? null;
            const full_name = p.full_name || p.name || null;
            const role_title = p.role_title || p.title || p.position || null;
            const company_name = p.company_name || p.organization_name || p.company || null;
            const is_current = p.is_current ?? true;
            const location = p.location || p.city || null;
            // Upsert person in DB
            const upsert = await upsertPersonActivity({
                role_query_id: roleQueryId,
                external_person_id,
                external_role_id,
                external_organization_id,
                full_name,
                role_title,
                company_name,
                is_current,
                location,
                emails: p.emails || null,
                phones: p.phones || null,
                raw_result: p,
            });
            if (!upsert.success || !upsert.person) {
                const err = `upsert person failed for ${full_name || external_person_id}: ${upsert.error}`;
                errors.push(err);
                await updateIcpMiningProgressActivity({ id: options.icp_mining_id, deltaProcessed: 1, appendError: err });
                processed += 1;
                continue;
            }
            const personRow = upsert.person;
            // Enrich emails: try existing emails then generate, then external lookup
            let candidateEmails = Array.isArray(p.emails) ? p.emails : [];
            // If no valid email, try generate from domain using leadContactGenerationActivity
            if (candidateEmails.length === 0 && company_name && full_name) {
                let domain = '';
                try {
                    // naive domain build from company_name
                    domain = company_name.toLowerCase().replace(/\s+/g, '') + '.com';
                }
                catch { }
                if (domain) {
                    const context = `Name: ${full_name}\nCompany: ${company_name}\nContext: ICP mining email generation`;
                    const gen = await leadContactGenerationActivity({ name: full_name, domain, context, site_id: options.site_id });
                    if (gen.success && gen.email_generation_analysis && gen.email_generation_analysis.length > 0) {
                        candidateEmails = gen.email_generation_analysis;
                    }
                }
            }
            // Validate generated/existing emails; if none valid, call external contacts lookup
            let validatedEmail = null;
            for (const email of candidateEmails) {
                const val = await validateContactInformation({ email, hasEmailMessage: true, hasWhatsAppMessage: false });
                if (val.success && val.isValid) {
                    validatedEmail = email;
                    break;
                }
            }
            if (!validatedEmail) {
                const lookup = await callPersonContactsLookupActivity({
                    external_person_id,
                    full_name: full_name || undefined,
                    company_name: company_name || undefined,
                });
                if (lookup.success && lookup.emails && lookup.emails.length > 0) {
                    // Validate the looked up emails too
                    for (const email of lookup.emails) {
                        const val = await validateContactInformation({ email, hasEmailMessage: true, hasWhatsAppMessage: false });
                        if (val.success && val.isValid) {
                            validatedEmail = email;
                            break;
                        }
                    }
                    // Merge into person emails if any
                    const merged = Array.from(new Set([...(personRow.emails || []), ...lookup.emails]));
                    await updatePersonEmailsActivity({ person_id: personRow.id, emails: merged });
                }
            }
            if (validatedEmail) {
                foundMatches += 1;
            }
            processed += 1;
            await updateIcpMiningProgressActivity({ id: options.icp_mining_id, deltaProcessed: 1, deltaFound: validatedEmail ? 1 : 0 });
        }
        // stop if fewer than pageSize results (no more pages)
        if (!pageRes.hasMore) {
            break;
        }
    }
    const success = errors.length === 0;
    await markIcpMiningCompletedActivity({ id: options.icp_mining_id, failed: !success, last_error: success ? null : errors[errors.length - 1] });
    return {
        success,
        icp_mining_id: options.icp_mining_id,
        processed,
        foundMatches,
        totalTargets,
        errors: errors.length ? errors : undefined,
    };
}
