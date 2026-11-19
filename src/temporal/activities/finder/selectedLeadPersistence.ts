import type { SupabaseClient } from '@supabase/supabase-js';
import { contactValues, mergeFinderData, type FinderData } from '../../utils/finderData';
import { selectedIdentityColumn, type SelectedIdentityReview } from '../../utils/selectedFinderIdentity';

interface Identity {
  site_id: string;
  person_id: string; // Prepared local role row, not a provider ID.
  selected_person_id: string;
}

/** Internal control flow only; send typed evidence rather than matching a DB error string in a workflow. */
export class ConfirmedSelectedLeadConflict extends Error {
  readonly review: SelectedIdentityReview;
  constructor(input: Identity) {
    super('Confirmed selected Finder lead identity conflict');
    this.review = { siteId: input.site_id, providerId: input.selected_person_id, reason: 'conflicting_lead_identity' };
  }
}

interface SelectedLeadInput extends Identity {
  expected_lead_id?: string;
  userId?: string;
  name?: string; email?: string; personal_email?: string; phone?: string; person_emails?: string[];
  profile?: FinderData; linkedin_url?: string; company_id?: string; segment_id?: string;
}

/** Resolve all roles of exactly this provider person, not LinkedIn, name or
 * contact-key candidates. SQL does the comparison before any BIGINT reaches JS. */
export async function findSelectedLead(db: SupabaseClient, input: Identity): Promise<FinderData | null> {
  const { selected_person_id: id, person_id: localId, site_id: site } = input;
  const column = selectedIdentityColumn(id);
  const person = await db.from('persons').select('id').eq('id', localId).eq(column, id).single();
  if (person.error || person.data?.id !== localId) throw new Error(person.error?.message || 'Selected Finder person identity changed');

  const { data, error } = await db.from('leads')
    .select('id,person_id,email,personal_email,phone,company_id,metadata,persons!leads_person_id_fkey!inner(id)')
    .eq('site_id', site).eq(`persons.${column}`, id).limit(2);
  if (error) throw new Error(error.message);
  if (!Array.isArray(data) || data.length > 2 || data.some(row => !row?.id || !row.person_id)) {
    throw new Error('Invalid selected Finder identity lookup');
  }
  if (data.length === 2) {
    if (data[0].id === data[1].id) throw new Error('Inconsistent selected Finder identity lookup');
    throw new ConfirmedSelectedLeadConflict(input);
  }
  return data[0] ?? null;
}

/** A contact-key conflict is not permission to update a lead. In one read,
 * verify the exact site/name/email and the winner's distinct (or absent) link.
 * PostgREST casts BIGINT to text in the projection so no JS number is evidence. */
async function confirmContactConflict(db: SupabaseClient, input: SelectedLeadInput) {
  const name = input.name || 'Unknown';
  const email = input.email || ''; // The real unique key also covers phone-only leads with email=''.
  const { data: row, error } = await db.from('leads')
    .select('id,person_id,site_id,name,email,persons!leads_person_id_fkey(id,finder_selected_person_id,numeric_id:external_person_id::text)')
    .eq('site_id', input.site_id).eq('name', name).eq('email', email).maybeSingle();
  if (error) throw new Error(error.message);
  if (!row?.id || row.site_id !== input.site_id || row.name !== name || row.email !== email) return;
  if (row.person_id === null && row.persons === null) throw new ConfirmedSelectedLeadConflict(input);
  const p = row.persons as FinderData | null;
  if (!p || p.id !== row.person_id || !p.id) return;
  if (p.finder_selected_person_id !== null && typeof p.finder_selected_person_id !== 'string') return;
  if (p.numeric_id !== null && typeof p.numeric_id !== 'string') return;
  const linkedId = p.finder_selected_person_id ?? p.numeric_id;
  if (typeof linkedId === 'string' && linkedId !== input.selected_person_id) throw new ConfirmedSelectedLeadConflict(input);
}

/** No ordinary name/email fallback is reachable on this path, including after
 * a 23505. Only the SQL-gated insert and metadata-only update can write leads. */
export async function saveSelectedLead(db: SupabaseClient, input: SelectedLeadInput) {
  const { selected_person_id, site_id, person_id, userId, profile } = input;
  if (!userId) throw new Error('Selected Finder creator is required');
  const existing = await findSelectedLead(db, input);
  if (input.expected_lead_id !== undefined && existing?.id !== input.expected_lead_id) {
    throw new Error('Selected Finder lead changed before persistence');
  }
  const finderMetadata = (lead?: FinderData) => mergeFinderData(mergeFinderData(lead?.metadata?.finder, profile?.metadata?.finder), {
    contacts: { emails: contactValues(lead?.email, input.email, input.person_emails),
      personal_emails: contactValues(lead?.personal_email, input.personal_email), phones: contactValues(lead?.phone, input.phone) },
  });
  const updated = async (lead: FinderData) => {
    const { data, error } = await db.rpc('update_selected_finder_lead', {
      p_site_id: site_id, p_lead_id: lead.id, p_person_id: lead.person_id, p_selected_person_id: selected_person_id,
      p_segment_id: input.segment_id ?? null, p_finder_metadata: finderMetadata(lead),
      p_previous_finder_metadata: lead.metadata?.finder ?? null,
    });
    if (error || !data?.id || data.id !== lead.id) throw new Error(error?.message || 'Selected Finder lead update was not confirmed');
    return { success: true, leadId: data.id, lead: data };
  };
  if (existing) return updated(existing);
  if (!input.email && !input.phone && !input.personal_email) throw new Error('Selected Finder lead requires a validated contact');
  const { data, error } = await db.rpc('insert_selected_finder_lead', {
    p_site_id: site_id, p_person_id: person_id, p_selected_person_id: selected_person_id,
    p_lead: { user_id: userId, name: input.name || 'Unknown', email: input.email || '', phone: input.phone,
      personal_email: input.personal_email, company_id: input.company_id, segment_id: input.segment_id,
      position: profile?.position, address: profile?.address, company: profile?.company,
      ...(input.linkedin_url ? { social_networks: { linkedin: input.linkedin_url } } : {}),
      metadata: { finder: finderMetadata(), emailVerified: !!input.email } },
  });
  if (error?.code === '23505') {
    const winner = await findSelectedLead(db, input);
    if (winner) return updated(winner);
    // Only this exact constraint plus an actual conflicting row is terminal.
    // A disappeared/moved row, unrelated constraint or failed read stays pending.
    if (error.message.includes('"leads_site_name_email_unique"')) await confirmContactConflict(db, input);
  }
  if (error || !data?.id) throw new Error(error?.message || 'Selected Finder lead insert was not confirmed');
  return { success: true, leadId: data.id, lead: data };
}
