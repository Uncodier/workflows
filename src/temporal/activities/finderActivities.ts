import { apiService } from '../services/apiService';
import { getSupabaseService } from '../services';
import { normalizeIcpMiningListIds } from '../utils/icpMiningConfiguration';
import { ICP_MINING_WORKFLOW_SELECT, IcpMiningWorkflowDto, toIcpMiningWorkflowDto } from '../utils/icpMiningPayload';
import { isIcpOrganizationIdentityError, type IcpOrganizationReview } from '../utils/icpIdentityReview';
import {
  FinderData, contactValues, domainOf, finderCompanyRecord, finderLeadProfile, finderPersonRecord,
  finderResponseError, hasData, mergeFinderData, normalizeFinderPerson, personPersistencePayload, selectFinderRole,
} from '../utils/finderData';

// Finder API: person role search
export async function callPersonRoleSearchActivity(options: {
  role_query_id?: string; // Keep for backward compatibility
  query?: any; // The actual query data from role_queries table
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
  const { role_query_id, query, page, page_size = 10, site_id } = options;

  try {
    // Use query data if provided, otherwise fall back to role_query_id
    const requestBody = query ? {
      ...query, // Spread the query parameters directly into the body
      page,
      page_size,
      site_id,
    } : {
      role_query_id,
      page,
      page_size,
      site_id,
    };

    // Log the request body for debugging
    console.log('🔍 Person Role Search API Request:', JSON.stringify(requestBody, null, 2));

    const response = await apiService.post('/api/finder/person_role_search', requestBody);

    if (!response.success) {
      return { success: false, error: response.error?.message || 'Finder person_role_search failed' };
    }

    const providerError = finderResponseError(response.data);
    if (providerError) return { success: false, error: providerError };
    const payload = response.data?.data || response.data;
    const persons = payload?.persons || payload?.search_results || payload?.results || [];
    const meta = payload?.meta || {};

    // Normalize pagination metadata (do not coerce total when absent)
    const total = (typeof meta.total === 'number'
      ? meta.total
      : (typeof payload?.total === 'number' ? payload.total : undefined)) as number | undefined;
    const currentPage = (typeof meta.page === 'number' ? meta.page : page) as number; // Finder may be 0- or 1-based
    const normalizedPageSize = (typeof meta.page_size === 'number'
      ? meta.page_size
      : (typeof meta.pageSize === 'number' ? meta.pageSize : page_size)) as number;

    // Prefer explicit hasMore; otherwise derive by page fullness when total is unknown
    const explicitHasMore = (typeof (meta as any).has_more === 'boolean'
      ? (meta as any).has_more
      : (typeof (meta as any).hasMore === 'boolean' ? (meta as any).hasMore : undefined)) as boolean | undefined;
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

// Finder API: person contacts lookup (work emails)
export async function callPersonWorkEmailsActivity(options: {
  external_person_id?: string | number;
  full_name?: string;
  company_name?: string;
  person_id?: string;
  linkedin_profile?: string;
  site_id?: string;
}): Promise<{
  success: boolean;
  data?: any;
  emails?: Array<{
    email: string;
    email_type?: string;
    validation_status?: string;
  }>;
  error?: string;
}> {
  try {
    const requestBody: any = {};
    if (options.site_id) requestBody.site_id = options.site_id;
    if (options.person_id) {
      requestBody.person_id = options.person_id;
    } else if (options.linkedin_profile) {
      requestBody.linkedin_profile = options.linkedin_profile;
    } else if (options.external_person_id) {
      requestBody.external_person_id = options.external_person_id;
    }
    if (options.full_name) requestBody.full_name = options.full_name;
    if (options.company_name) requestBody.company_name = options.company_name;

    const response = await apiService.post('/api/finder/person_contacts_lookup/work_emails', requestBody);
    if (!response.success) {
      return { success: false, error: response.error?.message || 'Finder person_contacts_lookup failed' };
    }

    const payload = response.data?.data || response.data;
    const providerError = finderResponseError(response.data);
    if (providerError) return { success: false, error: providerError };
    // Return structured array format
    const emails = Array.isArray(payload) ? payload : (payload?.emails || payload?.work_emails || []);
    return { success: true, data: payload, emails };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

// Legacy alias for backward compatibility (deprecated - use callPersonWorkEmailsActivity)
export const callPersonContactsLookupActivity = callPersonWorkEmailsActivity;

// Finder API: person contacts lookup (phone numbers)
export async function callPersonContactsLookupPhoneNumbersActivity(options: {
  person_id?: string;
  linkedin_profile?: string;
  external_person_id?: string | number;
  full_name?: string;
  company_name?: string;
  site_id?: string;
}): Promise<{
  success: boolean;
  data?: any;
  phoneNumbers?: Array<{
    phone_number: string;
  }>;
  error?: string;
}> {
  try {
    const requestBody: any = {};
    if (options.site_id) requestBody.site_id = options.site_id;
    if (options.person_id) {
      requestBody.person_id = options.person_id;
    } else if (options.linkedin_profile) {
      requestBody.linkedin_profile = options.linkedin_profile;
    } else if (options.external_person_id) {
      requestBody.external_person_id = options.external_person_id;
    }
    if (options.full_name) requestBody.full_name = options.full_name;
    if (options.company_name) requestBody.company_name = options.company_name;

    const response = await apiService.post('/api/finder/person_contacts_lookup/phone_numbers', requestBody);
    if (!response.success) {
      return { success: false, error: response.error?.message || 'Finder person_contacts_lookup phone_numbers failed' };
    }

    const payload = response.data?.data || response.data;
    // Return structured array format
    const phoneNumbers = Array.isArray(payload) ? payload : (payload?.phone_numbers || payload?.phones || []);
    const providerError = finderResponseError(response.data);
    if (providerError) return { success: false, error: providerError };
    return { success: true, data: payload, phoneNumbers };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

// Finder API: person contacts lookup (personal emails)
export async function callPersonContactsLookupPersonalEmailsActivity(options: {
  person_id?: string;
  linkedin_profile?: string;
  external_person_id?: string | number;
  full_name?: string;
  company_name?: string;
  site_id?: string;
}): Promise<{
  success: boolean;
  data?: any;
  emails?: Array<{
    email: string;
    email_type?: string;
    validation_status?: string;
  }>;
  error?: string;
}> {
  try {
    const requestBody: any = {};
    if (options.site_id) requestBody.site_id = options.site_id;
    if (options.person_id) {
      requestBody.person_id = options.person_id;
    } else if (options.linkedin_profile) {
      requestBody.linkedin_profile = options.linkedin_profile;
    } else if (options.external_person_id) {
      requestBody.external_person_id = options.external_person_id;
    }
    if (options.full_name) requestBody.full_name = options.full_name;
    if (options.company_name) requestBody.company_name = options.company_name;

    const response = await apiService.post('/api/finder/person_contacts_lookup/personal_emails', requestBody);
    if (!response.success) {
      return { success: false, error: response.error?.message || 'Finder person_contacts_lookup personal_emails failed' };
    }

    const payload = response.data?.data || response.data;
    // Return structured array format
    const emails = Array.isArray(payload) ? payload : (payload?.emails || payload?.personal_emails || []);
    const providerError = finderResponseError(response.data);
    if (providerError) return { success: false, error: providerError };
    return { success: true, data: payload, emails };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

// Finder API: person contacts lookup (details) - creates person, companies, and lead
export async function callPersonContactsLookupDetailsActivity(options: {
  person_id: string | number; // Required: external person_id from Finder API
  site_id?: string; // Optional: site_id for lead creation
  userId?: string; // Optional: user_id for lead creation
  company_name?: string; // Optional: target company to match role (e.g. from lead context)
}): Promise<{
  success: boolean;
  person?: any;
  companies?: any[];
  lead?: any;
  error?: string;
}> {
  try {
    const supabaseService = getSupabaseService();
    const isConnected = await supabaseService.getConnectionStatus();
    if (!isConnected) {
      return { success: false, error: 'Database not available' };
    }

    // Call API endpoint
    const requestBody: any = { person_id: options.person_id };
    if (options.site_id) requestBody.site_id = options.site_id;
    console.log(`📞 Calling person_contacts_lookup/details with person_id: ${options.person_id}`);

    const response = await apiService.post('/api/finder/person_contacts_lookup/details', requestBody);
    if (!response.success) {
      return { success: false, error: response.error?.message || 'Finder person_contacts_lookup/details failed' };
    }

    const providerError = finderResponseError(response.data);
    if (providerError) return { success: false, error: providerError };
    const personData = response.data?.data || response.data;
    if (!personData) {
      return { success: false, error: 'No data returned from API' };
    }

    console.log(`✅ Received person details data for person_id: ${personData.id}`);

    // Extract current role: match by company_name from context, or most recent start_date among is_current
    const currentRole = selectFinderRole(personData, {
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
      is_current: currentRole?.is_current,
      location: personLocation,
      linkedin_profile: linkedinUrl,
      emails: contactValues(personData.emails, personData.work_emails, currentRole?.emails),
      personal_emails: contactValues(personData.personal_emails),
      phones: contactValues(personData.phones, personData.phone_numbers, currentRole?.phones),
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
    const companies: any[] = [];
    const organizationsMap = new Map<string, any>();

    // Collect unique organizations from roles
    if (personData.roles && Array.isArray(personData.roles)) {
      for (const role of personData.roles) {
        if (role.organization && !organizationsMap.has(role.organization.id?.toString() || role.organization.name)) {
          organizationsMap.set(
            role.organization.id?.toString() || role.organization.name,
            role.organization
          );
        }
      }
    }

    // Also check educations for organization data
    if (personData.educations && Array.isArray(personData.educations)) {
      for (const education of personData.educations) {
        if (education.organization && !organizationsMap.has(education.organization.id?.toString() || education.organization.name)) {
          organizationsMap.set(
            education.organization.id?.toString() || education.organization.name,
            education.organization
          );
        }
      }
    }

    // Create/update companies
    console.log(`🏢 Creating/updating ${organizationsMap.size} companies`);
    let currentCompanyId: string | undefined = undefined;
    
    for (const org of organizationsMap.values()) {
      try {
        if (org.name) {
          const companyResult = await upsertFinderCompanyActivity({ organization: org });
          if (!companyResult.success) return { success: false, error: companyResult.error };
          const company = companyResult.company;
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
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`❌ Failed to create/update company ${org.name}: ${errorMsg}`);
        return { success: false, error: `Failed to save company ${org.name}: ${errorMsg}` };
      }
    }

    // Create/update lead if site_id is provided
    let lead: any = null;
    if (options.site_id && createdPerson && contactValues(createdPerson.emails, createdPerson.personal_emails, createdPerson.phones).length) {
      console.log(`📋 Creating/updating lead for site: ${options.site_id}`);
      
      // Extract primary email and phone if available (from person data or roles)
      // Note: The details endpoint might not include contact info, so we'll create lead without it
      // Contact enrichment can happen later via other endpoints
      
      const leadResult = await upsertLeadForPersonActivity({
        person_id: createdPerson.id,
        site_id: options.site_id,
        name: personRecord.full_name || undefined,
        email: contactValues(createdPerson.emails)[0],
        phone: contactValues(createdPerson.phones)[0],
        personal_email: contactValues(createdPerson.personal_emails)[0],
        userId: options.userId,
        company_id: currentCompanyId, // Associate lead with current company
        linkedin_url: linkedinUrl || undefined,
        profile: finderLeadProfile(createdPerson, currentRole),
      });

      if (leadResult.success) {
        lead = leadResult.lead;
        console.log(`✅ Lead created/updated: ${leadResult.leadId}`);
      } else {
        console.error(`❌ Failed to create/update lead: ${leadResult.error}`);
        return { success: false, error: `Failed to save lead: ${leadResult.error}` };
      }
    }

    return {
      success: true,
      person: createdPerson,
      companies,
      lead,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`❌ Error in callPersonContactsLookupDetailsActivity: ${message}`);
    return { success: false, error: message };
  }
}

// Get role query data by ID
export async function getRoleQueryByIdActivity(id: string): Promise<{
  success: boolean;
  roleQuery?: any;
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
      .from('role_queries')
      .select('*')
      .eq('id', id)
      .single();
    if (error) {
      return { success: false, error: error.message };
    }
    return { success: true, roleQuery: data };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

// Read ICP Mining by ID
export async function getIcpMiningByIdActivity(id: string): Promise<{
  success: boolean;
  icp?: IcpMiningWorkflowDto | null;
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
      .select(ICP_MINING_WORKFLOW_SELECT)
      .eq('id', id)
      .single();
    if (error) {
      return { success: false, error: error.message };
    }
    return { success: true, icp: data ? toIcpMiningWorkflowDto(data) : null };
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
  processedTargets?: number; // Absolute retry-safe checkpoint for configured mining
  foundMatches?: number;
  status?: 'pending' | 'running' | 'completed' | 'failed';
  totalTargets?: number;
  last_error?: string | null;
  appendError?: string; // push into errors[]
  currentPage?: number;
  currentPageOffset?: number;
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
      .select('processed_targets, found_matches, errors, total_targets')
      .eq('id', options.id)
      .single();
    if (fetchError) {
      return { success: false, error: fetchError.message };
    }

    const newProcessed = options.processedTargets ?? ((current?.processed_targets || 0) + (options.deltaProcessed || 0));
    const newFound = options.foundMatches ?? ((current?.found_matches || 0) + (options.deltaFound || 0));
    const errors = Array.isArray(current?.errors) ? current.errors.slice() : [];
    if (options.appendError) {
      errors.push({ timestamp: new Date().toISOString(), message: options.appendError });
    }

    const updates: any = {
      processed_targets: newProcessed,
      found_matches: newFound,
      last_progress_at: new Date().toISOString(),
      ...(options.status && { status: options.status }),
      // Only update total_targets if explicitly provided, otherwise preserve existing value
      ...(options.totalTargets !== undefined && { total_targets: options.totalTargets }),
      ...(options.last_error !== undefined && { last_error: options.last_error }),
      errors,
      ...(options.currentPage !== undefined && { current_page: options.currentPage }),
      ...(options.currentPageOffset !== undefined && { current_page_offset: options.currentPageOffset }),
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

// List pending ICP Mining rows (optionally limited and filtered by site_id)
export async function getPendingIcpMiningActivity(options?: { limit?: number; site_id?: string; icp_mining_ids?: string[] }): Promise<{
  success: boolean;
  items?: IcpMiningWorkflowDto[];
  error?: string;
}> {
  try {
    const selectedIds = options?.icp_mining_ids === undefined ? undefined : normalizeIcpMiningListIds(options.icp_mining_ids);
    if (selectedIds !== undefined && !options?.site_id) return { success: false, error: 'site_id is required for selected ICP lists' };
    if (selectedIds?.length === 0) return { success: true, items: [] };
    const supabaseService = getSupabaseService();
    const isConnected = await supabaseService.getConnectionStatus();
    if (!isConnected) return { success: false, error: 'Database not available' };
    const { supabaseServiceRole } = await import('../../lib/supabase/client');

    const limit = options?.limit && options.limit > 0 ? options.limit : 50;
    if (selectedIds) {
      const items: IcpMiningWorkflowDto[] = [];
      // Filter before LIMIT, with bounded URLs even for a large selection.
      for (let offset = 0; offset < selectedIds.length; offset += 100) {
        const { data, error } = await supabaseServiceRole.from('icp_mining').select(ICP_MINING_WORKFLOW_SELECT)
          .eq('site_id', options!.site_id!).in('status', ['running', 'pending'])
          .in('id', selectedIds.slice(offset, offset + 100))
          .order('created_at', { ascending: true }).order('id', { ascending: true }).limit(limit);
        if (error) return { success: false, error: error.message };
        items.push(...(data || []).map(toIcpMiningWorkflowDto));
      }
      items.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id)));
      return { success: true, items: items.slice(0, limit) };
    }
    let query = supabaseServiceRole
      .from('icp_mining')
      .select(ICP_MINING_WORKFLOW_SELECT)
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
        site_id: data[0].site_id,
        role_query_id: data[0].role_query_id,
      });
    }
    
    return { success: true, items: (data || []).map(toIcpMiningWorkflowDto) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

// Check if person already exists
export async function checkExistingPersonActivity(options: {
  external_person_id?: string | number;
  external_role_id?: string | number;
  full_name?: string;
  company_name?: string;
  site_id?: string;
}): Promise<{
  success: boolean;
  hasExistingPerson: boolean;
  existingPerson?: any;
  error?: string;
}> {
  try {
    const supabaseService = getSupabaseService();
    const isConnected = await supabaseService.getConnectionStatus();
    if (!isConnected) return { success: false, hasExistingPerson: false, error: 'Database not available' };
    const { supabaseServiceRole } = await import('../../lib/supabase/client');

    let query = supabaseServiceRole
      .from('persons')
      .select('id, full_name, company_name, external_person_id, external_role_id, emails, phones, created_at, updated_at');

    // Try to find by external IDs first (most reliable)
    if (options.external_person_id && options.external_role_id) {
      query = query
        .eq('external_person_id', options.external_person_id)
        .eq('external_role_id', options.external_role_id);
    } else if (options.external_person_id) {
      query = query.eq('external_person_id', options.external_person_id);
    } else if (options.full_name && options.company_name) {
      // Fallback to name and company match
      query = query
        .eq('full_name', options.full_name)
        .eq('company_name', options.company_name);
    } else {
      return { success: true, hasExistingPerson: false };
    }

    const { data: existingPerson, error } = await query
      .limit(1)
      .maybeSingle();

    if (error) return { success: false, hasExistingPerson: false, error: error.message };
    
    const hasExistingPerson = !!existingPerson;
    return { 
      success: true, 
      hasExistingPerson, 
      existingPerson: hasExistingPerson ? existingPerson : undefined 
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, hasExistingPerson: false, error: message };
  }
}

// Check person by LinkedIn profile URL or person_id
export async function checkPersonByLinkedInActivity(options: {
  linkedin_profile?: string;
  person_id?: string;
  site_id?: string;
}): Promise<{
  success: boolean;
  hasExistingPerson: boolean;
  existingPerson?: any;
  error?: string;
}> {
  try {
    const supabaseService = getSupabaseService();
    const isConnected = await supabaseService.getConnectionStatus();
    if (!isConnected) return { success: false, hasExistingPerson: false, error: 'Database not available' };
    const { supabaseServiceRole } = await import('../../lib/supabase/client');

    // If person_id is provided, check if it's a UUID or external_person_id
    if (options.person_id) {
      // Check if person_id is a valid UUID format
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const isUUID = uuidRegex.test(options.person_id);
      
      let person: any = null;
      let error: any = null;
      
      if (isUUID) {
        // Search by UUID (id field)
        const result = await supabaseServiceRole
          .from('persons')
          .select('*')
          .eq('id', options.person_id)
          .maybeSingle();
        person = result.data;
        error = result.error;
      } else {
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

      if (error) return { success: false, hasExistingPerson: false, error: error.message };
      
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
      const matchingPerson = allPersons?.find((p: any) => {
        const rawResult = p.raw_result;
        if (!rawResult || !options.linkedin_profile) return false;
        
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, hasExistingPerson: false, error: message };
  }
}

// Check if lead already exists for a person
export async function checkExistingLeadForPersonActivity(options: {
  person_id: string;
  site_id: string;
}): Promise<{
  success: boolean;
  hasExistingLead: boolean;
  existingLead?: any;
  error?: string;
}> {
  try {
    const supabaseService = getSupabaseService();
    const isConnected = await supabaseService.getConnectionStatus();
    if (!isConnected) return { success: false, hasExistingLead: false, error: 'Database not available' };
    const { supabaseServiceRole } = await import('../../lib/supabase/client');

    // Check if there's already a lead for this person
    const { data: existingLead, error } = await supabaseServiceRole
      .from('leads')
      .select('id, name, email, phone, personal_email, status, created_at, company_id, metadata')
      .eq('site_id', options.site_id)
      .eq('person_id', options.person_id)
      .limit(1)
      .maybeSingle();

    if (error) return { success: false, hasExistingLead: false, error: error.message };
    
    const hasExistingLead = !!existingLead;
    return { 
      success: true, 
      hasExistingLead, 
      existingLead: hasExistingLead ? existingLead : undefined 
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, hasExistingLead: false, error: message };
  }
}

// Upsert person into persons table
export async function upsertPersonActivity(person: {
  id?: string;
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
  linkedin_profile?: string | null;
  emails?: any | null;
  personal_emails?: any | null;
  phones?: any | null;
  raw_result: any;
}): Promise<{ success: boolean; person?: any; error?: string }> {
  try {
    const supabaseService = getSupabaseService();
    const isConnected = await supabaseService.getConnectionStatus();
    if (!isConnected) return { success: false, error: 'Database not available' };
    const { supabaseServiceRole } = await import('../../lib/supabase/client');

    // Reuse the known local row first. Nullable role IDs must not create duplicates.
    let existing: any = null;
    if (person.id || person.external_person_id != null) {
      let query = supabaseServiceRole.from('persons').select('*');
      if (person.id) query = query.eq('id', person.id);
      else {
        query = query.eq('external_person_id', person.external_person_id!);
        if (person.external_role_id != null) query = query.eq('external_role_id', person.external_role_id);
        else query = query.order('created_at', { ascending: false }).limit(1);
      }
      const { data: found, error } = await query.maybeSingle();
      if (error) return { success: false, error: error.message };
      if (person.id && !found) return { success: false, error: 'Person to update was not found' };
      existing = found || null;
    }

    const payload = {
      ...personPersistencePayload(existing, person),
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

    if (!resultRow?.id) return { success: false, error: 'Person save returned no row' };
    return { success: true, person: resultRow };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

// Update person emails field
export async function updatePersonEmailsActivity(options: { person_id: string; emails: string[] }): Promise<{ success: boolean; error?: string }> {
  const result = await upsertPersonActivity({ id: options.person_id, emails: options.emails, raw_result: {} });
  return { success: result.success, ...(result.error ? { error: result.error } : {}) };
}

/**
 * Get segment_id from role_query_segments relationship
 */
export async function getSegmentIdFromRoleQueryActivity(roleQueryId: string): Promise<{
  success: boolean;
  segmentId?: string;
  error?: string;
}> {
  try {
    const supabaseService = getSupabaseService();
    const isConnected = await supabaseService.getConnectionStatus();
    if (!isConnected) return { success: false, error: 'Database not available' };
    
    const { supabaseServiceRole } = await import('../../lib/supabase/client');

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
    
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

// Upsert lead for person with enriched contact data
export async function upsertLeadForPersonActivity(options: {
  person_id: string;
  site_id: string;
  email?: string;
  phone?: string;
  personal_email?: string;
  name?: string;
  notes?: string;
  userId?: string;
  company_id?: string;
  segment_id?: string;
  person_emails?: string[]; // Optional: pass person emails to avoid DB query
  linkedin_url?: string; // LinkedIn profile URL from Person API
  profile?: FinderData; // Schema-mapped provider data, merged with existing metadata/research
  validated_contact_policy?: boolean;
}): Promise<{
  success: boolean;
  lead?: any;
  leadId?: string;
  error?: string;
}> {
  try {
    const supabaseService = getSupabaseService();
    const isConnected = await supabaseService.getConnectionStatus();
    if (!isConnected) return { success: false, error: 'Database not available' };
    const { supabaseServiceRole } = await import('../../lib/supabase/client');

    // Check if lead already exists
    const { data: existingLead, error: checkError } = await supabaseServiceRole
      .from('leads')
      .select('*')
      .eq('person_id', options.person_id)
      .eq('site_id', options.site_id)
      .maybeSingle();

    if (checkError) {
      return { success: false, error: checkError.message };
    }

    // Get person data for name if not provided
    let leadName = options.name;
    if (!leadName) {
      const { data: person, error } = await supabaseServiceRole
        .from('persons')
        .select('full_name')
        .eq('id', options.person_id)
        .single();
      if (error) return { success: false, error: error.message };
      leadName = person?.full_name || existingLead?.name || 'Unknown';
    }

    // Validate that person has at least one contact method: work email, personal email, or phone
    // Check person's emails (work emails) - use provided person_emails if available, otherwise query DB
    let personEmails: string[] = [];
    if (options.person_emails) {
      personEmails = Array.isArray(options.person_emails) ? options.person_emails : [];
    } else {
      const { data: personData, error } = await supabaseServiceRole
        .from('persons')
        .select('emails')
        .eq('id', options.person_id)
        .single();
      if (error) return { success: false, error: error.message };
      personEmails = contactValues(personData?.emails);
    }
    
    const hasPersonWorkEmail = contactValues(personEmails, options.email).length > 0;
    
    // Check if we have at least one contact method: work email, personal email, or phone
    const hasPersonalEmail = options.personal_email && options.personal_email.trim() !== '';
    const hasPhone = options.phone && options.phone.trim() !== '';
    
    // Also check existing lead for personal email or phone if not provided in options
    let hasExistingContact = false;
    if (existingLead) {
      const existingPersonalEmail = existingLead.personal_email && existingLead.personal_email.trim() !== '';
      const existingPhone = existingLead.phone && existingLead.phone.trim() !== '';
      hasExistingContact = !!(hasData(existingLead.email) || existingPersonalEmail || existingPhone);
    }
    
    const hasAtLeastOneContact = hasPersonWorkEmail || hasPersonalEmail || hasPhone || (!options.validated_contact_policy && hasExistingContact);
    
    if (!hasAtLeastOneContact) {
      return { success: false, error: 'Person must have at least 1 contact method (work email, personal email, or phone) to create/update lead' };
    }

    const leadData: any = {
      person_id: options.person_id,
      site_id: options.site_id,
      name: leadName,
      // If company_id is provided, it means lead will be enriched, so allow null/empty email
      // Otherwise, require email or phone for lead creation
      // Provider refreshes may add alternatives but must never replace validated primaries.
      email: options.validated_contact_policy ? options.email || '' : existingLead?.email || options.email || contactValues(personEmails)[0] || '',
      phone: options.validated_contact_policy ? options.phone || null : existingLead?.phone || options.phone || null,
      personal_email: options.validated_contact_policy ? options.personal_email || null : existingLead?.personal_email || options.personal_email || null,
      updated_at: new Date().toISOString(),
    };

    for (const key of ['position', 'address', 'company', 'metadata', 'social_networks']) {
      if (hasData(options.profile?.[key])) {
        leadData[key] = mergeFinderData(existingLead?.[key], options.profile![key]);
      }
    }
    if (options.profile?.metadata?.finder) {
      // Keep both prior validated primaries and any new alternatives in structured metadata.
      leadData.metadata = mergeFinderData(leadData.metadata || existingLead?.metadata, { finder: { contacts: {
        emails: contactValues(existingLead?.email, options.email, personEmails),
        personal_emails: contactValues(existingLead?.personal_email, options.personal_email),
        phones: contactValues(existingLead?.phone, options.phone),
      } } });
    }
    if (options.validated_contact_policy) {
      leadData.metadata = { ...existingLead?.metadata, ...leadData.metadata, emailVerified: !!options.email };
    }

    // Add social_networks.linkedin if provided (merge with existing to preserve other platforms)
    if (options.linkedin_url) {
      const existingSocial = existingLead?.social_networks && typeof existingLead.social_networks === 'object'
        ? existingLead.social_networks
        : {};
      leadData.social_networks = { ...existingSocial, ...leadData.social_networks, linkedin: options.linkedin_url };
    }

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
      if (existingLead?.notes && !existingLead.notes.includes(options.notes)) {
        leadData.notes = `${existingLead.notes}\n${options.notes}`;
      } else {
        leadData.notes = existingLead?.notes || options.notes;
      }
    }

    if (options.userId) {
      leadData.user_id = options.userId;
    }

    let resultLead: any;

    if (existingLead) {
      // Update existing lead
      const { data, error } = await supabaseServiceRole
        .from('leads')
        .update(leadData)
        .eq('id', existingLead.id)
        .select()
        .single();

      if (error) return { success: false, error: error.message };
      resultLead = data;
    } else {
      // Create new lead
      if (!options.userId) {
        // Try to get user_id from site
        const { data: site, error } = await supabaseServiceRole
          .from('sites')
          .select('user_id')
          .eq('id', options.site_id)
          .single();
        
        if (error) return { success: false, error: error.message };
        if (site?.user_id) {
          leadData.user_id = site.user_id;
        } else {
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

      if (error) return { success: false, error: error.message };
      resultLead = data;
    }

    if (!resultLead?.id) return { success: false, error: 'Lead save returned no row' };
    return { success: true, lead: resultLead, leadId: resultLead.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

// A social network's hostname belongs to the platform, not to the company.
// Only a specific page can identify an organization on a shared host.
const sharedCompanyWebsiteHosts = new Set([
  'facebook.com', 'instagram.com', 'linkedin.com', 'tiktok.com', 'twitter.com', 'x.com', 'youtube.com',
]);

function companyWebsiteIdentity(value: any): string {
  const host = domainOf(value);
  if (!host) return '';
  if (!sharedCompanyWebsiteHosts.has(host)) return `domain:${host}`;
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    const path = url.pathname.replace(/\/+$/, '').toLowerCase();
    if (host === 'facebook.com' && path === '/profile.php') {
      const id = url.searchParams.get('id')?.trim().toLowerCase();
      return id ? `page:${host}${path}?id=${id}` : '';
    }
    return path ? `page:${host}${path}` : '';
  } catch { return ''; }
}

/** Finder-specific company persistence. Do not add provider IDs/unknown fields to companies.
 * Name alone is not sufficient when provider identities conflict.
 */
export async function upsertFinderCompanyActivity(options: { organization: FinderData; company_id?: string }): Promise<{
  success: boolean; company?: any; error?: string;
}> {
  try {
    if (!await getSupabaseService().getConnectionStatus()) return { success: false, error: 'Database not available' };
    const { supabaseServiceRole: db } = await import('../../lib/supabase/client');
    const payload = finderCompanyRecord(options.organization);
    if (!payload.name) return { success: false, error: 'Organization name is required' };
    const websiteIdentity = companyWebsiteIdentity(payload.website);
    const websiteHost = domainOf(payload.website);
    const sharedWebsite = sharedCompanyWebsiteHosts.has(websiteHost);
    const linkedin = (value: any) => typeof value === 'string' ? value.toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') : '';
    const profile = linkedin(payload.linkedin_url);
    if (sharedWebsite && !websiteIdentity && !profile && !options.company_id) {
      throw new Error(`Cannot resolve organization identity: ${payload.name}`);
    }
    let existing: any;
    // Only trusted callers may pass a local ID (e.g. an existing lead.company_id).
    // A stale ID is a failure, never a reason to create an unrelated company.
    if (options.company_id) {
      const { data, error } = await db.from('companies').select('*').eq('id', options.company_id).maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new Error('Company to update was not found');
      existing = data;
    }
    const choose = (rows: any[]) => {
      const matches = rows.filter(row => {
        const rowWebsiteIdentity = companyWebsiteIdentity(row.website);
        const rowProfile = linkedin(row.linkedin_url);
        // Shared-platform pages need positive page or LinkedIn identity evidence;
        // name alone (or a different Facebook page) cannot establish ownership.
        if (sharedWebsite && !(websiteIdentity && rowWebsiteIdentity === websiteIdentity)
          && !(profile && rowProfile === profile)) return false;
        return !(websiteIdentity && rowWebsiteIdentity && websiteIdentity !== rowWebsiteIdentity)
          && !(profile && rowProfile && profile !== rowProfile);
      });
      if (matches.length > 1) throw new Error(`Ambiguous organization identity: ${payload.name}`);
      return matches[0];
    };
    if (!existing && websiteIdentity) {
      // Search by host or full social page, then compare normalized identities;
      // a Facebook hostname (or a prefix of another page) is not a company match.
      // A substring of facebook.com/page also matches www.facebook.com/page.
      const needle = websiteIdentity.slice(websiteIdentity.indexOf(':') + 1).replace(/[\\%_]/g, '\\$&');
      const { data, error } = await db.from('companies').select('*').ilike('website', `%${needle}%`).limit(50);
      if (error) throw new Error(error.message);
      existing = choose((data || []).filter(row => companyWebsiteIdentity(row.website) === websiteIdentity));
    }
    if (!existing && profile) {
      const { data, error } = await db.from('companies').select('*').ilike('linkedin_url', `%${profile.replace(/[%_]/g, '')}%`).limit(50);
      if (error) throw new Error(error.message);
      existing = choose((data || []).filter(row => linkedin(row.linkedin_url) === profile));
    }
    if (!existing) {
      // Escape LIKE wildcards so provider names are literals.
      const namePattern = String(payload.name).replace(/[\\%_]/g, '\\$&');
      const { data, error } = await db.from('companies').select('*').ilike('name', namePattern).limit(50);
      if (error) throw new Error(error.message);
      existing = choose(data || []);
      if (!existing && (data || []).length && !websiteIdentity && !profile) throw new Error(`Cannot resolve organization identity: ${payload.name}`);
    }
    for (const key of Object.keys(payload)) {
      if (existing?.[key] && typeof payload[key] === 'object') payload[key] = mergeFinderData(existing[key], payload[key]);
    }
    payload.updated_at = new Date().toISOString();
    const write = existing
      ? db.from('companies').update(payload).eq('id', existing.id)
      : db.from('companies').insert(payload);
    const { data, error } = await write.select().single();
    if (error) throw new Error(error.message);
    if (!data?.id) throw new Error('Company save returned no row');
    return { success: true, company: data };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Source-aware preparation is one activity so optional lookup errors cannot bypass persistence.
 * Full snapshots survive sparse details refreshes and contacts are never blanked here.
 */
export async function prepareFinderPersonActivity(options: {
  person_id?: string; linkedin_profile?: string; site_id: string; company_name?: string; source_search_result: FinderData;
  isolate_identity_reviews?: boolean;
}): Promise<{ success: boolean; person?: any; role?: any; companyId?: string; errors: string[]; error?: string;
  identityReviews?: IcpOrganizationReview[]; requiresIdentityReview?: boolean }> {
  const errors: string[] = [];
  try {
    if (!await getSupabaseService().getConnectionStatus()) throw new Error('Database not available');
    const { supabaseServiceRole: db } = await import('../../lib/supabase/client');
    const source = options.source_search_result;
    const sourcePerson = source.person || source;
    const sourceId = sourcePerson.id ?? sourcePerson.external_person_id ?? sourcePerson.person_id;
    const externalId = sourceId ?? options.person_id;
    const localIdProvided = options.person_id && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(options.person_id);
    let query = db.from('persons').select('*');
    if (localIdProvided) query = query.eq('id', options.person_id!);
    else if (externalId != null) {
      query = query.eq('external_person_id', externalId);
      if (source.person && source.id != null) query = query.eq('external_role_id', source.id);
      query = query.order('created_at', { ascending: false }).limit(1);
    } else if (options.linkedin_profile) query = query.eq('linkedin_profile', options.linkedin_profile).limit(1);
    else throw new Error('Finder person identity is required');
    const { data: existing, error: readError } = await query.maybeSingle();
    if (readError) throw new Error(readError.message);
    if (localIdProvided && !existing) throw new Error('Person to enrich was not found');
    if (sourceId != null && existing?.external_person_id != null && String(sourceId) !== String(existing.external_person_id)) {
      throw new Error('Source person identity does not match existing person');
    }

    let details: any;
    const today = new Date().toISOString().slice(0, 10);
    if (!existing || String(existing.updated_at || existing.created_at || '').slice(0, 10) < today) {
      try {
        const personId = existing?.external_person_id ?? externalId;
        const request: FinderData = { site_id: options.site_id };
        if (personId != null && /^\d+$/.test(String(personId))) request.person_id = personId;
        else {
          const url = options.linkedin_profile || sourcePerson.linkedin_info?.public_profile_url;
          const identifier = typeof url === 'string' ? url.match(/linkedin\.com\/in\/([^/?#]+)/i)?.[1] : undefined;
          if (!identifier) throw new Error('No external person ID or LinkedIn identifier for details lookup');
          request.linkedin_public_identifier = identifier;
        }
        const response = await apiService.post('/api/finder/person_contacts_lookup/details', request);
        const responseError = response.error?.message || finderResponseError(response.data);
        if (!response.success || responseError) throw new Error(responseError || 'Details lookup failed');
        details = response.data?.data || response.data;
        if (!details || typeof details !== 'object' || Array.isArray(details)) throw new Error('Details lookup returned invalid person data');
        const detailPersonId = details.person?.id ?? details.id;
        if (detailPersonId != null && sourceId != null && String(detailPersonId) !== String(sourceId)) {
          details = undefined;
          throw new Error('Details lookup returned a different person identity');
        }
      } catch (error) { errors.push(`Details lookup: ${error instanceof Error ? error.message : String(error)}`); }
    }
    const raw = normalizeFinderPerson(source, details, existing?.raw_result);
    const role = selectFinderRole(raw, { source, company_name: options.company_name, external_role_id: existing?.external_role_id });
    const personRecord = finderPersonRecord(raw, role);
    if (!/^\d+$/.test(String(personRecord.external_person_id))) personRecord.external_person_id = existing?.external_person_id;
    if (!personRecord.external_person_id && /^\d+$/.test(String(externalId))) personRecord.external_person_id = externalId;
    // persons are per-role: do not mutate a different role's local row (and its lead links).
    const sameRole = existing?.external_role_id == null || personRecord.external_role_id == null
      || String(existing.external_role_id) === String(personRecord.external_role_id);
    const saved = await upsertPersonActivity({ ...personRecord, id: sameRole ? existing?.id : undefined, raw_result: raw });
    if (!saved.success || !saved.person?.id) throw new Error(saved.error || 'Person was not saved');

    const organizations: FinderData[] = [];
    for (const entry of [...(raw.roles || []), ...(raw.educations || [])]) {
      const org = entry.organization || (entry.organization_name ? { name: entry.organization_name } : undefined);
      if (org?.name && !organizations.some(o => org.id != null ? String(o.id) === String(org.id) : o.name === org.name)) organizations.push(org);
    }
    if (raw.organization?.name && !organizations.some(o => o.name === raw.organization.name)) organizations.push(raw.organization);
    let companyId: string | undefined;
    const identityReviews: IcpOrganizationReview[] = [];
    for (const org of organizations) {
      const selected = role?.organization;
      const isSelected = (selected?.id != null && String(selected.id) === String(org.id))
        || (selected?.id == null && (selected?.name || role?.organization_name) === org.name)
        || (!role && raw.organization === org);
      const result = await upsertFinderCompanyActivity({ organization: org });
      if (!result.success || !result.company?.id) {
        const message = result.error || `Company ${org.name} was not saved`;
        if (!options.isolate_identity_reviews || !isIcpOrganizationIdentityError(message)) throw new Error(message);
        // Keep the exact provider document; never choose an arbitrary company.
        // A site-scoped stable ID deduplicates retries on the per-role person row.
        identityReviews.push({ id: `${options.site_id}:${org.id ?? org.name}`, site_id: options.site_id,
          organization: org, selected: isSelected, status: 'pending', error: message });
        continue;
      }
      if (isSelected) companyId = result.company.id;
    }
    if (identityReviews.length > 0) {
      const reviewed = await upsertPersonActivity({ id: saved.person.id,
        raw_result: mergeFinderData(raw, { icp_organization_identity_reviews: identityReviews }) });
      if (!reviewed.success || !reviewed.person?.id) throw new Error(reviewed.error || 'Organization reviews were not saved');
      // Only acknowledge the deferred candidate after its review is durable.
      return { success: true, person: reviewed.person, role, companyId, errors, identityReviews,
        requiresIdentityReview: identityReviews.some(review => review.selected) };
    }
    return { success: true, person: saved.person, role, companyId, errors };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message, errors: [...errors, message] };
  }
}

