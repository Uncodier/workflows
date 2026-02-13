"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.callPersonContactsLookupActivity = void 0;
exports.callPersonRoleSearchActivity = callPersonRoleSearchActivity;
exports.callPersonWorkEmailsActivity = callPersonWorkEmailsActivity;
exports.callPersonContactsLookupPhoneNumbersActivity = callPersonContactsLookupPhoneNumbersActivity;
exports.callPersonContactsLookupPersonalEmailsActivity = callPersonContactsLookupPersonalEmailsActivity;
exports.callPersonContactsLookupDetailsActivity = callPersonContactsLookupDetailsActivity;
exports.getRoleQueryByIdActivity = getRoleQueryByIdActivity;
exports.getIcpMiningByIdActivity = getIcpMiningByIdActivity;
exports.updateIcpMiningProgressActivity = updateIcpMiningProgressActivity;
exports.markIcpMiningStartedActivity = markIcpMiningStartedActivity;
exports.markIcpMiningCompletedActivity = markIcpMiningCompletedActivity;
exports.getPendingIcpMiningActivity = getPendingIcpMiningActivity;
exports.checkExistingPersonActivity = checkExistingPersonActivity;
exports.checkPersonByLinkedInActivity = checkPersonByLinkedInActivity;
exports.checkExistingLeadForPersonActivity = checkExistingLeadForPersonActivity;
exports.upsertPersonActivity = upsertPersonActivity;
exports.updatePersonEmailsActivity = updatePersonEmailsActivity;
exports.getSegmentIdFromRoleQueryActivity = getSegmentIdFromRoleQueryActivity;
exports.upsertLeadForPersonActivity = upsertLeadForPersonActivity;
const apiService_1 = require("../services/apiService");
const services_1 = require("../services");
const personRoleUtils_1 = require("../utils/personRoleUtils");
// Finder API: person role search
async function callPersonRoleSearchActivity(options) {
    const { role_query_id, query, page, page_size = 10 } = options;
    try {
        // Use query data if provided, otherwise fall back to role_query_id
        const requestBody = query ? {
            ...query, // Spread the query parameters directly into the body
            page,
            page_size,
        } : {
            role_query_id,
            page,
            page_size,
        };
        // Log the request body for debugging
        console.log('🔍 Person Role Search API Request:', JSON.stringify(requestBody, null, 2));
        const response = await apiService_1.apiService.post('/api/finder/person_role_search', requestBody);
        if (!response.success) {
            return { success: false, error: response.error?.message || 'Finder person_role_search failed' };
        }
        const payload = response.data?.data || response.data;
        const persons = payload?.persons || payload?.results || [];
        const meta = payload?.meta || {};
        // Normalize pagination metadata (do not coerce total when absent)
        const total = (typeof meta.total === 'number'
            ? meta.total
            : (typeof payload?.total === 'number' ? payload.total : undefined));
        const currentPage = (typeof meta.page === 'number' ? meta.page : page); // Finder may be 0- or 1-based
        const normalizedPageSize = (typeof meta.page_size === 'number'
            ? meta.page_size
            : (typeof meta.pageSize === 'number' ? meta.pageSize : page_size));
        // Prefer explicit hasMore; otherwise derive by page fullness when total is unknown
        const explicitHasMore = (typeof meta.has_more === 'boolean'
            ? meta.has_more
            : (typeof meta.hasMore === 'boolean' ? meta.hasMore : undefined));
        const derivedHasMore = (typeof total === 'number')
            ? ((currentPage + 1) * normalizedPageSize < total)
            : (Array.isArray(persons) && persons.length === normalizedPageSize);
        return {
            success: true,
            data: payload,
            persons,
            total,
            page: currentPage,
            pageSize: normalizedPageSize,
            hasMore: explicitHasMore !== undefined ? explicitHasMore : derivedHasMore,
        };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message };
    }
}
// Finder API: person contacts lookup (work emails)
async function callPersonWorkEmailsActivity(options) {
    try {
        const requestBody = {};
        if (options.person_id) {
            requestBody.person_id = options.person_id;
        }
        else if (options.linkedin_profile) {
            requestBody.linkedin_profile = options.linkedin_profile;
        }
        else if (options.external_person_id) {
            requestBody.external_person_id = options.external_person_id;
        }
        if (options.full_name)
            requestBody.full_name = options.full_name;
        if (options.company_name)
            requestBody.company_name = options.company_name;
        const response = await apiService_1.apiService.post('/api/finder/person_contacts_lookup/work_emails', requestBody);
        if (!response.success) {
            return { success: false, error: response.error?.message || 'Finder person_contacts_lookup failed' };
        }
        const payload = response.data?.data || response.data;
        // Return structured array format
        const emails = Array.isArray(payload) ? payload : (payload?.emails || payload?.work_emails || []);
        return { success: true, data: payload, emails };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message };
    }
}
// Legacy alias for backward compatibility (deprecated - use callPersonWorkEmailsActivity)
exports.callPersonContactsLookupActivity = callPersonWorkEmailsActivity;
// Finder API: person contacts lookup (phone numbers)
async function callPersonContactsLookupPhoneNumbersActivity(options) {
    try {
        const requestBody = {};
        if (options.person_id) {
            requestBody.person_id = options.person_id;
        }
        else if (options.linkedin_profile) {
            requestBody.linkedin_profile = options.linkedin_profile;
        }
        else if (options.external_person_id) {
            requestBody.external_person_id = options.external_person_id;
        }
        if (options.full_name)
            requestBody.full_name = options.full_name;
        if (options.company_name)
            requestBody.company_name = options.company_name;
        const response = await apiService_1.apiService.post('/api/finder/person_contacts_lookup/phone_numbers', requestBody);
        if (!response.success) {
            return { success: false, error: response.error?.message || 'Finder person_contacts_lookup phone_numbers failed' };
        }
        const payload = response.data?.data || response.data;
        // Return structured array format
        const phoneNumbers = Array.isArray(payload) ? payload : (payload?.phone_numbers || payload?.phones || []);
        return { success: true, data: payload, phoneNumbers };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message };
    }
}
// Finder API: person contacts lookup (personal emails)
async function callPersonContactsLookupPersonalEmailsActivity(options) {
    try {
        const requestBody = {};
        if (options.person_id) {
            requestBody.person_id = options.person_id;
        }
        else if (options.linkedin_profile) {
            requestBody.linkedin_profile = options.linkedin_profile;
        }
        else if (options.external_person_id) {
            requestBody.external_person_id = options.external_person_id;
        }
        if (options.full_name)
            requestBody.full_name = options.full_name;
        if (options.company_name)
            requestBody.company_name = options.company_name;
        const response = await apiService_1.apiService.post('/api/finder/person_contacts_lookup/personal_emails', requestBody);
        if (!response.success) {
            return { success: false, error: response.error?.message || 'Finder person_contacts_lookup personal_emails failed' };
        }
        const payload = response.data?.data || response.data;
        // Return structured array format
        const emails = Array.isArray(payload) ? payload : (payload?.emails || payload?.personal_emails || []);
        return { success: true, data: payload, emails };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message };
    }
}
// Finder API: person contacts lookup (details) - creates person, companies, and lead
async function callPersonContactsLookupDetailsActivity(options) {
    try {
        const supabaseService = (0, services_1.getSupabaseService)();
        const isConnected = await supabaseService.getConnectionStatus();
        if (!isConnected) {
            return { success: false, error: 'Database not available' };
        }
        // Call API endpoint
        const requestBody = { person_id: options.person_id };
        console.log(`📞 Calling person_contacts_lookup/details with person_id: ${options.person_id}`);
        const response = await apiService_1.apiService.post('/api/finder/person_contacts_lookup/details', requestBody);
        if (!response.success) {
            return { success: false, error: response.error?.message || 'Finder person_contacts_lookup/details failed' };
        }
        const personData = response.data?.data || response.data;
        if (!personData) {
            return { success: false, error: 'No data returned from API' };
        }
        console.log(`✅ Received person details data for person_id: ${personData.id}`);
        // Extract current role: match by company_name from context, or most recent start_date among is_current
        const currentRole = (0, personRoleUtils_1.selectRoleForEnrichment)(personData.roles ?? [], {
            company_name: options.company_name ?? undefined,
        }) ?? personData.roles?.[0];
        const currentOrganization = currentRole?.organization;
        // Extract person data
        const personLocation = personData.location?.name || null;
        const linkedinUrl = personData.linkedin_info?.public_profile_url || null;
        // Prepare person record
        const personRecord = {
            external_person_id: personData.id,
            external_role_id: currentRole?.id || null,
            external_organization_id: currentOrganization?.id || null,
            full_name: personData.full_name || null,
            role_title: currentRole?.role_title || null,
            company_name: currentRole?.organization_name || currentOrganization?.name || null,
            start_date: currentRole?.start_date || null,
            end_date: currentRole?.end_date || null,
            is_current: currentRole?.is_current || false,
            location: personLocation,
            emails: null, // Will be enriched later
            phones: null, // Will be enriched later
            raw_result: personData,
        };
        // Create/update person
        console.log(`👤 Creating/updating person: ${personRecord.full_name}`);
        const personResult = await upsertPersonActivity(personRecord);
        if (!personResult.success) {
            return { success: false, error: `Failed to create/update person: ${personResult.error}` };
        }
        const createdPerson = personResult.person;
        console.log(`✅ Person created/updated: ${createdPerson.id}`);
        // Extract and create/update companies from all roles
        const companies = [];
        const organizationsMap = new Map();
        // Collect unique organizations from roles
        if (personData.roles && Array.isArray(personData.roles)) {
            for (const role of personData.roles) {
                if (role.organization && !organizationsMap.has(role.organization.id?.toString() || role.organization.name)) {
                    organizationsMap.set(role.organization.id?.toString() || role.organization.name, role.organization);
                }
            }
        }
        // Also check educations for organization data
        if (personData.educations && Array.isArray(personData.educations)) {
            for (const education of personData.educations) {
                if (education.organization && !organizationsMap.has(education.organization.id?.toString() || education.organization.name)) {
                    organizationsMap.set(education.organization.id?.toString() || education.organization.name, education.organization);
                }
            }
        }
        // Create/update companies
        console.log(`🏢 Creating/updating ${organizationsMap.size} companies`);
        let currentCompanyId = undefined;
        for (const [key, org] of organizationsMap.entries()) {
            try {
                const companyData = {
                    name: org.name || null,
                    website: org.domain || null,
                    linkedin_url: org.linkedin_info?.public_profile_url || null,
                };
                // Extract industry if available
                if (org.linkedin_info?.industry?.name) {
                    companyData.industry = org.linkedin_info.industry.name;
                }
                if (companyData.name) {
                    const company = await supabaseService.upsertCompany(companyData);
                    companies.push(company);
                    console.log(`✅ Company created/updated: ${company.name} (${company.id})`);
                    // Track the current company (from current role) for lead association
                    if (currentOrganization &&
                        (org.id?.toString() === currentOrganization.id?.toString() ||
                            org.name === currentOrganization.name)) {
                        currentCompanyId = company.id;
                        console.log(`🔗 Current company identified for lead: ${company.name} (${company.id})`);
                    }
                }
            }
            catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                console.error(`❌ Failed to create/update company ${org.name}: ${errorMsg}`);
                // Continue with other companies
            }
        }
        // Create/update lead if site_id is provided
        let lead = null;
        if (options.site_id && createdPerson) {
            console.log(`📋 Creating/updating lead for site: ${options.site_id}`);
            // Extract primary email and phone if available (from person data or roles)
            // Note: The details endpoint might not include contact info, so we'll create lead without it
            // Contact enrichment can happen later via other endpoints
            const leadResult = await upsertLeadForPersonActivity({
                person_id: createdPerson.id,
                site_id: options.site_id,
                name: personRecord.full_name || undefined,
                email: undefined, // Will be enriched later
                phone: undefined, // Will be enriched later
                personal_email: undefined, // Will be enriched later
                userId: options.userId,
                company_id: currentCompanyId, // Associate lead with current company
            });
            if (leadResult.success) {
                lead = leadResult.lead;
                console.log(`✅ Lead created/updated: ${leadResult.leadId}`);
            }
            else {
                console.error(`❌ Failed to create/update lead: ${leadResult.error}`);
                // Don't fail the whole operation if lead creation fails
            }
        }
        return {
            success: true,
            person: createdPerson,
            companies,
            lead,
        };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`❌ Error in callPersonContactsLookupDetailsActivity: ${message}`);
        return { success: false, error: message };
    }
}
// Get role query data by ID
async function getRoleQueryByIdActivity(id) {
    try {
        const supabaseService = (0, services_1.getSupabaseService)();
        const isConnected = await supabaseService.getConnectionStatus();
        if (!isConnected) {
            return { success: false, error: 'Database not available' };
        }
        const { supabaseServiceRole } = await Promise.resolve().then(() => __importStar(require('../../lib/supabase/client')));
        const { data, error } = await supabaseServiceRole
            .from('role_queries')
            .select('*')
            .eq('id', id)
            .single();
        if (error) {
            return { success: false, error: error.message };
        }
        return { success: true, roleQuery: data };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message };
    }
}
// Read ICP Mining by ID
async function getIcpMiningByIdActivity(id) {
    try {
        const supabaseService = (0, services_1.getSupabaseService)();
        const isConnected = await supabaseService.getConnectionStatus();
        if (!isConnected) {
            return { success: false, error: 'Database not available' };
        }
        const { supabaseServiceRole } = await Promise.resolve().then(() => __importStar(require('../../lib/supabase/client')));
        const { data, error } = await supabaseServiceRole
            .from('icp_mining')
            .select('*')
            .eq('id', id)
            .single();
        if (error) {
            return { success: false, error: error.message };
        }
        return { success: true, icp: data };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message };
    }
}
// Update ICP Mining progress and status
async function updateIcpMiningProgressActivity(options) {
    try {
        const supabaseService = (0, services_1.getSupabaseService)();
        const isConnected = await supabaseService.getConnectionStatus();
        if (!isConnected) {
            return { success: false, error: 'Database not available' };
        }
        const { supabaseServiceRole } = await Promise.resolve().then(() => __importStar(require('../../lib/supabase/client')));
        // Fetch current row
        const { data: current, error: fetchError } = await supabaseServiceRole
            .from('icp_mining')
            .select('processed_targets, found_matches, errors, total_targets')
            .eq('id', options.id)
            .single();
        if (fetchError) {
            return { success: false, error: fetchError.message };
        }
        const newProcessed = (current?.processed_targets || 0) + (options.deltaProcessed || 0);
        const newFound = (current?.found_matches || 0) + (options.deltaFound || 0);
        const errors = Array.isArray(current?.errors) ? current.errors.slice() : [];
        if (options.appendError) {
            errors.push({ timestamp: new Date().toISOString(), message: options.appendError });
        }
        const updates = {
            processed_targets: newProcessed,
            found_matches: newFound,
            last_progress_at: new Date().toISOString(),
            ...(options.status && { status: options.status }),
            // Only update total_targets if explicitly provided, otherwise preserve existing value
            ...(options.totalTargets !== undefined && { total_targets: options.totalTargets }),
            ...(options.last_error !== undefined && { last_error: options.last_error }),
            errors,
            ...(options.currentPage !== undefined && { current_page: options.currentPage }),
        };
        const { error: updateError } = await supabaseServiceRole
            .from('icp_mining')
            .update(updates)
            .eq('id', options.id);
        if (updateError) {
            return { success: false, error: updateError.message };
        }
        return { success: true };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message };
    }
}
// Mark ICP mining started
async function markIcpMiningStartedActivity(options) {
    try {
        const supabaseService = (0, services_1.getSupabaseService)();
        const isConnected = await supabaseService.getConnectionStatus();
        if (!isConnected)
            return { success: false, error: 'Database not available' };
        const { supabaseServiceRole } = await Promise.resolve().then(() => __importStar(require('../../lib/supabase/client')));
        const { error } = await supabaseServiceRole
            .from('icp_mining')
            .update({ status: 'running', started_at: new Date().toISOString(), last_progress_at: new Date().toISOString() })
            .eq('id', options.id);
        if (error)
            return { success: false, error: error.message };
        return { success: true };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message };
    }
}
// Mark ICP mining completed
async function markIcpMiningCompletedActivity(options) {
    try {
        const supabaseService = (0, services_1.getSupabaseService)();
        const isConnected = await supabaseService.getConnectionStatus();
        if (!isConnected)
            return { success: false, error: 'Database not available' };
        const { supabaseServiceRole } = await Promise.resolve().then(() => __importStar(require('../../lib/supabase/client')));
        const { error } = await supabaseServiceRole
            .from('icp_mining')
            .update({ status: options.failed ? 'failed' : 'completed', finished_at: new Date().toISOString(), last_error: options.last_error ?? null })
            .eq('id', options.id);
        if (error)
            return { success: false, error: error.message };
        return { success: true };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message };
    }
}
// List pending ICP Mining rows (optionally limited and filtered by site_id)
async function getPendingIcpMiningActivity(options) {
    try {
        const supabaseService = (0, services_1.getSupabaseService)();
        const isConnected = await supabaseService.getConnectionStatus();
        if (!isConnected)
            return { success: false, error: 'Database not available' };
        const { supabaseServiceRole } = await Promise.resolve().then(() => __importStar(require('../../lib/supabase/client')));
        const limit = options?.limit && options.limit > 0 ? options.limit : 50;
        let query = supabaseServiceRole
            .from('icp_mining')
            .select('*')
            .in('status', ['running', 'pending'])
            .order('created_at', { ascending: true })
            .limit(limit);
        // Filter by site_id if provided
        if (options?.site_id) {
            query = query.eq('site_id', options.site_id);
        }
        console.log(`🔍 ICP Mining Query: site_id=${options?.site_id}, limit=${limit}`);
        // First, let's check what records exist for this site_id (any status)
        const { data: allRecords } = await supabaseServiceRole
            .from('icp_mining')
            .select('id, status, site_id, name, created_at')
            .eq('site_id', options?.site_id || '')
            .order('created_at', { ascending: false })
            .limit(10);
        console.log(`📊 All ICP Mining records for site_id ${options?.site_id}:`, allRecords);
        const { data, error } = await query;
        if (error) {
            console.error(`❌ ICP Mining Query Error:`, error);
            return { success: false, error: error.message };
        }
        console.log(`📊 ICP Mining Results: found ${data?.length || 0} items`);
        if (data && data.length > 0) {
            console.log(`📋 Sample ICP Mining item:`, {
                id: data[0].id,
                status: data[0].status,
                icp_criteria: data[0].icp_criteria,
                site_id_in_criteria: data[0].icp_criteria?.site_id
            });
        }
        return { success: true, items: data || [] };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message };
    }
}
// Check if person already exists
async function checkExistingPersonActivity(options) {
    try {
        const supabaseService = (0, services_1.getSupabaseService)();
        const isConnected = await supabaseService.getConnectionStatus();
        if (!isConnected)
            return { success: false, hasExistingPerson: false, error: 'Database not available' };
        const { supabaseServiceRole } = await Promise.resolve().then(() => __importStar(require('../../lib/supabase/client')));
        let query = supabaseServiceRole
            .from('persons')
            .select('id, full_name, company_name, external_person_id, external_role_id, emails, phones, created_at, updated_at');
        // Try to find by external IDs first (most reliable)
        if (options.external_person_id && options.external_role_id) {
            query = query
                .eq('external_person_id', options.external_person_id)
                .eq('external_role_id', options.external_role_id);
        }
        else if (options.external_person_id) {
            query = query.eq('external_person_id', options.external_person_id);
        }
        else if (options.full_name && options.company_name) {
            // Fallback to name and company match
            query = query
                .eq('full_name', options.full_name)
                .eq('company_name', options.company_name);
        }
        else {
            return { success: true, hasExistingPerson: false };
        }
        const { data: existingPerson, error } = await query
            .limit(1)
            .maybeSingle();
        if (error)
            return { success: false, hasExistingPerson: false, error: error.message };
        const hasExistingPerson = !!existingPerson;
        return {
            success: true,
            hasExistingPerson,
            existingPerson: hasExistingPerson ? existingPerson : undefined
        };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, hasExistingPerson: false, error: message };
    }
}
// Check person by LinkedIn profile URL or person_id
async function checkPersonByLinkedInActivity(options) {
    try {
        const supabaseService = (0, services_1.getSupabaseService)();
        const isConnected = await supabaseService.getConnectionStatus();
        if (!isConnected)
            return { success: false, hasExistingPerson: false, error: 'Database not available' };
        const { supabaseServiceRole } = await Promise.resolve().then(() => __importStar(require('../../lib/supabase/client')));
        // If person_id is provided, check if it's a UUID or external_person_id
        if (options.person_id) {
            // Check if person_id is a valid UUID format
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            const isUUID = uuidRegex.test(options.person_id);
            let person = null;
            let error = null;
            if (isUUID) {
                // Search by UUID (id field)
                const result = await supabaseServiceRole
                    .from('persons')
                    .select('*')
                    .eq('id', options.person_id)
                    .maybeSingle();
                person = result.data;
                error = result.error;
            }
            else {
                // Search by external_person_id (numeric string)
                // Note: There might be multiple persons with same external_person_id but different external_role_id
                // We'll get the first one and log if there are multiple
                const result = await supabaseServiceRole
                    .from('persons')
                    .select('*')
                    .eq('external_person_id', options.person_id)
                    .order('created_at', { ascending: false }) // Get the most recent one
                    .limit(1)
                    .maybeSingle();
                person = result.data;
                error = result.error;
                // Check if there are multiple matches (for logging)
                if (!error && person) {
                    const countResult = await supabaseServiceRole
                        .from('persons')
                        .select('id', { count: 'exact', head: true })
                        .eq('external_person_id', options.person_id);
                    if (countResult.count && countResult.count > 1) {
                        console.log(`⚠️ Found ${countResult.count} persons with external_person_id ${options.person_id}, using the most recent one`);
                    }
                }
            }
            if (error)
                return { success: false, hasExistingPerson: false, error: error.message };
            return {
                success: true,
                hasExistingPerson: !!person,
                existingPerson: person || undefined
            };
        }
        // If linkedin_profile is provided, search in raw_result
        if (options.linkedin_profile) {
            // Fetch persons and filter in memory since JSONB queries can be complex
            // We'll fetch a reasonable batch and filter
            const { data: allPersons, error: fetchError } = await supabaseServiceRole
                .from('persons')
                .select('*')
                .limit(1000); // Reasonable limit for search
            if (fetchError) {
                console.error('❌ Error fetching persons for LinkedIn search:', fetchError);
                return { success: false, hasExistingPerson: false, error: fetchError.message };
            }
            // Filter in memory to find matching LinkedIn URL
            const matchingPerson = allPersons?.find((p) => {
                const rawResult = p.raw_result;
                if (!rawResult || !options.linkedin_profile)
                    return false;
                // Check multiple possible paths for LinkedIn URL
                const linkedinUrl1 = rawResult?.linkedin_info?.public_profile_url;
                const linkedinUrl2 = rawResult?.person?.linkedin_info?.public_profile_url;
                const linkedinUrl3 = rawResult?.linkedin_url;
                const normalizedLinkedIn = options.linkedin_profile.trim();
                return linkedinUrl1 === normalizedLinkedIn ||
                    linkedinUrl2 === normalizedLinkedIn ||
                    linkedinUrl3 === normalizedLinkedIn;
            });
            return {
                success: true,
                hasExistingPerson: !!matchingPerson,
                existingPerson: matchingPerson || undefined
            };
        }
        return { success: true, hasExistingPerson: false };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, hasExistingPerson: false, error: message };
    }
}
// Check if lead already exists for a person
async function checkExistingLeadForPersonActivity(options) {
    try {
        const supabaseService = (0, services_1.getSupabaseService)();
        const isConnected = await supabaseService.getConnectionStatus();
        if (!isConnected)
            return { success: false, hasExistingLead: false, error: 'Database not available' };
        const { supabaseServiceRole } = await Promise.resolve().then(() => __importStar(require('../../lib/supabase/client')));
        // Check if there's already a lead for this person
        const { data: existingLead, error } = await supabaseServiceRole
            .from('leads')
            .select('id, name, email, phone, personal_email, status, created_at, company_id')
            .eq('site_id', options.site_id)
            .eq('person_id', options.person_id)
            .limit(1)
            .maybeSingle();
        if (error)
            return { success: false, hasExistingLead: false, error: error.message };
        const hasExistingLead = !!existingLead;
        return {
            success: true,
            hasExistingLead,
            existingLead: hasExistingLead ? existingLead : undefined
        };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, hasExistingLead: false, error: message };
    }
}
// Upsert person into persons table
async function upsertPersonActivity(person) {
    try {
        const supabaseService = (0, services_1.getSupabaseService)();
        const isConnected = await supabaseService.getConnectionStatus();
        if (!isConnected)
            return { success: false, error: 'Database not available' };
        const { supabaseServiceRole } = await Promise.resolve().then(() => __importStar(require('../../lib/supabase/client')));
        // Try to find existing by unique external ids if available
        let existing = null;
        if (person.external_person_id && person.external_role_id) {
            const { data: found } = await supabaseServiceRole
                .from('persons')
                .select('*')
                .eq('external_person_id', person.external_person_id)
                .eq('external_role_id', person.external_role_id)
                .maybeSingle();
            existing = found || null;
        }
        const payload = {
            role_query_id: person.role_query_id || null,
            external_person_id: person.external_person_id ?? null,
            external_role_id: person.external_role_id ?? null,
            external_organization_id: person.external_organization_id ?? null,
            full_name: person.full_name ?? null,
            role_title: person.role_title ?? null,
            company_name: person.company_name ?? null,
            start_date: person.start_date ?? null,
            end_date: person.end_date ?? null,
            is_current: person.is_current ?? null,
            location: person.location ?? null,
            emails: person.emails ?? null,
            phones: person.phones ?? null,
            raw_result: person.raw_result,
            updated_at: new Date().toISOString(),
            ...(existing ? {} : { created_at: new Date().toISOString() }),
        };
        let resultRow;
        if (existing) {
            const { data, error } = await supabaseServiceRole
                .from('persons')
                .update(payload)
                .eq('id', existing.id)
                .select()
                .single();
            if (error)
                return { success: false, error: error.message };
            resultRow = data;
        }
        else {
            const { data, error } = await supabaseServiceRole
                .from('persons')
                .insert(payload)
                .select()
                .single();
            if (error)
                return { success: false, error: error.message };
            resultRow = data;
        }
        return { success: true, person: resultRow };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message };
    }
}
// Update person emails field
async function updatePersonEmailsActivity(options) {
    try {
        const supabaseService = (0, services_1.getSupabaseService)();
        const isConnected = await supabaseService.getConnectionStatus();
        if (!isConnected)
            return { success: false, error: 'Database not available' };
        const { supabaseServiceRole } = await Promise.resolve().then(() => __importStar(require('../../lib/supabase/client')));
        const { error } = await supabaseServiceRole
            .from('persons')
            .update({ emails: options.emails, updated_at: new Date().toISOString() })
            .eq('id', options.person_id);
        if (error)
            return { success: false, error: error.message };
        return { success: true };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message };
    }
}
/**
 * Get segment_id from role_query_segments relationship
 */
