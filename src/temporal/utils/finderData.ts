/** Finder is schemaless; only explicitly mapped columns belong in database writes.
 * Keep the full provider documents on persons.raw_result / leads.metadata.finder.
 * Empty refresh values are not instructions to delete previously acquired data.
 */
export type FinderData = Record<string, any>;

export function isRecord(value: any): value is FinderData {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function hasData(value: any): boolean {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (isRecord(value)) return Object.keys(value).length > 0;
  return true; // false and 0 are meaningful provider values
}

function identity(value: any): string {
  if (!isRecord(value)) return String(value).toLowerCase();
  const id = value.id ?? value.email ?? value.phone_number ?? value.number;
  return id != null ? String(id).toLowerCase() : JSON.stringify(value);
}

/** Non-destructive deep merge, including arrays of roles and annotated contacts. */
export function mergeFinderData(existing: any, incoming: any): any {
  if (!hasData(incoming)) return existing;
  if (Array.isArray(incoming)) {
    const merged = Array.isArray(existing) ? existing.slice() : [];
    for (const item of incoming) {
      const index = merged.findIndex(old => identity(old) === identity(item));
      if (index < 0) merged.push(item);
      else if (isRecord(item)) {
        const previous = merged[index];
        merged[index] = mergeFinderData(previous, item);
        // A sparse/unverified provider refresh cannot revoke a previously validated contact.
        if (isRecord(previous) && (previous.email || previous.phone_number || previous.number)) {
          for (const key of ['validation_status', 'verification_status', 'validated', 'verified']) {
            if (previous[key] === true || ['valid', 'validated', 'verified', 'deliverable'].includes(previous[key])) merged[index][key] = previous[key];
          }
        }
      }
    }
    return merged;
  }
  if (!isRecord(incoming)) return incoming;
  const result: FinderData = isRecord(existing) ? { ...existing } : {};
  for (const [key, value] of Object.entries(incoming)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) continue;
    if (hasData(value)) result[key] = mergeFinderData(result[key], value);
  }
  return result;
}

export function contactValues(...lists: any[]): string[] {
  const values: string[] = [];
  for (const list of lists) {
    for (const item of Array.isArray(list) ? list : hasData(list) ? [list] : []) {
      const value = typeof item === 'string' ? item : item?.email ?? item?.phone_number ?? item?.number;
      if (typeof value === 'string' && value.trim() && !values.some(v => v.toLowerCase() === value.trim().toLowerCase())) {
        values.push(value.trim());
      }
    }
  }
  return values;
}

/** Search returns role records {id, person, organization}; details returns a person with roles. */
export function normalizeFinderPerson(source?: FinderData, details?: FinderData, existing?: FinderData): FinderData {
  let result = mergeFinderData({}, existing) || {};
  if (source) {
    const person = isRecord(source.person) ? source.person : source;
    result = mergeFinderData(result, person);
    if (isRecord(source.person) && (source.organization || source.role_title || source.organization_name)) {
      const { person: _person, ...role } = source;
      result.roles = mergeFinderData(result.roles, [role]);
    }
    result.finder_search_result = mergeFinderData(result.finder_search_result, source);
  }
  if (details) {
    result = mergeFinderData(result, isRecord(details.person) ? details.person : details);
    result.finder_details = mergeFinderData(result.finder_details, details);
  }
  return result;
}

/** Exact role/org identity wins over recency; never substring-match unrelated companies. */
export function selectFinderRole(data: FinderData, options: { source?: FinderData; company_name?: string; external_role_id?: any } = {}): FinderData | undefined {
  const roles: FinderData[] = Array.isArray(data.roles) ? data.roles : [];
  const source = options.source;
  const roleId = source?.person ? source.id : options.external_role_id;
  const orgId = source?.organization?.id;
  const name = (options.company_name || source?.organization?.name || source?.organization_name || '').trim().toLowerCase();
  return roles.find(r => roleId != null && String(r.id) === String(roleId))
    || roles.find(r => orgId != null && String(r.organization?.id) === String(orgId))
    || roles.find(r => name && (r.organization?.name || r.organization_name || '').trim().toLowerCase() === name)
    || roles.filter(r => r.is_current === true).sort((a, b) => String(b.start_date || '').localeCompare(String(a.start_date || '')))[0]
    || roles[0];
}

export function finderPersonRecord(data: FinderData, role?: FinderData): FinderData {
  return {
    external_person_id: data.id ?? data.external_person_id ?? data.person_id,
    external_role_id: role?.id,
    external_organization_id: role?.organization?.id,
    full_name: data.full_name || data.name,
    role_title: role?.role_title || data.role_title,
    company_name: role?.organization?.name || role?.organization_name || data.company_name,
    start_date: role?.start_date, end_date: role?.end_date, is_current: role?.is_current,
    location: typeof data.location === 'string' ? data.location : data.location?.name,
    linkedin_profile: data.linkedin_info?.public_profile_url || data.linkedin_profile || data.linkedin_url,
    emails: contactValues(data.emails, data.work_emails, role?.emails, role?.work_emails),
    personal_emails: contactValues(data.personal_emails),
    phones: contactValues(data.phones, data.phone_numbers, role?.phones, role?.phone_numbers),
    raw_result: data,
  };
}

export function personPersistencePayload(existing: FinderData | null, incoming: FinderData): FinderData {
  const payload: FinderData = {};
  const columns = ['role_query_id', 'external_person_id', 'external_role_id', 'external_organization_id',
    'full_name', 'role_title', 'company_name', 'start_date', 'end_date', 'is_current', 'location', 'linkedin_profile'];
  for (const key of columns) if (hasData(incoming[key])) payload[key] = incoming[key];
  for (const key of ['emails', 'personal_emails', 'phones']) {
    // Preserve provider validation annotations as well as contact values.
    const values = mergeFinderData(existing?.[key], incoming[key]);
    if (hasData(values)) payload[key] = values;
  }
  payload.raw_result = mergeFinderData(existing?.raw_result, incoming.raw_result) || {};
  return payload;
}

