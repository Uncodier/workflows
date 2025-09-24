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
exports.getIcpMiningByIdActivity = getIcpMiningByIdActivity;
exports.updateIcpMiningProgressActivity = updateIcpMiningProgressActivity;
exports.markIcpMiningStartedActivity = markIcpMiningStartedActivity;
exports.markIcpMiningCompletedActivity = markIcpMiningCompletedActivity;
exports.upsertPersonActivity = upsertPersonActivity;
exports.updatePersonEmailsActivity = updatePersonEmailsActivity;
const apiService_1 = require("../services/apiService");
const services_1 = require("../services");
// Finder API: person role search
async function callPersonRoleSearchActivity(options) {
    const { role_query_id, page, page_size = 10 } = options;
    try {
        const response = await apiService_1.apiService.post('/api/finder/person_role_search', {
            role_query_id,
            page,
            page_size,
        });
        if (!response.success) {
            return { success: false, error: response.error?.message || 'Finder person_role_search failed' };
        }
        const payload = response.data?.data || response.data;
        const persons = payload?.persons || payload?.results || [];
        const meta = payload?.meta || {};
        return {
            success: true,
            data: payload,
            persons,
            total: meta.total || payload?.total || persons.length,
            page: meta.page || page,
            pageSize: meta.pageSize || page_size,
            hasMore: meta.hasMore ?? (Array.isArray(persons) && persons.length === page_size),
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
            .select('processed_targets, found_matches, errors')
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
            ...(options.totalTargets !== undefined && { total_targets: options.totalTargets }),
            ...(options.last_error !== undefined && { last_error: options.last_error }),
            errors,
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
