import type { SupabaseClient } from '@supabase/supabase-js';

const identityColumns = 'id, external_person_id, linkedin_profile';
const maxRoleRows = 100;

function providerId(value: unknown): string | undefined {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return undefined;
  const text = String(value ?? '');
  return /^\d+$/.test(text) && BigInt(text) > BigInt(0) ? BigInt(text).toString() : undefined;
}

function linkedInIdentity(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  // Do not let URL normalization accept a raw representation our lookup cannot
  // retrieve (default ports, dot segments, escapes, credentials or whitespace).
  if (!/^https?:\/\/(?:www\.|[a-z]{2}\.)?linkedin\.com\/in\/[a-z0-9-]+\/?(?:\?[^\s#]*)?(?:#[^\s]*)?$/i.test(value)) return undefined;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port
      || !/^(?:www\.|[a-z]{2}\.)?linkedin\.com$/i.test(url.hostname)) return undefined;
    const match = url.pathname.match(/^\/in\/([a-z0-9-]+)\/?$/i);
    return match ? match[1].toLowerCase() : undefined;
  } catch { return undefined; }
}

/** Persons are per-role records. Bridge their lead links only through stable person
 * identity, never names or empty emails. Lead reads are always tenant-scoped.
 * Ambiguous identities and database failures must not become successful matches.
 */
export async function findLeadByFinderIdentity(db: SupabaseClient, personId: string, siteId: string): Promise<any | null> {
  const source = await db.from('persons').select(identityColumns).eq('id', personId).single();
  if (source.error) throw new Error(`Finder lead identity read failed: ${source.error.message}`);
  if (!source.data) throw new Error('Finder lead identity person was not found');
  const externalId = providerId(source.data.external_person_id);
  const linkedIn = linkedInIdentity(source.data.linkedin_profile);
  if (!externalId && !linkedIn) {
    const direct = await db.from('leads').select('*').eq('site_id', siteId).eq('person_id', personId).limit(2);
    if (direct.error) throw new Error(`Finder lead identity lookup failed: ${direct.error.message}`);
    if (!Array.isArray(direct.data)) throw new Error('Invalid Finder identity lead lookup');
    if (direct.data.length > 1) throw new Error('Multiple same-site leads for Finder person identity; reuse requires review');
    return direct.data[0] ?? null;
  }

  let query = db.from('persons').select(identityColumns);
  if (externalId) query = query.eq('external_person_id', externalId);
  // Include accepted country-host/case/query variants, then verify exact parsed
  // identity below. The identifier grammar excludes LIKE wildcard characters.
  else query = query.ilike('linkedin_profile', `%linkedin.com/in/${linkedIn}%`);
  const siblings = await query.order('id').limit(maxRoleRows + 1);
  if (siblings.error) throw new Error(`Finder lead identity roles read failed: ${siblings.error.message}`);
  if (!Array.isArray(siblings.data) || siblings.data.length > maxRoleRows) {
    throw new Error('Finder lead identity exceeds the role safety limit');
  }
  const ids = new Set<string>([personId]);
  const externalIds = new Set<string>();
  for (const person of siblings.data) {
    const otherExternalId = providerId(person.external_person_id);
    const otherLinkedIn = linkedInIdentity(person.linkedin_profile);
    if (!externalId && otherLinkedIn !== linkedIn) continue;
    if ((externalId && otherExternalId !== externalId)
      || (linkedIn && otherLinkedIn && linkedIn !== otherLinkedIn)) {
      throw new Error('Conflicting Finder person identity; lead reuse requires review');
    }
    if (otherExternalId) externalIds.add(otherExternalId);
    ids.add(person.id);
  }
  if (externalIds.size > 1) throw new Error('Conflicting Finder provider identities for LinkedIn profile; reuse requires review');
  const leads = await db.from('leads').select('*').eq('site_id', siteId)
    .in('person_id', [...ids]).order('id').limit(2);
  if (leads.error) throw new Error(`Finder lead identity lookup failed: ${leads.error.message}`);
  if (!Array.isArray(leads.data)) throw new Error('Invalid Finder identity lead lookup');
  if (leads.data.length > 1) throw new Error('Multiple same-site leads for Finder person identity; reuse requires review');
  return leads.data[0] ?? null;
}