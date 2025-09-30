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
const { getIcpMiningByIdActivity, getPendingIcpMiningActivity, getRoleQueryByIdActivity, markIcpMiningStartedActivity, updateIcpMiningProgressActivity, markIcpMiningCompletedActivity, callPersonRoleSearchActivity, callPersonContactsLookupActivity, upsertPersonActivity, updatePersonEmailsActivity, leadContactGenerationActivity, validateContactInformation, createSingleLead, checkExistingPersonActivity, checkExistingLeadForPersonActivity, getSiteActivity, upsertCompanyActivity, getSegmentIdFromRoleQueryActivity, } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: '10 minutes',
    retry: { maximumAttempts: 3 },
});
/**
 * Calculate the starting page based on processed leads
 * @param processedTargets Number of leads already processed
 * @param pageSize Number of leads per page
 * @returns The page number to start from (1-based)
 */
function calculateStartingPage(processedTargets, pageSize) {
    if (processedTargets <= 0) {
        return 1; // Start from page 1 if no leads processed yet
    }
    // Calculate which page we should start from
    // If we processed 15 leads and pageSize is 10, we should start from page 2 (leads 11-20)
    const startingPage = Math.floor(processedTargets / pageSize) + 1;
    return startingPage;
}
async function idealClientProfileMiningWorkflow(options) {
    const workflowId = `icp-mining-${options.icp_mining_id || 'batch'}`;
    const maxPages = options.maxPages ?? 10; // 10 hojas
    const pageSize = options.pageSize ?? 10; // 10 registros por hoja
    const targetLeadsWithEmail = 40; // Objetivo: al menos 40 leads con correo válido
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
    // Get site information to extract the correct user_id
    let actualUserId = options.userId;
    if (!actualUserId) {
        await logWorkflowExecutionActivity({
            workflowId,
            workflowType: 'idealClientProfileMiningWorkflow',
            status: 'INFO',
            input: options,
            output: { message: 'No user_id provided, fetching from site information' },
        });
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
            return { success: false, icp_mining_id: options.icp_mining_id || 'batch', processed: 0, foundMatches: 0, errors: [errorMsg] };
        }
        actualUserId = siteResult.site.user_id;
        await logWorkflowExecutionActivity({
            workflowId,
            workflowType: 'idealClientProfileMiningWorkflow',
            status: 'INFO',
            input: options,
            output: {
                siteInfo: {
                    site_id: options.site_id,
                    site_name: siteResult.site.name,
                    user_id: actualUserId,
                    message: 'Retrieved user_id from site information'
                }
            },
        });
    }
    // Helper to process a single icp_mining row
    const processSingle = async (icp) => {
        const icpId = icp.id;
        const roleQueryId = icp.role_query_id;
        // Get the role query data to pass the actual query to the API
        const roleQueryRes = await getRoleQueryByIdActivity(roleQueryId);
        if (!roleQueryRes.success || !roleQueryRes.roleQuery) {
            const err = `Failed to get role query data: ${roleQueryRes.error}`;
            errors.push(err);
            await markIcpMiningCompletedActivity({ id: icpId, failed: true, last_error: err });
            return { processed: 0, foundMatches: 0, totalTargets: undefined };
        }
        const roleQuery = roleQueryRes.roleQuery;
        // Debug logging to show which role_query_id is being used and what data we have
        await logWorkflowExecutionActivity({
            workflowId,
            workflowType: 'idealClientProfileMiningWorkflow',
            status: 'INFO',
            input: options,
            output: {
                processingIcpMining: {
                    icpId,
                    roleQueryId,
                    icpName: icp.name,
                    icpCriteria: icp.icp_criteria,
                    roleQueryData: {
                        id: roleQuery.id,
                        query: roleQuery.query,
                        query_hash: roleQuery.query_hash,
                        status: roleQuery.status
                    },
                    icpData: {
                        id: icp.id,
                        name: icp.name,
                        role_query_id: icp.role_query_id,
                        icp_criteria: icp.icp_criteria,
                        status: icp.status,
                        created_at: icp.created_at
                    },
                    message: 'Starting ICP mining with role query data - showing full query and ICP data'
                }
            },
        });
        await markIcpMiningStartedActivity({ id: icpId });
        let processed = 0;
        let foundMatches = 0;
        let totalTargets = icp.total_targets || undefined;
        // Calculate starting page based on already processed leads
        const processedTargets = icp.processed_targets || 0;
        const startingPage = calculateStartingPage(processedTargets, pageSize);
        await logWorkflowExecutionActivity({
            workflowId,
            workflowType: 'idealClientProfileMiningWorkflow',
            status: 'INFO',
            input: options,
            output: {
                paginationCalculation: {
                    icpId,
                    processedTargets,
                    pageSize,
                    startingPage,
                    maxPages,
                    targetLeadsWithEmail,
                    message: `Starting from page ${startingPage} because ${processedTargets} leads already processed. Target: ${targetLeadsWithEmail} leads with valid email.`
                }
            },
        });
        // Continue processing pages until we reach the target or max pages
        let currentPage = startingPage;
        const hasMorePages = true;
        while (currentPage <= maxPages && hasMorePages && foundMatches < targetLeadsWithEmail) {
            // Debug logging to understand what role_query_id is being used
            await logWorkflowExecutionActivity({
                workflowId,
                workflowType: 'idealClientProfileMiningWorkflow',
                status: 'INFO',
                input: options,
                output: {
                    callingPersonRoleSearch: {
                        roleQueryId,
                        page: currentPage,
                        pageSize,
                        siteId: options.site_id,
                        queryData: roleQuery.query,
                        isStartingPage: currentPage === startingPage,
                        processedTargets,
                        foundMatches,
                        targetLeadsWithEmail,
                        message: `Calling Finder API for page ${currentPage} (starting from page ${startingPage} due to ${processedTargets} already processed). Found ${foundMatches}/${targetLeadsWithEmail} leads with email.`
                    }
                },
            });
            const pageRes = await callPersonRoleSearchActivity({
                query: roleQuery.query, // Pass the actual query data instead of just the ID
                page: currentPage,
                page_size: pageSize,
                site_id: options.site_id,
                userId: options.userId,
            });
            if (!pageRes.success) {
                const err = `page ${currentPage} fetch failed: ${pageRes.error}`;
                errors.push(err);
                await updateIcpMiningProgressActivity({ id: icpId, appendError: err });
                break;
            }
            // Debug logging to see what data we're getting back from the API
            await logWorkflowExecutionActivity({
                workflowId,
                workflowType: 'idealClientProfileMiningWorkflow',
                status: 'INFO',
                input: options,
                output: {
                    apiResponseDebug: {
                        roleQueryId,
                        page: currentPage,
                        success: pageRes.success,
                        total: pageRes.total,
                        hasMore: pageRes.hasMore,
                        dataKeys: pageRes.data ? Object.keys(pageRes.data) : [],
                        searchResultsCount: pageRes.data?.search_results?.length || 0,
                        message: 'API response received - checking data structure'
                    }
                },
            });
            if (currentPage === 1) {
                totalTargets = pageRes.total ?? totalTargets;
                if (totalTargets !== undefined && totalTargets > 0) {
                    await updateIcpMiningProgressActivity({ id: icpId, totalTargets });
                    await logWorkflowExecutionActivity({
                        workflowId,
                        workflowType: 'idealClientProfileMiningWorkflow',
                        status: 'INFO',
                        input: options,
                        output: {
                            totalTargetsSet: {
                                icpId,
                                totalTargets,
                                message: `Total targets set to ${totalTargets} for ICP mining`
                            }
                        },
                    });
                }
                else {
                    await logWorkflowExecutionActivity({
                        workflowId,
                        workflowType: 'idealClientProfileMiningWorkflow',
                        status: 'WARNING',
                        input: options,
                        output: {
                            totalTargetsNotSet: {
                                icpId,
                                pageResTotal: pageRes.total,
                                existingTotalTargets: totalTargets,
                                message: 'Total targets not set or is 0 - will not mark as completed until all targets are processed'
                            }
                        },
                    });
                }
            }
            // Extract persons from search_results (the actual data structure from Finder API)
            const searchResults = pageRes.data?.search_results || [];
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
                raw_result: result
            }));
            // Debug logging to see sample persons and their locations
            if (persons.length > 0) {
                const samplePersons = persons.slice(0, 3).map((p) => ({
                    full_name: p.full_name,
                    company_name: p.company_name,
                    location: p.location,
                    role_title: p.role_title,
                    is_current: p.is_current
                }));
                await logWorkflowExecutionActivity({
                    workflowId,
                    workflowType: 'idealClientProfileMiningWorkflow',
                    status: 'INFO',
                    input: options,
                    output: {
                        samplePersonsDebug: {
                            roleQueryId,
                            page: currentPage,
                            totalPersons: persons.length,
                            samplePersons,
                            message: 'Sample persons received from API - checking if filters are applied'
                        }
                    },
                });
            }
            await logWorkflowExecutionActivity({
                workflowId,
                workflowType: 'idealClientProfileMiningWorkflow',
                status: 'INFO',
                input: options,
                output: {
                    page: currentPage,
                    searchResultsCount: searchResults.length,
                    personsCount: persons.length,
                    hasMore: pageRes.hasMore,
                    total: pageRes.total,
                    foundMatches,
                    targetLeadsWithEmail,
                    progress: `${foundMatches}/${targetLeadsWithEmail} leads with email found`
                },
            });
            if (persons.length === 0) {
                await logWorkflowExecutionActivity({
                    workflowId,
                    workflowType: 'idealClientProfileMiningWorkflow',
                    status: 'INFO',
                    input: options,
                    output: { message: `No persons found on page ${currentPage}, breaking loop` },
                });
                break;
            }
            for (const p of persons) {
                await logWorkflowExecutionActivity({
                    workflowId,
                    workflowType: 'idealClientProfileMiningWorkflow',
                    status: 'INFO',
                    input: options,
                    output: {
                        processingPerson: {
                            full_name: p.full_name,
                            company_name: p.company_name,
                            role_title: p.role_title,
                            external_person_id: p.external_person_id
                        }
                    },
                });
                // Normalize input from external API result
                const external_person_id = p.external_person_id ?? p.person_id ?? p.id ?? null;
                const external_role_id = p.external_role_id ?? p.role_id ?? null;
                const external_organization_id = p.external_organization_id ?? p.organization_id ?? p.company_id ?? null;
                const full_name = p.full_name || p.name || null;
                const role_title = p.role_title || p.title || p.position || null;
                const company_name = p.company_name || p.organization_name || p.company || null;
                const is_current = p.is_current ?? true;
                const location = p.location || p.city || null;
                // Check if person already exists
                await logWorkflowExecutionActivity({
                    workflowId,
                    workflowType: 'idealClientProfileMiningWorkflow',
                    status: 'INFO',
                    input: options,
                    output: {
                        checkingExistingPerson: {
                            full_name,
                            company_name,
                            external_person_id,
                            external_role_id
                        }
                    },
                });
                const existingPersonCheck = await checkExistingPersonActivity({
                    external_person_id,
                    external_role_id,
                    full_name,
                    company_name
                });
                let personRow;
                if (existingPersonCheck.success && existingPersonCheck.hasExistingPerson) {
                    // Use existing person
                    personRow = existingPersonCheck.existingPerson;
                    await logWorkflowExecutionActivity({
                        workflowId,
                        workflowType: 'idealClientProfileMiningWorkflow',
                        status: 'INFO',
                        input: options,
                        output: {
                            usingExistingPerson: {
                                person_id: personRow.id,
                                full_name: personRow.full_name,
                                company_name: personRow.company_name,
                                existing_emails: personRow.emails,
                                message: 'Using existing person, skipping upsert'
                            }
                        },
                    });
                }
                else {
                    // Create new person
                    await logWorkflowExecutionActivity({
                        workflowId,
                        workflowType: 'idealClientProfileMiningWorkflow',
                        status: 'INFO',
                        input: options,
                        output: {
                            creatingNewPerson: {
                                full_name,
                                company_name,
                                role_title,
                                external_person_id,
                                external_organization_id
                            }
                        },
                    });
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
                        await logWorkflowExecutionActivity({
                            workflowId,
                            workflowType: 'idealClientProfileMiningWorkflow',
                            status: 'ERROR',
                            input: options,
                            output: {
                                upsertPersonFailed: {
                                    full_name,
                                    error: upsert.error,
                                    external_person_id
                                }
                            },
                        });
                        await updateIcpMiningProgressActivity({ id: icpId, deltaProcessed: 1, appendError: err });
                        processed += 1;
                        continue;
                    }
                    personRow = upsert.person;
                    await logWorkflowExecutionActivity({
                        workflowId,
                        workflowType: 'idealClientProfileMiningWorkflow',
                        status: 'INFO',
                        input: options,
                        output: {
                            personCreated: {
                                person_id: personRow.id,
                                full_name: personRow.full_name,
                                company_name: personRow.company_name,
                                external_person_id: personRow.external_person_id
                            }
                        },
                    });
                }
                // Enrich emails: try existing emails then generate, then external lookup
                let candidateEmails = Array.isArray(p.emails) ? p.emails : [];
                // If no valid email, try generate from domain using leadContactGenerationActivity
                if (candidateEmails.length === 0 && company_name && full_name) {
                    let domain = '';
                    // Helper to normalize a domain from a raw string/URL
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
                        // Prefer domain provided by Finder (organization.domain), fallback to organization.website, then naive build
                        const orgDomain = (p?.organization?.domain ?? p?.domain ?? '');
                        if (orgDomain && typeof orgDomain === 'string') {
                            domain = getDomainFromUrl(orgDomain);
                        }
                        if (!domain && p?.organization?.website) {
                            domain = getDomainFromUrl(p.organization.website);
                        }
                        if (!domain && company_name) {
                            // Last-resort naive domain from company name
                            domain = company_name.toLowerCase().replace(/\s+/g, '') + '.com';
                        }
                    }
                    catch { }
                    if (domain) {
                        await logWorkflowExecutionActivity({
                            workflowId,
                            workflowType: 'idealClientProfileMiningWorkflow',
                            status: 'INFO',
                            input: options,
                            output: {
                                generatingEmails: {
                                    full_name,
                                    company_name,
                                    domain,
                                    message: 'Calling leadContactGenerationActivity to generate emails'
                                }
                            },
                        });
                        const context = `Name: ${full_name}\nCompany: ${company_name}\nContext: ICP mining email generation`;
                        const gen = await leadContactGenerationActivity({ name: full_name, domain, context, site_id: options.site_id });
                        if (gen.success && gen.email_generation_analysis && gen.email_generation_analysis.length > 0) {
                            candidateEmails = gen.email_generation_analysis;
                            await logWorkflowExecutionActivity({
                                workflowId,
                                workflowType: 'idealClientProfileMiningWorkflow',
                                status: 'INFO',
                                input: options,
                                output: {
                                    emailsGenerated: {
                                        full_name,
                                        company_name,
                                        generatedEmails: candidateEmails,
                                        count: candidateEmails.length
                                    }
                                },
                            });
                        }
                        else {
                            await logWorkflowExecutionActivity({
                                workflowId,
                                workflowType: 'idealClientProfileMiningWorkflow',
                                status: 'WARNING',
                                input: options,
                                output: {
                                    emailGenerationFailed: {
                                        full_name,
                                        company_name,
                                        domain,
                                        error: gen.error || 'No emails generated'
                                    }
                                },
                            });
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
                    // Update person's emails with the validated email
                    try {
                        const currentEmails = personRow.emails || [];
                        const updatedEmails = Array.from(new Set([...currentEmails, validatedEmail]));
                        await updatePersonEmailsActivity({ person_id: personRow.id, emails: updatedEmails });
                        await logWorkflowExecutionActivity({
                            workflowId,
                            workflowType: 'idealClientProfileMiningWorkflow',
                            status: 'INFO',
                            input: options,
                            output: {
                                personEmailsUpdated: {
                                    person_id: personRow.id,
                                    full_name: full_name,
                                    validatedEmail,
                                    updatedEmails,
                                    message: 'Updated person emails with validated email'
                                }
                            },
                        });
                    }
                    catch (emailUpdateError) {
                        await logWorkflowExecutionActivity({
                            workflowId,
                            workflowType: 'idealClientProfileMiningWorkflow',
                            status: 'WARNING',
                            input: options,
                            output: {
                                personEmailsUpdateFailed: {
                                    person_id: personRow.id,
                                    full_name: full_name,
                                    validatedEmail,
                                    error: emailUpdateError,
                                    message: 'Failed to update person emails, but continuing with lead creation'
                                }
                            },
                        });
                    }
                    // Validate that person has at least email OR phone before proceeding
                    const hasValidEmail = validatedEmail !== null;
                    const hasPhone = personRow.phones && Array.isArray(personRow.phones) && personRow.phones.length > 0;
                    if (!hasValidEmail && !hasPhone) {
                        await logWorkflowExecutionActivity({
                            workflowId,
                            workflowType: 'idealClientProfileMiningWorkflow',
                            status: 'WARNING',
                            input: options,
                            output: {
                                personSkippedNoContact: {
                                    person_id: personRow.id,
                                    full_name: full_name,
                                    company_name: company_name,
                                    reason: 'No valid email or phone number found',
                                    message: 'Skipping person - no contact information available'
                                }
                            },
                        });
                        processed += 1;
                        await updateIcpMiningProgressActivity({ id: icpId, deltaProcessed: 1 });
                        continue;
                    }
                    // Check if lead already exists for this person (only after we have valid contact info)
                    await logWorkflowExecutionActivity({
                        workflowId,
                        workflowType: 'idealClientProfileMiningWorkflow',
                        status: 'INFO',
                        input: options,
                        output: {
                            checkingExistingLead: {
                                person_id: personRow.id,
                                full_name: personRow.full_name,
                                company_name: personRow.company_name,
                                validatedEmail: validatedEmail || null,
                                hasPhone: hasPhone
                            }
                        },
                    });
                    const existingLeadCheck = await checkExistingLeadForPersonActivity({
                        person_id: personRow.id,
                        site_id: options.site_id
                    });
                    if (!existingLeadCheck.success) {
                        const err = `Failed to check existing lead for ${full_name}: ${existingLeadCheck.error}`;
                        errors.push(err);
                        await updateIcpMiningProgressActivity({ id: icpId, appendError: err });
                        processed += 1;
                        continue;
                    }
                    if (existingLeadCheck.hasExistingLead) {
                        await logWorkflowExecutionActivity({
                            workflowId,
                            workflowType: 'idealClientProfileMiningWorkflow',
                            status: 'INFO',
                            input: options,
                            output: {
                                personAlreadyHasLead: {
                                    person_id: personRow.id,
                                    full_name: personRow.full_name,
                                    existing_lead_id: existingLeadCheck.existingLead?.id,
                                    existing_lead_email: existingLeadCheck.existingLead?.email,
                                    existing_lead_status: existingLeadCheck.existingLead?.status,
                                    message: 'Skipping lead creation - lead already exists'
                                }
                            },
                        });
                        processed += 1;
                        await updateIcpMiningProgressActivity({ id: icpId, deltaProcessed: 1 });
                        continue;
                    }
                    // Create company if company_name is available
                    let companyId = undefined;
                    if (company_name) {
                        try {
                            await logWorkflowExecutionActivity({
                                workflowId,
                                workflowType: 'idealClientProfileMiningWorkflow',
                                status: 'INFO',
                                input: options,
                                output: {
                                    creatingCompany: {
                                        company_name: company_name,
                                        website: p.organization?.website || null,
                                        message: 'Creating/updating company for lead'
                                    }
                                },
                            });
                            // Prepare company data for upsert
                            const companyData = {
                                name: company_name,
                                website: p.organization?.website || null,
                                description: p.organization?.description || null,
                                industry: p.organization?.industry || null,
                                size: p.organization?.size || null,
                                address: p.organization?.location ? {
                                    full_location: p.organization.location.name || location || null,
                                    country: p.organization.location.country || null,
                                    city: p.organization.location.city || null,
                                    region: p.organization.location.region || null
                                } : (location ? { full_location: location } : {}),
                                created_at: new Date().toISOString(),
                                updated_at: new Date().toISOString()
                            };
                            const companyResult = await upsertCompanyActivity(companyData);
                            if (companyResult.success && companyResult.company) {
                                companyId = companyResult.company.id;
                                await logWorkflowExecutionActivity({
                                    workflowId,
                                    workflowType: 'idealClientProfileMiningWorkflow',
                                    status: 'INFO',
                                    input: options,
                                    output: {
                                        companyCreated: {
                                            company_id: companyId,
                                            company_name: company_name,
                                            message: 'Company created/updated successfully'
                                        }
                                    },
                                });
                            }
                            else {
                                await logWorkflowExecutionActivity({
                                    workflowId,
                                    workflowType: 'idealClientProfileMiningWorkflow',
                                    status: 'WARNING',
                                    input: options,
                                    output: {
                                        companyCreationFailed: {
                                            company_name: company_name,
                                            error: companyResult.error || 'Unknown error',
                                            message: 'Company creation failed, proceeding without company_id'
                                        }
                                    },
                                });
                            }
                        }
                        catch (companyError) {
                            await logWorkflowExecutionActivity({
                                workflowId,
                                workflowType: 'idealClientProfileMiningWorkflow',
                                status: 'WARNING',
                                input: options,
                                output: {
                                    companyCreationException: {
                                        company_name: company_name,
                                        error: companyError,
                                        message: 'Company creation exception, proceeding without company_id'
                                    }
                                },
                            });
                        }
                    }
                    // Get segment_id from role_query_segments relationship
                    let segmentId = undefined;
                    try {
                        const segmentResult = await getSegmentIdFromRoleQueryActivity(roleQueryId);
                        if (segmentResult.success && segmentResult.segmentId) {
                            segmentId = segmentResult.segmentId;
                            await logWorkflowExecutionActivity({
                                workflowId,
                                workflowType: 'idealClientProfileMiningWorkflow',
                                status: 'INFO',
                                input: options,
                                output: {
                                    segmentFound: {
                                        roleQueryId,
                                        segmentId,
                                        message: 'Found segment_id from role_query_segments relationship'
                                    }
                                },
                            });
                        }
                        else {
                            await logWorkflowExecutionActivity({
                                workflowId,
                                workflowType: 'idealClientProfileMiningWorkflow',
                                status: 'WARNING',
                                input: options,
                                output: {
                                    segmentNotFound: {
                                        roleQueryId,
                                        error: segmentResult.error || 'No segment found',
                                        message: 'No segment found for this role_query_id'
                                    }
                                },
                            });
                        }
                    }
                    catch (segmentError) {
                        await logWorkflowExecutionActivity({
                            workflowId,
                            workflowType: 'idealClientProfileMiningWorkflow',
                            status: 'WARNING',
                            input: options,
                            output: {
                                segmentLookupException: {
                                    roleQueryId,
                                    error: segmentError,
                                    message: 'Exception getting segment_id, proceeding without segment'
                                }
                            },
                        });
                    }
                    // Create lead for this person with validated contact info
                    try {
                        await logWorkflowExecutionActivity({
                            workflowId,
                            workflowType: 'idealClientProfileMiningWorkflow',
                            status: 'INFO',
                            input: options,
                            output: {
                                creatingEnrichedLead: {
                                    person_id: personRow.id,
                                    email: validatedEmail || null,
                                    telephone: hasPhone ? personRow.phones[0] : null,
                                    full_name: full_name,
                                    company_name: company_name,
                                    company_id: companyId || null,
                                    segment_id: segmentId || null,
                                    contactMethod: validatedEmail ? 'email' : 'phone',
                                    enrichedData: {
                                        address: {
                                            country: p.organization?.location?.country || p.location?.split(', ').pop() || null,
                                            city: p.organization?.location?.city || p.location?.split(', ')[0] || null,
                                            region: p.organization?.location?.region || null,
                                            full_location: p.location || null
                                        },
                                        social_networks: {
                                            linkedin_id: p.external_person_id || null,
                                            linkedin_url: p.person?.linkedin_url || null,
                                            twitter: p.person?.twitter || null,
                                            facebook: p.person?.facebook || null
                                        },
                                        company: {
                                            name: company_name,
                                            website: p.organization?.website || null,
                                            domain: p.organization?.domain || null,
                                            industry: p.organization?.industry || null,
                                            size: p.organization?.size || null,
                                            description: p.organization?.description || null,
                                            location: p.organization?.location || null,
                                            external_organization_id: p.external_organization_id || null
                                        },
                                        metadata: {
                                            external_person_id: p.external_person_id,
                                            external_role_id: p.external_role_id,
                                            role_title: role_title,
                                            is_current: is_current,
                                            start_date: p.start_date,
                                            end_date: p.end_date,
                                            source: 'icp_mining_workflow',
                                            role_query_id: roleQueryId,
                                            icp_mining_id: icpId
                                        }
                                    }
                                }
                            },
                        });
                        // Create lead with validated contact info and person_id
                        const leadData = {
                            name: full_name,
                            email: validatedEmail || null, // Use validated email if available
                            company_name: company_name,
                            position: role_title,
                            telephone: validatedEmail ? null : (hasPhone ? personRow.phones[0] : null), // Use phone if no email
                            web: p.organization?.website || null,
                            address: {
                                country: p.organization?.location?.country || p.location?.split(', ').pop() || null,
                                city: p.organization?.location?.city || p.location?.split(', ')[0] || null,
                                region: p.organization?.location?.region || null,
                                full_location: p.location || null
                            },
                            social_networks: {
                                linkedin_id: p.external_person_id || null,
                                linkedin_url: p.person?.linkedin_url || null,
                                twitter: p.person?.twitter || null,
                                facebook: p.person?.facebook || null
                            },
                            company: {
                                name: company_name,
                                website: p.organization?.website || null,
                                domain: p.organization?.domain || null,
                                industry: p.organization?.industry || null,
                                size: p.organization?.size || null,
                                description: p.organization?.description || null,
                                location: p.organization?.location || null,
                                external_organization_id: p.external_organization_id || null
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
                                source: 'icp_mining_workflow',
                                mining_date: new Date().toISOString(),
                                role_query_id: roleQueryId,
                                icp_mining_id: icpId
                            },
                            person_id: personRow.id // Add person_id to link lead to person
                        };
                        const leadResult = await createSingleLead(leadData, options.site_id, actualUserId, // Use the actual user_id from site information
                        companyId, // Use the company_id from upserted company
                        segmentId // Use the segment_id from role_query_segments relationship
                        );
                        if (leadResult.success) {
                            await logWorkflowExecutionActivity({
                                workflowId,
                                workflowType: 'idealClientProfileMiningWorkflow',
                                status: 'INFO',
                                input: options,
                                output: {
                                    enrichedLeadCreated: {
                                        leadId: leadResult.leadId,
                                        person_id: personRow.id,
                                        email: validatedEmail || null,
                                        telephone: hasPhone ? personRow.phones[0] : null,
                                        full_name: full_name,
                                        company_name: company_name,
                                        company_id: companyId || null,
                                        segment_id: segmentId || null,
                                        site_id: options.site_id,
                                        contactMethod: validatedEmail ? 'email' : 'phone',
                                        enrichedFields: {
                                            hasAddress: !!(leadData.address && Object.keys(leadData.address).length > 0),
                                            hasSocialNetworks: !!(leadData.social_networks && Object.keys(leadData.social_networks).length > 0),
                                            hasCompanyData: !!(leadData.company && Object.keys(leadData.company).length > 0),
                                            hasMetadata: !!(leadData.metadata && Object.keys(leadData.metadata).length > 0),
                                            linkedinId: leadData.social_networks?.linkedin_id || null,
                                            country: leadData.address?.country || null,
                                            industry: leadData.company?.industry || null,
                                            externalPersonId: leadData.metadata?.external_person_id || null
                                        }
                                    }
                                },
                            });
                        }
                        else {
                            throw new Error(leadResult.error || 'Failed to create lead');
                        }
                    }
                    catch (leadError) {
                        const err = `Failed to create lead for ${full_name}: ${leadError}`;
                        errors.push(err);
                        await updateIcpMiningProgressActivity({ id: icpId, appendError: err });
                    }
                }
                processed += 1;
                await updateIcpMiningProgressActivity({ id: icpId, deltaProcessed: 1, deltaFound: validatedEmail ? 1 : 0 });
            }
            // Check if we've reached our target
            if (foundMatches >= targetLeadsWithEmail) {
                await logWorkflowExecutionActivity({
                    workflowId,
                    workflowType: 'idealClientProfileMiningWorkflow',
                    status: 'INFO',
                    input: options,
                    output: {
                        targetReached: {
                            foundMatches,
                            targetLeadsWithEmail,
                            message: `Target reached! Found ${foundMatches} leads with valid email (target: ${targetLeadsWithEmail})`
                        }
                    },
                });
                break;
            }
            // stop if fewer than pageSize results (no more pages)
            if (!pageRes.hasMore) {
                await logWorkflowExecutionActivity({
                    workflowId,
                    workflowType: 'idealClientProfileMiningWorkflow',
                    status: 'INFO',
                    input: options,
                    output: {
                        noMorePages: {
                            foundMatches,
                            targetLeadsWithEmail,
                            message: `No more pages available. Found ${foundMatches} leads with valid email (target: ${targetLeadsWithEmail})`
                        }
                    },
                });
                break;
            }
            // Move to next page
            currentPage++;
        }
        // Check if we've reached our target of leads with valid email
        const targetReached = foundMatches >= targetLeadsWithEmail;
        // Check if all targets have been processed before marking as completed
        // Only mark as completed if we have a valid totalTargets and have processed all of them
        const allTargetsProcessed = totalTargets !== undefined && totalTargets > 0 && processed >= totalTargets;
        // Special case: if totalTargets is 0 or undefined, we should not mark as completed
        // This prevents premature completion when the API doesn't return a valid total
        const hasValidTotalTargets = totalTargets !== undefined && totalTargets > 0;
        if (targetReached) {
            // Target reached - mark as completed
            const success = errors.length === 0;
            await markIcpMiningCompletedActivity({ id: icpId, failed: !success, last_error: success ? null : errors[errors.length - 1] });
            await logWorkflowExecutionActivity({
                workflowId,
                workflowType: 'idealClientProfileMiningWorkflow',
                status: 'INFO',
                input: options,
                output: {
                    icpMiningTargetReached: {
                        icpId,
                        processed,
                        foundMatches,
                        targetLeadsWithEmail,
                        message: `ICP mining completed - target reached! Found ${foundMatches}/${targetLeadsWithEmail} leads with valid email.`
                    }
                },
            });
        }
        else if (allTargetsProcessed) {
            // All targets processed - mark as completed
            const success = errors.length === 0;
            await markIcpMiningCompletedActivity({ id: icpId, failed: !success, last_error: success ? null : errors[errors.length - 1] });
            await logWorkflowExecutionActivity({
                workflowId,
                workflowType: 'idealClientProfileMiningWorkflow',
                status: 'INFO',
                input: options,
                output: {
                    icpMiningCompleted: {
                        icpId,
                        processed,
                        totalTargets,
                        message: `ICP mining completed - processed ${processed}/${totalTargets} targets.`
                    }
                },
            });
        }
        else if (!hasValidTotalTargets) {
            // No valid total targets - set back to pending but preserve original total targets
            await updateIcpMiningProgressActivity({
                id: icpId,
                status: 'pending',
                last_error: errors.length > 0 ? errors[errors.length - 1] : null
            });
            await logWorkflowExecutionActivity({
                workflowId,
                workflowType: 'idealClientProfileMiningWorkflow',
                status: 'INFO',
                input: options,
                output: {
                    icpMiningNoValidTargets: {
                        icpId,
                        processed,
                        foundMatches,
                        targetLeadsWithEmail,
                        totalTargets,
                        message: `ICP mining not completed - no valid total targets (${totalTargets}). Found ${foundMatches}/${targetLeadsWithEmail} leads with email. Setting status back to pending.`
                    }
                },
            });
        }
        else {
            // Not all targets processed - set back to pending for next execution
            await updateIcpMiningProgressActivity({
                id: icpId,
                status: 'pending',
                last_error: errors.length > 0 ? errors[errors.length - 1] : null
            });
            await logWorkflowExecutionActivity({
                workflowId,
                workflowType: 'idealClientProfileMiningWorkflow',
                status: 'INFO',
                input: options,
                output: {
                    icpMiningNotCompleted: {
                        icpId,
                        processed,
                        foundMatches,
                        targetLeadsWithEmail,
                        totalTargets,
                        message: `ICP mining not completed - processed ${processed}/${totalTargets} targets. Found ${foundMatches}/${targetLeadsWithEmail} leads with email. Setting status back to pending.`
                    }
                },
            });
        }
        return { processed, foundMatches, totalTargets };
    };
    // Decide processing mode: single id or batch pending
    const isBatch = !options.icp_mining_id || options.icp_mining_id === 'ALL';
    if (!isBatch) {
        // Single processing path (backwards compatible)
        const icpRes = await getIcpMiningByIdActivity(options.icp_mining_id);
        if (!icpRes.success || !icpRes.icp) {
            const msg = icpRes.error || 'icp_mining not found';
            errors.push(msg);
            await markIcpMiningCompletedActivity({ id: options.icp_mining_id, failed: true, last_error: msg });
            return { success: false, icp_mining_id: options.icp_mining_id, processed: 0, foundMatches: 0, errors };
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
    // Batch processing: get only the first pending record for this site_id
    const pending = await getPendingIcpMiningActivity({ limit: 1, site_id: options.site_id });
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
        return { success: false, icp_mining_id: 'batch', processed: 0, foundMatches: 0, errors: [errorMsg] };
    }
    const items = pending.items || [];
    await logWorkflowExecutionActivity({
        workflowId,
        workflowType: 'idealClientProfileMiningWorkflow',
        status: 'INFO',
        input: options,
        output: {
            pendingItemsCount: items.length,
            pendingItems: items.map(i => ({ id: i.id, role_query_id: i.role_query_id, status: i.status, name: i.name }))
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
    // Process only the first (and only) pending record
    const icp = items[0];
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
