import type { SelectedIdentityReview } from '../../utils/selectedFinderIdentity';
import { ConfirmedSelectedLeadConflict, findSelectedLead, saveSelectedLead } from './selectedLeadPersistence';
import type { PostgrestError } from '@supabase/supabase-js';
import { getSupabaseService } from '../../services';
import { findLeadByFinderIdentity } from '../../services/finderLeadIdentity';
import { FinderData, contactValues, hasData, mergeFinderData } from '../../utils/finderData';

// Check if lead already exists for a person
export async function checkExistingLeadForPersonActivity(options: {
  person_id: string;
  site_id: string;
  selected_person_id?: string;
  icp_role_identity?: boolean;
}): Promise<{
  success: boolean;
  hasExistingLead: boolean;
  existingLead?: any;
  error?: string;
  selectedIdentityReview?: SelectedIdentityReview;
}> {
  try {
    const supabaseService = getSupabaseService();
    const isConnected = await supabaseService.getConnectionStatus();
    if (!isConnected) return { success: false, hasExistingLead: false, error: 'Database not available' };
    const { supabaseServiceRole } = await import('../../../lib/supabase/client');

    if (options.selected_person_id !== undefined) {
      const lead = await findSelectedLead(supabaseServiceRole, { ...options, selected_person_id: options.selected_person_id });
      return { success: true, hasExistingLead: !!lead, existingLead: lead ?? undefined };
    }

    // Check the local role first, then bridge other roles of the same identity.
    const { data: personLead, error } = await supabaseServiceRole
      .from('leads')
      .select('id, name, email, phone, personal_email, status, created_at, company_id, metadata')
      .eq('site_id', options.site_id)
      .eq('person_id', options.person_id)
      .limit(1)
      .maybeSingle();

    if (error) return { success: false, hasExistingLead: false, error: error.message };
    const existingLead = options.icp_role_identity
      ? await findLeadByFinderIdentity(supabaseServiceRole, options.person_id, options.site_id) : personLead;
    
    const hasExistingLead = !!existingLead;
    return { 
      success: true, 
      hasExistingLead, 
      existingLead: hasExistingLead ? existingLead : undefined 
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, hasExistingLead: false, error: message,
      ...(error instanceof ConfirmedSelectedLeadConflict ? { selectedIdentityReview: error.review } : {}) };
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
  selected_person_id?: string;
  expected_lead_id?: string;
  validated_contact_policy?: boolean;
  icp_reuse_only?: boolean; // Existing ICP leads keep their identity and contact columns.
}): Promise<{
  success: boolean;
  lead?: any;
  leadId?: string;
  error?: string;
  selectedIdentityReview?: SelectedIdentityReview;
}> {
  try {
    const supabaseService = getSupabaseService();
    const isConnected = await supabaseService.getConnectionStatus();
    if (!isConnected) return { success: false, error: 'Database not available' };
    const { supabaseServiceRole } = await import('../../../lib/supabase/client');

    if (options.selected_person_id !== undefined) {
      return await saveSelectedLead(supabaseServiceRole, { ...options, selected_person_id: options.selected_person_id });
    }

    // Check if lead already exists
    const { data: personLead, error: checkError } = await supabaseServiceRole
      .from('leads')
      .select('*')
      .eq('person_id', options.person_id)
      .eq('site_id', options.site_id)
      .maybeSingle();

    if (checkError) {
      return { success: false, error: checkError.message };
    }

    let existingLead = personLead;
    let reuseContactLead = false;
    if (options.icp_reuse_only) {
      existingLead = await findLeadByFinderIdentity(supabaseServiceRole, options.person_id, options.site_id);
      reuseContactLead = !!existingLead;
    }
    const findContactLead = (name: string, email: string) => supabaseServiceRole
      .from('leads')
      .select('*')
      .eq('site_id', options.site_id)
      .eq('name', name)
      .eq('email', email)
      .maybeSingle();

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

    // Legacy leads may be linked to another local person record. Match the exact
    // unique key, never a name alone or an empty email, before creating a duplicate.
    const contactEmail = options.validated_contact_policy
      ? options.email || '' : options.email || contactValues(personEmails)[0] || '';
    if (!existingLead && hasData(contactEmail)) {
      const { data, error } = await findContactLead(leadName || 'Unknown', contactEmail);
      if (error) return { success: false, error: error.message };
      existingLead = data;
      reuseContactLead = !!data;
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
    
    const hasAtLeastOneContact = hasPersonWorkEmail || hasPersonalEmail || hasPhone
      || ((!options.validated_contact_policy || options.icp_reuse_only) && hasExistingContact);
    
    if (!hasAtLeastOneContact) {
      return { success: false, error: 'Person must have at least 1 contact method (work email, personal email, or phone) to create/update lead' };
    }

    const buildLeadData = (): FinderData => {
      const leadData: FinderData = {
        // Reusing a lead does not merge/reassign the underlying person records.
        person_id: reuseContactLead ? existingLead?.person_id || options.person_id : options.person_id,
        site_id: options.site_id,
        name: leadName,
        // Empty email is required by the schema for phone-only creation.
        email: options.validated_contact_policy ? options.email || '' : existingLead?.email || options.email || contactValues(personEmails)[0] || '',
        // A contact-key match adds data without clearing/replacing existing contacts.
        phone: options.validated_contact_policy && !reuseContactLead ? options.phone || null : existingLead?.phone || options.phone || null,
        personal_email: options.validated_contact_policy && !reuseContactLead ? options.personal_email || null : existingLead?.personal_email || options.personal_email || null,
        updated_at: new Date().toISOString(),
      };

      for (const key of ['position', 'address', 'company', 'metadata', 'social_networks']) {
        if (hasData(options.profile?.[key])) {
          leadData[key] = mergeFinderData(existingLead?.[key], options.profile![key]);
        }
      }
      if (options.profile?.metadata?.finder || reuseContactLead) {
        // Keep both prior primaries and any new alternatives in structured metadata.
        leadData.metadata = mergeFinderData(leadData.metadata || existingLead?.metadata, { finder: { contacts: {
          emails: contactValues(existingLead?.email, options.email, personEmails),
          personal_emails: contactValues(existingLead?.personal_email, options.personal_email),
          phones: contactValues(existingLead?.phone, options.phone),
        } } });
      }
      if (options.validated_contact_policy) {
        leadData.metadata = { ...existingLead?.metadata, ...leadData.metadata, emailVerified: !!options.email };
      }

      // Merge social profiles rather than clearing other platforms.
      if (options.linkedin_url) {
        const existingSocial = existingLead?.social_networks && typeof existingLead.social_networks === 'object'
          ? existingLead.social_networks : {};
        leadData.social_networks = { ...existingSocial, ...leadData.social_networks, linkedin: options.linkedin_url };
      }

      if (options.company_id) leadData.company_id = options.company_id;
      if (options.segment_id) leadData.segment_id = options.segment_id;

      if (options.notes) {
        if (existingLead?.notes && !existingLead.notes.includes(options.notes)) {
          leadData.notes = `${existingLead.notes}\n${options.notes}`;
        } else {
          leadData.notes = existingLead?.notes || options.notes;
        }
      }

      if (options.userId && (!reuseContactLead || !existingLead?.user_id)) {
        leadData.user_id = options.userId;
      }

      return leadData;
    };

    // Do not build a full update (with an email/name rewrite) for an ICP lead
    // already identified by person_id. Only new leads need the creation payload.
    const leadData = existingLead && options.icp_reuse_only ? null : buildLeadData();
    const updateExistingLead = () => {
      // ICP only needs to assign the segment and merge Finder metadata on an
      // existing lead. Rewriting email/name/person_id can collide with another
      // lead's unique (site_id, name, email), especially for email=''.
      const payload = options.icp_reuse_only ? (() => {
        const update: FinderData = {};
        if (options.segment_id) update.segment_id = options.segment_id;
        const contacts = {
          emails: contactValues(existingLead?.email, options.email, personEmails),
          personal_emails: contactValues(existingLead?.personal_email, options.personal_email),
          phones: contactValues(existingLead?.phone, options.phone),
        };
        const incoming = mergeFinderData(options.profile?.metadata, {
          finder: { contacts },
        });
        if (hasData(incoming)) update.metadata = mergeFinderData(existingLead?.metadata, incoming);
        return update;
      })() : buildLeadData();
      return supabaseServiceRole.from('leads').update(payload)
        .eq('site_id', options.site_id).eq('id', existingLead!.id).select().single();
    };

    const recoverContactConflict = async (error: PostgrestError) => {
      // Only this known uniqueness conflict is recoverable. Other DB failures
      // must retain the candidate checkpoint instead of masquerading as a match.
      if (error.code !== '23505' || !error.message.includes('"leads_site_name_email_unique"')) return { data: null, error };
      if (options.icp_reuse_only) {
        const canonical = await findLeadByFinderIdentity(supabaseServiceRole, options.person_id, options.site_id);
        if (canonical) {
          existingLead = canonical;
          reuseContactLead = true;
          return updateExistingLead();
        }
      }
      if (!leadData || !hasData(leadData.email)) return { data: null, error };
      const found = await findContactLead(leadData.name, leadData.email);
      if (found.error) return { data: null, error: found.error };
      if (!found.data) return { data: null, error };
      existingLead = found.data;
      reuseContactLead = true;
      // Rebuild against the winner's metadata/contacts, not the failed insert.
      // Do not carry creation fields (status, origin, created_at) into the update.
      return updateExistingLead();
    };

    let resultLead: any;

    if (existingLead) {
      // Update existing lead
      let { data, error } = await updateExistingLead();
      if (error) ({ data, error } = await recoverContactConflict(error));

      if (error) return { success: false, error: error.message };
      resultLead = data;
    } else {
      // Create new lead
      const newLeadData = leadData!;
      if (!options.userId) {
        // Try to get user_id from site
        const { data: site, error } = await supabaseServiceRole
          .from('sites')
          .select('user_id')
          .eq('id', options.site_id)
          .single();
        
        if (error) return { success: false, error: error.message };
        if (site?.user_id) {
          newLeadData.user_id = site.user_id;
        } else {
          return { success: false, error: 'user_id is required to create lead' };
        }
      }

      newLeadData.status = 'new';
      newLeadData.origin = 'lead_enrichment_workflow';
      newLeadData.created_at = new Date().toISOString();

      let { data, error } = await supabaseServiceRole
        .from('leads')
        .insert([newLeadData])
        .select()
        .single();

      if (error) ({ data, error } = await recoverContactConflict(error));
      if (error) return { success: false, error: error.message };
      resultLead = data;
    }

    if (!resultLead?.id) return { success: false, error: 'Lead save returned no row' };
    return { success: true, lead: resultLead, leadId: resultLead.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message,
      ...(error instanceof ConfirmedSelectedLeadConflict ? { selectedIdentityReview: error.review } : {}) };
  }
}
