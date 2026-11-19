import { getSupabaseService } from '../../services';
import { FinderData, domainOf, finderCompanyRecord, mergeFinderData } from '../../utils/finderData';

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
    const { supabaseServiceRole: db } = await import('../../../lib/supabase/client');
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