export function domainOf(value: any): string {
  if (typeof value !== 'string' || !value.trim()) return '';
  try { return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).hostname.toLowerCase().replace(/^www\./, ''); }
  catch { return ''; }
}

const industries = ['technology', 'finance', 'healthcare', 'education', 'retail', 'manufacturing', 'services', 'hospitality', 'media', 'real_estate', 'logistics', 'nonprofit', 'other'];
const sizes = ['1-10', '11-50', '51-200', '201-500', '501-1000', '1001-5000', '5001-10000', '10001+'];
const revenues = ['<1M', '1M-10M', '10M-50M', '50M-100M', '100M-500M', '500M-1B', '>1B'];
const legalStructures = ['sole_proprietorship', 'partnership', 'llc', 'corporation', 'nonprofit', 'cooperative',
  's_corp', 'c_corp', 'lp', 'llp', 'sa', 'srl', 'gmbh', 'ltd', 'plc', 'bv', 'nv', 'other'];
const businessModels = ['b2b', 'b2c', 'b2b2c', 'marketplace', 'saas', 'ecommerce', 'other'];
const remotePolicies = ['remote_first', 'hybrid', 'office_only', 'flexible'];

/** companies has NO raw_result/metadata column. Unsupported values stay in person/lead snapshots. */
export function finderCompanyRecord(org: FinderData): FinderData {
  const record: FinderData = {};
  // Deliberately omit database IDs (including parent/acquirer relationships) and timestamps.
  const fields = ['name', 'website', 'description', 'legal_name', 'tax_id', 'tax_country', 'registration_number', 'vat_number', 'phone', 'email', 'linkedin_url', 'logo_url',
    'cover_image_url', 'stock_symbol', 'video_url', 'address', 'social_media', 'key_people', 'funding_info',
    'certifications', 'awards', 'products_services', 'tech_stack', 'languages', 'business_hours',
    'press_releases', 'partnerships', 'competitor_info', 'diversity_info', 'office_locations'];
  for (const key of fields) if (hasData(org[key])) record[key] = org[key];
  record.website = org.website || org.domain || undefined;
  record.linkedin_url = org.linkedin_url || org.linkedin_info?.public_profile_url;
  record.description = org.description || org.organization_description || org.linkedin_info?.description;
  record.logo_url = org.logo_url || org.linkedin_info?.logo_url;
  if (!record.funding_info && Array.isArray(org.funding_rounds)) record.funding_info = { rounds: org.funding_rounds };
  const industry = typeof org.industry === 'string' ? org.industry : org.industry?.name || org.linkedin_info?.industry?.name;
  if (industries.includes(industry?.toLowerCase())) record.industry = industry.toLowerCase();
  const size = org.size || org.employee_count_range || org.linkedin_info?.employee_count_range;
  if (sizes.includes(size)) record.size = size;
  if (revenues.includes(org.annual_revenue)) record.annual_revenue = org.annual_revenue;
  if (legalStructures.includes(org.legal_structure)) record.legal_structure = org.legal_structure;
  if (businessModels.includes(org.business_model)) record.business_model = org.business_model;
  if (remotePolicies.includes(org.remote_policy)) record.remote_policy = org.remote_policy;
  if (Number.isInteger(org.sustainability_score) && org.sustainability_score >= 0 && org.sustainability_score <= 100) {
    record.sustainability_score = org.sustainability_score;
  }
  // bigint strings retain precision; unsafe JS numbers must never be rounded into financial data.
  if ((Number.isSafeInteger(org.market_cap) && org.market_cap >= 0)
    || (typeof org.market_cap === 'string' && /^\d+$/.test(org.market_cap)
      && BigInt(org.market_cap) <= BigInt('9223372036854775807'))) record.market_cap = org.market_cap;
  for (const key of ['last_funding_date', 'ipo_date', 'acquisition_date']) {
    const date = org[key];
    if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)
      && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date) record[key] = date;
  }
  const employees = org.employees_count ?? org.employee_count ?? org.linkedin_info?.employees_count;
  if (Number.isInteger(employees) && employees >= 0 && employees <= 2147483647) record.employees_count = employees;
  const founded = org.founded ?? org.founded_year ?? org.linkedin_info?.founded;
  if (typeof founded === 'string' || typeof founded === 'number') record.founded = String(founded);
  if (typeof org.is_public === 'boolean') record.is_public = org.is_public;
  if (!record.address && isRecord(org.location)) record.address = org.location;
  return Object.fromEntries(Object.entries(record).filter(([, value]) => hasData(value)));
}

export function finderLeadProfile(person: FinderData, role?: FinderData): FinderData {
  const raw = person.raw_result || {};
  return {
    position: person.role_title || role?.role_title,
    address: isRecord(raw.location) ? raw.location : person.location ? { formatted_address: person.location } : undefined,
    company: role?.organization,
    metadata: { finder: { person: raw } },
  };
}

/** Handle HTTP-200 provider failures as failures, not empty successful enrichment. */
export function finderResponseError(value: any): string | undefined {
  if (!isRecord(value)) return undefined;
  if (value.success === false || value.error) {
    return typeof value.error === 'string' ? value.error : value.error?.message || value.message || 'Finder provider reported failure';
  }
  return isRecord(value.data) ? finderResponseError(value.data) : undefined;
}