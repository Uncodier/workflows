import { apiService } from '../services/apiService';
import { getSupabaseService } from '../services';

// Finder API: person role search
export async function callPersonRoleSearchActivity(options: {
  role_query_id: string;
  page: number;
  page_size?: number; // default 10
  site_id?: string; // optional for logging
  userId?: string; // optional for logging
}): Promise<{
  success: boolean;
  data?: any;
  persons?: any[];
  total?: number;
  page?: number;
  pageSize?: number;
  hasMore?: boolean;
  error?: string;
}> {
  const { role_query_id, page, page_size = 10 } = options;

  try {
    const response = await apiService.post('/api/finder/person_role_search', {
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

// Finder API: person contacts lookup (work emails)
export async function callPersonContactsLookupActivity(options: {
  external_person_id?: string | number;
  full_name?: string;
  company_name?: string;
}): Promise<{
  success: boolean;
  data?: any;
  emails?: string[];
  error?: string;
}> {
  try {
    const response = await apiService.post('/api/finder/person_contacts_lookup/work_emails', options);
    if (!response.success) {
      return { success: false, error: response.error?.message || 'Finder person_contacts_lookup failed' };
    }

    const payload = response.data?.data || response.data;
    const emails: string[] = payload?.emails || payload?.work_emails || [];
    return { success: true, data: payload, emails };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

// Read ICP Mining by ID
export async function getIcpMiningByIdActivity(id: string): Promise<{
  success: boolean;
  icp?: any;
  error?: string;
}> {
  try {
    const supabaseService = getSupabaseService();
    const isConnected = await supabaseService.getConnectionStatus();
    if (!isConnected) {
      return { success: false, error: 'Database not available' };
    }
    const { supabaseServiceRole } = await import('../../lib/supabase/client');
    const { data, error } = await supabaseServiceRole
      .from('icp_mining')
      .select('*')
      .eq('id', id)
      .single();
    if (error) {
      return { success: false, error: error.message };
    }
    return { success: true, icp: data };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

// Update ICP Mining progress and status
export async function updateIcpMiningProgressActivity(options: {
  id: string;
  deltaProcessed?: number;
  deltaFound?: number;
  status?: 'pending' | 'running' | 'completed' | 'failed';
  totalTargets?: number;
  last_error?: string | null;
  appendError?: string; // push into errors[]
}): Promise<{ success: boolean; error?: string }> {
  try {
    const supabaseService = getSupabaseService();
    const isConnected = await supabaseService.getConnectionStatus();
    if (!isConnected) {
      return { success: false, error: 'Database not available' };
    }
    const { supabaseServiceRole } = await import('../../lib/supabase/client');

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

    const updates: any = {
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

// Mark ICP mining started
export async function markIcpMiningStartedActivity(options: { id: string }): Promise<{ success: boolean; error?: string }> {
  try {
    const supabaseService = getSupabaseService();
    const isConnected = await supabaseService.getConnectionStatus();
    if (!isConnected) return { success: false, error: 'Database not available' };
    const { supabaseServiceRole } = await import('../../lib/supabase/client');
    const { error } = await supabaseServiceRole
      .from('icp_mining')
      .update({ status: 'running', started_at: new Date().toISOString(), last_progress_at: new Date().toISOString() })
      .eq('id', options.id);
    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

// Mark ICP mining completed
export async function markIcpMiningCompletedActivity(options: { id: string; failed?: boolean; last_error?: string | null }): Promise<{ success: boolean; error?: string }> {
  try {
    const supabaseService = getSupabaseService();
    const isConnected = await supabaseService.getConnectionStatus();
    if (!isConnected) return { success: false, error: 'Database not available' };
    const { supabaseServiceRole } = await import('../../lib/supabase/client');
    const { error } = await supabaseServiceRole
      .from('icp_mining')
      .update({ status: options.failed ? 'failed' : 'completed', finished_at: new Date().toISOString(), last_error: options.last_error ?? null })
      .eq('id', options.id);
    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

// Upsert person into persons table
export async function upsertPersonActivity(person: {
  role_query_id?: string;
  external_person_id?: number | string | null;
  external_role_id?: number | string | null;
  external_organization_id?: number | string | null;
  full_name?: string | null;
  role_title?: string | null;
  company_name?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  is_current?: boolean | null;
  location?: string | null;
  emails?: any | null;
  phones?: any | null;
  raw_result: any;
}): Promise<{ success: boolean; person?: any; error?: string }> {
  try {
    const supabaseService = getSupabaseService();
    const isConnected = await supabaseService.getConnectionStatus();
    if (!isConnected) return { success: false, error: 'Database not available' };
    const { supabaseServiceRole } = await import('../../lib/supabase/client');

    // Try to find existing by unique external ids if available
    let existing: any = null;
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
    } as any;

    let resultRow: any;
    if (existing) {
      const { data, error } = await supabaseServiceRole
        .from('persons')
        .update(payload)
        .eq('id', existing.id)
        .select()
        .single();
      if (error) return { success: false, error: error.message };
      resultRow = data;
    } else {
      const { data, error } = await supabaseServiceRole
        .from('persons')
        .insert(payload)
        .select()
        .single();
      if (error) return { success: false, error: error.message };
      resultRow = data;
    }

    return { success: true, person: resultRow };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

// Update person emails field
export async function updatePersonEmailsActivity(options: { person_id: string; emails: string[] }): Promise<{ success: boolean; error?: string }> {
  try {
    const supabaseService = getSupabaseService();
    const isConnected = await supabaseService.getConnectionStatus();
    if (!isConnected) return { success: false, error: 'Database not available' };
    const { supabaseServiceRole } = await import('../../lib/supabase/client');
    const { error } = await supabaseServiceRole
      .from('persons')
      .update({ emails: options.emails, updated_at: new Date().toISOString() })
      .eq('id', options.person_id);
    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}