async function getSegmentIdFromRoleQueryActivity(roleQueryId) {
    try {
        const supabaseService = (0, services_1.getSupabaseService)();
        const isConnected = await supabaseService.getConnectionStatus();
        if (!isConnected)
            return { success: false, error: 'Database not available' };
        const { supabaseServiceRole } = await Promise.resolve().then(() => __importStar(require('../../lib/supabase/client')));
        const { data: roleQuerySegment, error } = await supabaseServiceRole
            .from('role_query_segments')
            .select('segment_id')
            .eq('role_query_id', roleQueryId)
            .limit(1)
            .maybeSingle();
        if (error) {
            console.error('❌ Error fetching segment from role_query_segments:', error);
            return { success: false, error: error.message };
        }
        if (!roleQuerySegment) {
            console.log(`⚠️ No segment found for role_query_id: ${roleQueryId}`);
            return { success: true, segmentId: undefined };
        }
        console.log(`✅ Found segment_id: ${roleQuerySegment.segment_id} for role_query_id: ${roleQueryId}`);
        return { success: true, segmentId: roleQuerySegment.segment_id };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message };
    }
}
// Upsert lead for person with enriched contact data
async function upsertLeadForPersonActivity(options) {
    try {
        const supabaseService = (0, services_1.getSupabaseService)();
        const isConnected = await supabaseService.getConnectionStatus();
        if (!isConnected)
            return { success: false, error: 'Database not available' };
        const { supabaseServiceRole } = await Promise.resolve().then(() => __importStar(require('../../lib/supabase/client')));
        // Check if lead already exists
        const { data: existingLead, error: checkError } = await supabaseServiceRole
            .from('leads')
            .select('*')
            .eq('person_id', options.person_id)
            .eq('site_id', options.site_id)
            .maybeSingle();
        if (checkError && checkError.code !== 'PGRST116') { // PGRST116 is "not found" which is OK
            return { success: false, error: checkError.message };
        }
        // Get person data for name if not provided
        let leadName = options.name;
        if (!leadName) {
            const { data: person } = await supabaseServiceRole
                .from('persons')
                .select('full_name')
                .eq('id', options.person_id)
                .single();
            leadName = person?.full_name || 'Unknown';
        }
        // Validate that person has at least one contact method: work email, personal email, or phone
        // Check person's emails (work emails) - use provided person_emails if available, otherwise query DB
        let personEmails = [];
        if (options.person_emails) {
            personEmails = Array.isArray(options.person_emails) ? options.person_emails : [];
        }
        else {
            const { data: personData } = await supabaseServiceRole
                .from('persons')
                .select('emails')
                .eq('id', options.person_id)
                .single();
            personEmails = personData?.emails || [];
        }
        const hasPersonWorkEmail = Array.isArray(personEmails) && personEmails.length > 0 && personEmails[0]?.trim() !== '';
        // Check if we have at least one contact method: work email, personal email, or phone
        const hasPersonalEmail = options.personal_email && options.personal_email.trim() !== '';
        const hasPhone = options.phone && options.phone.trim() !== '';
        // Also check existing lead for personal email or phone if not provided in options
        let hasExistingContact = false;
        if (existingLead) {
            const existingPersonalEmail = existingLead.personal_email && existingLead.personal_email.trim() !== '';
            const existingPhone = existingLead.phone && existingLead.phone.trim() !== '';
            hasExistingContact = existingPersonalEmail || existingPhone;
        }
        const hasAtLeastOneContact = hasPersonWorkEmail || hasPersonalEmail || hasPhone || hasExistingContact;
        if (!hasAtLeastOneContact) {
            return { success: false, error: 'Person must have at least 1 contact method (work email, personal email, or phone) to create/update lead' };
        }
        const leadData = {
            person_id: options.person_id,
            site_id: options.site_id,
            name: leadName,
            // If company_id is provided, it means lead will be enriched, so allow null/empty email
            // Otherwise, require email or phone for lead creation
            email: options.email !== undefined ? (options.email || '') : (options.company_id ? null : ''),
            phone: options.phone || null,
            personal_email: options.personal_email || null,
            updated_at: new Date().toISOString(),
        };
        // Add company_id if provided
        if (options.company_id) {
            leadData.company_id = options.company_id;
        }
        // Add segment_id if provided
        if (options.segment_id) {
            leadData.segment_id = options.segment_id;
        }
        // Append notes if provided
        if (options.notes) {
            if (existingLead?.notes) {
                leadData.notes = `${existingLead.notes}\n${options.notes}`;
            }
            else {
                leadData.notes = options.notes;
            }
        }
        if (options.userId) {
            leadData.user_id = options.userId;
        }
        let resultLead;
        if (existingLead) {
            // Update existing lead
            const { data, error } = await supabaseServiceRole
                .from('leads')
                .update(leadData)
                .eq('id', existingLead.id)
                .select()
                .single();
            if (error)
                return { success: false, error: error.message };
            resultLead = data;
        }
        else {
            // Create new lead
            if (!options.userId) {
                // Try to get user_id from site
                const { data: site } = await supabaseServiceRole
                    .from('sites')
                    .select('user_id')
                    .eq('id', options.site_id)
                    .single();
                if (site?.user_id) {
                    leadData.user_id = site.user_id;
                }
                else {
                    return { success: false, error: 'user_id is required to create lead' };
                }
            }
            leadData.status = 'new';
            leadData.origin = 'lead_enrichment_workflow';
            leadData.created_at = new Date().toISOString();
            const { data, error } = await supabaseServiceRole
                .from('leads')
                .insert([leadData])
                .select()
                .single();
            if (error)
                return { success: false, error: error.message };
            resultLead = data;
        }
        return { success: true, lead: resultLead, leadId: resultLead.id };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message };
    }
}
