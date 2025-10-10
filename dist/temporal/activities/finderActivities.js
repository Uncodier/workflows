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
exports.callPersonRoleSearchActivity = callPersonRoleSearchActivity;
exports.callPersonContactsLookupActivity = callPersonContactsLookupActivity;
exports.getRoleQueryByIdActivity = getRoleQueryByIdActivity;
exports.getIcpMiningByIdActivity = getIcpMiningByIdActivity;
exports.updateIcpMiningProgressActivity = updateIcpMiningProgressActivity;
exports.markIcpMiningStartedActivity = markIcpMiningStartedActivity;
exports.markIcpMiningCompletedActivity = markIcpMiningCompletedActivity;
exports.getPendingIcpMiningActivity = getPendingIcpMiningActivity;
exports.checkExistingPersonActivity = checkExistingPersonActivity;
exports.checkExistingLeadForPersonActivity = checkExistingLeadForPersonActivity;
exports.upsertPersonActivity = upsertPersonActivity;
exports.updatePersonEmailsActivity = updatePersonEmailsActivity;
exports.getSegmentIdFromRoleQueryActivity = getSegmentIdFromRoleQueryActivity;
const apiService_1 = require("../services/apiService");
const services_1 = require("../services");
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
async function callPersonContactsLookupActivity(options) {
    try {
        const response = await apiService_1.apiService.post('/api/finder/person_contacts_lookup/work_emails', options);
        if (!response.success) {
            return { success: false, error: response.error?.message || 'Finder person_contacts_lookup failed' };
        }
        const payload = response.data?.data || response.data;
        const emails = payload?.emails || payload?.work_emails || [];
        return { success: true, data: payload, emails };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
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
            .select('id, name, email, phone, status, created_at')
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
