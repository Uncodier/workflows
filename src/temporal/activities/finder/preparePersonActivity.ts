import { apiService } from '../../services/apiService';
import { getSupabaseService } from '../../services';
import { isIcpOrganizationIdentityError, type IcpOrganizationReview } from '../../utils/icpIdentityReview';
import { FinderData, finderPersonRecord, finderResponseError, mergeFinderData, normalizeFinderPerson, selectFinderRole } from '../../utils/finderData';
import { matchesSelectedPerson, selectedIdentityColumn, selectedRelatedId } from '../../utils/selectedFinderIdentity';
import { upsertPersonActivity } from './personActivities';
import { upsertFinderCompanyActivity } from './companyActivity';

/** Source-aware preparation is one activity so optional lookup errors cannot bypass persistence.
 * Full snapshots survive sparse details refreshes and contacts are never blanked here.
 */
export async function prepareFinderPersonActivity(options: {
  person_id?: string; linkedin_profile?: string; site_id: string; company_name?: string; source_search_result: FinderData;
  isolate_identity_reviews?: boolean; selected_member_attribution?: boolean;
}): Promise<{ success: boolean; person?: any; role?: any; companyId?: string; errors: string[]; error?: string;
  identityReviews?: IcpOrganizationReview[]; requiresIdentityReview?: boolean }> {
  const errors: string[] = [];
  try {
    if (!await getSupabaseService().getConnectionStatus()) throw new Error('Database not available');
    const { supabaseServiceRole: db } = await import('../../../lib/supabase/client');
    const source = options.source_search_result;
    const sourcePerson = source.person || source;
    const sourceId = sourcePerson.id ?? sourcePerson.external_person_id ?? sourcePerson.person_id;
    const externalId = sourceId ?? options.person_id;
    const selected = options.selected_member_attribution === true;
    const selectedId = options.person_id;
    if (selected && (!selectedId || !matchesSelectedPerson(source, selectedId))) {
      throw new Error('Selected person source identity mismatch');
    }
    const selectedColumn = selected ? selectedIdentityColumn(selectedId!) : undefined;
    const selectedGuard = selected ? { selected_person_id: selectedId } : {};
    const localIdProvided = !selected && options.person_id && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(options.person_id);
    let query = db.from('persons').select('*');
    if (localIdProvided) query = query.eq('id', options.person_id!);
    else if (externalId != null) {
      query = query.eq(selectedColumn ?? 'external_person_id', selected ? selectedId! : externalId);
      if (source.person && source.id != null) query = query.eq('external_role_id', selected ? selectedRelatedId(source.id)! : source.id);
      query = query.order('created_at', { ascending: false }).limit(1);
    } else if (options.linkedin_profile) query = query.eq('linkedin_profile', options.linkedin_profile).limit(1);
    else throw new Error('Finder person identity is required');
    const { data: existing, error: readError } = await query.maybeSingle();
    if (readError) throw new Error(readError.message);
    if (localIdProvided && !existing) throw new Error('Person to enrich was not found');
    if (selected && existing?.raw_result && !matchesSelectedPerson(existing.raw_result, selectedId!)) {
      throw new Error('Conflicting persisted Finder person evidence');
    }
    if (!selected && sourceId != null && existing?.external_person_id != null && String(sourceId) !== String(existing.external_person_id)) {
      throw new Error('Source person identity does not match existing person');
    }

    let details: any;
    const today = new Date().toISOString().slice(0, 10);
    // Selected sources already went through the member-authorized cache/provider lookup.
    if (!selected && (!existing || String(existing.updated_at || existing.created_at || '').slice(0, 10) < today)) {
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
    const raw = selected && !source.person ? mergeFinderData(existing?.raw_result, source)
      : normalizeFinderPerson(source, details, existing?.raw_result);
    const role = selectFinderRole(raw, { source, company_name: options.company_name, external_role_id: existing?.external_role_id });
    const personRecord = finderPersonRecord(raw, role);
    if (selected) {
      personRecord.external_role_id = selectedRelatedId(personRecord.external_role_id);
      personRecord.external_organization_id = selectedRelatedId(personRecord.external_organization_id);
    } else {
      if (!/^\d+$/.test(String(personRecord.external_person_id))) personRecord.external_person_id = existing?.external_person_id;
      if (!personRecord.external_person_id && /^\d+$/.test(String(externalId))) personRecord.external_person_id = externalId;
    }
    // persons are per-role: do not mutate a different role's local row (and its lead links).
    const sameRole = existing?.external_role_id == null || personRecord.external_role_id == null
      || String(existing.external_role_id) === String(personRecord.external_role_id);
    const saved = await upsertPersonActivity({ ...personRecord, ...selectedGuard, id: sameRole ? existing?.id : undefined, raw_result: raw });
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
      const reviewed = await upsertPersonActivity({ ...selectedGuard, id: saved.person.id,
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
