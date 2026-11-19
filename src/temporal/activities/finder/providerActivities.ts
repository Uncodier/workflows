import { apiService } from '../../services/apiService';
import { finderResponseError } from '../../utils/finderData';

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
