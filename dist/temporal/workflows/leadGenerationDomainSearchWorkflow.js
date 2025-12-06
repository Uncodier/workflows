"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.leadGenerationDomainSearchWorkflow = leadGenerationDomainSearchWorkflow;
const workflow_1 = require("@temporalio/workflow");
// Finder + DB activities for domain-based person search
const { callPersonRoleSearchActivity, callPersonWorkEmailsActivity, upsertPersonActivity, updatePersonEmailsActivity, leadContactGenerationActivity, validateContactInformation, createSingleLead, checkExistingPersonActivity, checkExistingLeadForPersonActivity, upsertCompanyActivity, logWorkflowExecutionActivity, } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: '10 minutes',
    retry: { maximumAttempts: 3 },
});
/**
 * Workflow that processes a SINGLE page of domain-based person search for lead generation
 * Similar to ICP page search but uses domains directly instead of role_query_id
 */
async function leadGenerationDomainSearchWorkflow(options) {
    const { domains, page, page_size, site_id, userId, company, segmentId } = options;
    const workflowId = `lead-gen-domain-search-${domains.join('-')}-page${page}`;
    const errors = [];
    let processed = 0;
    let foundMatches = 0;
    const leadsCreated = [];
    // Get deterministic timestamp from workflow start time
    const deterministicTimestamp = (0, workflow_1.workflowInfo)().startTime;
    await logWorkflowExecutionActivity({
        workflowId,
        workflowType: 'leadGenerationDomainSearchWorkflow',
        status: 'STARTED',
        input: options,
    });
    await logWorkflowExecutionActivity({
        workflowId,
        workflowType: 'leadGenerationDomainSearchWorkflow',
        status: 'INFO',
        input: options,
        output: {
            message: `Fetching page ${page} with page_size ${page_size} for domains: ${domains.join(', ')}`,
        },
    });
    // Call Finder API for this specific page with organization_domains
    const pageRes = await callPersonRoleSearchActivity({
        query: {
            organization_domains: domains,
            page,
            page_size,
        },
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
        workflowType: 'leadGenerationDomainSearchWorkflow',
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
        company_name: result.organization?.name || company?.name,
        full_name: result.person?.full_name,
        location: result.person?.location?.name,
        raw_result: result,
    }));
    if (persons.length === 0) {
        await logWorkflowExecutionActivity({
            workflowId,
            workflowType: 'leadGenerationDomainSearchWorkflow',
            status: 'INFO',
            input: options,
            output: { message: `No persons found on page ${page} for domains: ${domains.join(', ')}` },
        });
    }
    // Process each person
    for (const p of persons) {
        const external_person_id = p.external_person_id ?? p.person_id ?? p.id ?? null;
        const external_role_id = p.external_role_id ?? p.role_id ?? null;
        const external_organization_id = p.external_organization_id ?? p.organization_id ?? p.company_id ?? null;
        const full_name = p.full_name || p.name || null;
        const role_title = p.role_title || p.title || p.position || null;
        const company_name = p.company_name || p.organization_name || p.company || company?.name || null;
        const is_current = p.is_current ?? true;
        const location = p.location || p.city || null;
        // Check if person already exists
        const existingPersonCheck = await checkExistingPersonActivity({
            external_person_id,
            external_role_id,
            full_name,
            company_name,
        });
        let personRow;
        if (existingPersonCheck.success && existingPersonCheck.hasExistingPerson) {
            personRow = existingPersonCheck.existingPerson;
        }
        else {
            const upsert = await upsertPersonActivity({
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
                processed += 1;
                continue;
            }
            personRow = upsert.person;
        }
        // Enrich emails
        let candidateEmails = Array.isArray(p.emails) ? p.emails : [];
        if (candidateEmails.length === 0 && company_name && full_name) {
            let domain = '';
            const getDomainFromUrl = (input) => {
                try {
                    const sanitized = String(input).trim();
                    return sanitized
                        .replace(/^https?:\/\//i, '')
                        .replace(/^www\./i, '')
                        .split('/')[0]
                        .split('?')[0]
                        .split('#')[0];
                }
                catch {
                    return '';
                }
            };
            try {
                // Use provided domains first
                if (domains.length > 0) {
                    domain = domains[0];
                }
                else {
                    const orgDomain = (p?.organization?.domain ?? p?.domain ?? '');
                    if (orgDomain && typeof orgDomain === 'string') {
                        domain = getDomainFromUrl(orgDomain);
                    }
                    if (!domain && p?.organization?.website) {
                        domain = getDomainFromUrl(p.organization.website);
                    }
                    if (!domain && company?.website) {
                        domain = getDomainFromUrl(company.website);
                    }
                    if (!domain && company_name) {
                        domain = company_name.toLowerCase().replace(/\s+/g, '') + '.com';
                    }
                }
            }
            catch { }
            if (domain) {
                const context = `Name: ${full_name}\nCompany: ${company_name}\nContext: Lead generation domain search email generation`;
                const gen = await leadContactGenerationActivity({ name: full_name, domain, context, site_id });
                if (gen.success && gen.email_generation_analysis && gen.email_generation_analysis.length > 0) {
                    candidateEmails = gen.email_generation_analysis;
                }
            }
        }
        // Validate emails
        let validatedEmail = null;
        for (const email of candidateEmails) {
            const val = await validateContactInformation({ email, hasEmailMessage: true, hasWhatsAppMessage: false });
            if (val.success && val.isValid) {
                validatedEmail = email;
                break;
            }
        }
        if (!validatedEmail) {
            const lookup = await callPersonWorkEmailsActivity({
                external_person_id,
                full_name: full_name || undefined,
                company_name: company_name || undefined,
            });
            if (lookup.success && lookup.emails && lookup.emails.length > 0) {
                for (const email of lookup.emails) {
                    const val = await validateContactInformation({ email, hasEmailMessage: true, hasWhatsAppMessage: false });
                    if (val.success && val.isValid) {
                        validatedEmail = email;
                        break;
                    }
                }
                const merged = Array.from(new Set([...(personRow.emails || []), ...lookup.emails]));
                await updatePersonEmailsActivity({ person_id: personRow.id, emails: merged });
            }
        }
        if (validatedEmail) {
            foundMatches += 1;
            try {
                const currentEmails = personRow.emails || [];
                const updatedEmails = Array.from(new Set([...currentEmails, validatedEmail]));
                await updatePersonEmailsActivity({ person_id: personRow.id, emails: updatedEmails });
            }
            catch { }
            const hasValidEmail = validatedEmail !== null;
            const hasPhone = personRow.phones && Array.isArray(personRow.phones) && personRow.phones.length > 0;
            if (!hasValidEmail && !hasPhone) {
                processed += 1;
                continue;
            }
            // Check if lead already exists
            const existingLeadCheck = await checkExistingLeadForPersonActivity({
                person_id: personRow.id,
                site_id,
            });
            if (!existingLeadCheck.success) {
                const err = `Failed to check existing lead for ${full_name}: ${existingLeadCheck.error}`;
                errors.push(err);
                processed += 1;
                continue;
            }
            if (existingLeadCheck.hasExistingLead) {
                processed += 1;
                continue;
            }
            // Create company (use provided company data if available)
            let companyId = undefined;
            if (company_name) {
                try {
                    const companyData = {
                        name: company_name,
                        website: p.organization?.website || company?.website || null,
                        description: p.organization?.description || company?.description || null,
                        industry: p.organization?.industry || company?.industry || null,
                        size: p.organization?.size || company?.size || null,
                        address: p.organization?.location
                            ? {
                                full_location: p.organization.location.name || location || null,
                                country: p.organization.location.country || null,
                                city: p.organization.location.city || null,
                                region: p.organization.location.region || null,
                            }
                            : company?.address || (location ? { full_location: location } : {}),
                        created_at: deterministicTimestamp.toISOString(),
                        updated_at: deterministicTimestamp.toISOString(),
                    };
                    const companyResult = await upsertCompanyActivity(companyData);
                    if (companyResult.success && companyResult.company) {
                        companyId = companyResult.company.id;
                    }
                }
                catch { }
            }
            // Create lead
            try {
                const leadData = {
                    name: full_name,
                    email: validatedEmail || null,
                    company_name: company_name,
                    position: role_title,
                    telephone: validatedEmail ? null : hasPhone ? personRow.phones[0] : null,
                    web: p.organization?.website || company?.website || null,
                    address: {
                        country: p.organization?.location?.country || p.location?.split(', ').pop() || null,
                        city: p.organization?.location?.city || p.location?.split(', ')[0] || null,
                        region: p.organization?.location?.region || null,
                        full_location: p.location || null,
                    },
                    social_networks: {
                        linkedin_id: p.external_person_id || null,
                        linkedin_url: p.person?.linkedin_url || null,
                        twitter: p.person?.twitter || null,
                        facebook: p.person?.facebook || null,
                    },
                    company: {
                        name: company_name,
                        website: p.organization?.website || company?.website || null,
                        domain: p.organization?.domain || domains[0] || null,
                        industry: p.organization?.industry || company?.industry || null,
                        size: p.organization?.size || company?.size || null,
                        description: p.organization?.description || company?.description || null,
                        location: p.organization?.location || null,
                        external_organization_id: p.external_organization_id || null,
                    },
                    metadata: {
                        person_id: personRow.id,
                        external_person_id: p.external_person_id,
                        external_role_id: p.external_role_id,
                        role_title: role_title,
                        is_current: is_current,
                        start_date: p.start_date,
                        end_date: p.end_date,
                        raw_person_data: p.raw_result || null,
                        source: 'lead_generation_domain_search_workflow',
                        mining_date: deterministicTimestamp.toISOString(),
                        domains: domains,
                    },
                    person_id: personRow.id,
                };
                const leadResult = await createSingleLead(leadData, site_id, userId, companyId, segmentId);
                if (leadResult.success && leadResult.leadId) {
                    leadsCreated.push(leadResult.leadId);
                }
                else {
                    throw new Error(leadResult.error || 'Failed to create lead');
                }
            }
            catch (leadError) {
                const err = `Failed to create lead for ${full_name}: ${leadError}`;
                errors.push(err);
            }
        }
        processed += 1;
    }
    await logWorkflowExecutionActivity({
        workflowId,
        workflowType: 'leadGenerationDomainSearchWorkflow',
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
