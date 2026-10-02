import type { Activities } from '../../activities';
import type { EnrichLeadOptions, EnrichLeadResult } from '../enrichLeadWorkflow';
import type { generatePersonEmailWorkflow } from '../generatePersonEmailWorkflow';
import { domainOf, finderLeadProfile, mergeFinderData } from '../../utils/finderData';
import { emailCandidates, personContactDocuments, usablePhoneNumbers } from '../../utils/icpContactCandidates';

type Deps = Pick<Activities, 'prepareFinderPersonActivity' | 'checkExistingLeadForPersonActivity' | 'validateContactInformation'
  | 'lookEmailOnIcyPeas' | 'callPersonWorkEmailsActivity' | 'callPersonContactsLookupPersonalEmailsActivity'
  | 'callPersonContactsLookupPhoneNumbersActivity' | 'upsertPersonActivity' | 'upsertLeadForPersonActivity'> & {
    generateEmail?: typeof generatePersonEmailWorkflow;
  };

/** Raw contacts are retained, but only usable contacts can terminate enrichment. */
export async function enrichWithValidatedContacts(options: EnrichLeadOptions, deps: Deps,
  policy: { trustProviderEmails?: boolean } = {}): Promise<EnrichLeadResult> {
  const start = Date.now();
  const errors: string[] = [];
  const responses: Record<string, any> = {};
  const finish = (data: Partial<EnrichLeadResult>): EnrichLeadResult => ({ success: false, errors,
    executionTime: `${((Date.now() - start) / 1000).toFixed(2)}s`, completedAt: new Date().toISOString(), ...data });
  try {
    const prepared = await deps.prepareFinderPersonActivity({ ...options, source_search_result: options.source_search_result! });
    errors.push(...prepared.errors);
    if (!prepared.success || !prepared.person?.id) throw new Error(prepared.error || 'Person preparation failed');
    const person = prepared.person;
    const checked = await deps.checkExistingLeadForPersonActivity({ person_id: person.id, site_id: options.site_id });
    if (!checked.success) throw new Error(checked.error || 'Lead lookup failed');
    const lead = checked.existingLead;
    const documents = personContactDocuments(person);
    // Finder preparation supplies provider contacts (including cached results).
    // Do not infer provider origin from an unrelated existing lead's email, or
    // scan generatedEmails: AI guesses are usable only after child validation.
    const providerEmails = new Set(policy.trustProviderEmails
      ? emailCandidates(...documents.flatMap(doc => [doc.emails, doc.work_emails, doc.personal_emails]))
        .map(candidate => candidate.email.toLowerCase()) : []);
    const work: string[] = [];
    const personal: string[] = [];
    const phones = usablePhoneNumbers(...documents.flatMap(doc => [doc.phones, doc.phone_numbers]), lead?.phone);
    const leadEmail = lead?.email ? { email: lead.email, verified: lead.metadata?.emailVerified === true,
      validation_status: lead.metadata?.email_validation?.status } : undefined;
    const emailEvidence = policy.trustProviderEmails
      ? [leadEmail, lead?.personal_email, ...documents.flatMap(doc => [doc.emails, doc.work_emails, doc.personal_emails])] : [];
    const examined = new Map<string, boolean>();
    const acceptEmails = async (lists: any[], target: string[], fromProvider = false) => {
      // A plain copy from a later lookup must not revive a known-invalid email.
      if (policy.trustProviderEmails) emailEvidence.push(...lists);
      const eligible = policy.trustProviderEmails
        ? new Set(emailCandidates(...emailEvidence).map(candidate => candidate.email.toLowerCase())) : undefined;
      for (const candidate of emailCandidates(...lists)) {
        const key = candidate.email.toLowerCase();
        if (eligible && !eligible.has(key)) continue;
        let valid = examined.get(key);
        if (valid === undefined) {
          if (candidate.verified || (policy.trustProviderEmails && (fromProvider || providerEmails.has(key)))) valid = true;
          else {
            // Unknown-origin legacy lead values are not proof of a provider
            // result. Look for a provider contact instead of trusting/rechecking
            // them; the AI fallback has its own mandatory validation workflow.
            if (policy.trustProviderEmails) continue;
            try {
              const result = await deps.validateContactInformation({ email: candidate.email, hasEmailMessage: true });
              if (!result.success) { errors.push(result.error || 'Email validation unavailable'); continue; }
              valid = result.isValid === true;
            } catch (error) { errors.push(`Email validation unavailable: ${String(error)}`); continue; }
          }
          examined.set(key, valid);
        }
        if (valid && !target.includes(candidate.email)) target.push(candidate.email);
      }
    };
    await acceptEmails([leadEmail, ...documents.flatMap(doc => [doc.emails, doc.work_emails])], work);
    await acceptEmails([lead?.personal_email, ...documents.map(doc => doc.personal_emails)], personal);
    const available = () => !!(work.length || personal.length || phones.length);
    const params = { site_id: options.site_id, person_id: String(person.external_person_id || options.person_id),
      userId: options.userId, company_name: options.company_name };
    const lookup = async (key: string, call: () => Promise<any>, accept: (result: any) => Promise<void>) => {
      try {
        const result = await call(); responses[key] = result;
        if (!result.success && result.outcome !== 'no_match') errors.push(result.error?.message || result.error || `${key} unavailable`);
        else await accept(result);
      } catch (error) { errors.push(`${key}: ${String(error)}`); }
    };
    const company = prepared.role?.organization || {};
    const domain = domainOf(company.website || company.domain);
    if (!available() && domain && person.full_name) {
      const [firstname, ...last] = person.full_name.split(/\s+/);
      await lookup('icypeas', () => deps.lookEmailOnIcyPeas({ domainOrCompany: domain, firstname, lastname: last.join(' ') }),
        result => acceptEmails([result.data?.emails || result.data?.email], work, true));
      // A queued paid search is not a no-match. Leave this candidate at its
      // checkpoint; its durable search will be resumed instead of buying fallbacks.
      if (responses.icypeas?.outcome === 'pending') return finish({ personId: person.id });
    }
    if (!available()) await lookup('work_emails', () => deps.callPersonWorkEmailsActivity(params), result => acceptEmails([result.emails], work, true));
    if (!available()) await lookup('personal_emails', () => deps.callPersonContactsLookupPersonalEmailsActivity(params), result => acceptEmails([result.emails], personal, true));
    if (!available()) await lookup('phones', () => deps.callPersonContactsLookupPhoneNumbersActivity(params), async result => {
      phones.push(...usablePhoneNumbers(result.phoneNumbers));
    });
    if (!available() && domain && person.full_name && deps.generateEmail) {
      await lookup('generated_email', () => deps.generateEmail!({ reportOutcome: true, person_id: person.id, full_name: person.full_name,
        company_name: company.name || options.company_name || person.company_name, company_domain: domain,
        company_website: company.website, role_title: prepared.role?.role_title, site_id: options.site_id,
        userId: options.userId, person_raw_result: person.raw_result }), result =>
        acceptEmails([result.validatedEmail ? { email: result.validatedEmail, verified: true } : undefined], work));
    }
    const savedPerson = await deps.upsertPersonActivity({ id: person.id,
      emails: work, personal_emails: personal, phones,
      raw_result: mergeFinderData(person.raw_result, { finder_contact_enrichment: responses }),
    });
    if (!savedPerson.success || !savedPerson.person?.id) throw new Error(savedPerson.error || 'Enriched person was not saved');
    if (!available()) return finish({ success: errors.length === 0, outcome: errors.length ? undefined : 'no_match', personId: person.id });
    const profile = finderLeadProfile(savedPerson.person, prepared.role);
    profile.metadata = mergeFinderData(profile.metadata, { finder: { validated_contacts: { emails: work, personal_emails: personal, phones } } });
    const saved = await deps.upsertLeadForPersonActivity({ person_id: person.id, site_id: options.site_id, userId: options.userId,
      name: person.full_name, email: work[0], personal_email: personal[0], phone: phones[0], person_emails: work,
      company_id: prepared.companyId || lead?.company_id, segment_id: options.segment_id,
      linkedin_url: person.linkedin_profile, profile, validated_contact_policy: true,
    });
    if (!saved.success || !saved.leadId) throw new Error(saved.error || 'Lead was not saved');
    return finish({ success: true, outcome: 'matched', personId: person.id, leadId: saved.leadId,
      enrichedData: { workEmails: work.map(email => ({ email, validation_status: 'valid' })), personalEmails: personal.map(email => ({ email })), phoneNumbers: phones.map(phone_number => ({ phone_number })) } });
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
    return finish({ success: false });
  }
}