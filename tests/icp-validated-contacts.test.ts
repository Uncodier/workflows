import { enrichWithValidatedContacts } from '../src/temporal/workflows/icpMining/enrichWithValidatedContacts';
import { emailCandidates, usablePhoneNumbers } from '../src/temporal/utils/icpContactCandidates';

describe('ICP validated contact policy', () => {
  const source = { person: { id: 1, work_emails: [{ email: 'bounce@acme.test', validation_status: 'invalid' }] }, organization: { name: 'Acme', domain: 'acme.test' } };
  function fixture() {
    const person = { id: 'person', external_person_id: 1, full_name: 'Ada Example', emails: ['bounce@acme.test'], raw_result: { finder_search_result: source } };
    const deps: any = {
      prepareFinderPersonActivity: jest.fn().mockResolvedValue({ success: true, person, companyId: 'company', role: { organization: source.organization }, errors: [] }),
      checkExistingLeadForPersonActivity: jest.fn().mockResolvedValue({ success: true }),
      validateContactInformation: jest.fn().mockResolvedValue({ success: true, isValid: true }),
      lookEmailOnIcyPeas: jest.fn().mockResolvedValue({ success: true, data: { email: 'valid@acme.test' } }),
      callPersonWorkEmailsActivity: jest.fn().mockResolvedValue({ success: true, emails: [] }),
      callPersonContactsLookupPersonalEmailsActivity: jest.fn().mockResolvedValue({ success: true, emails: [] }),
      callPersonContactsLookupPhoneNumbersActivity: jest.fn().mockResolvedValue({ success: true, phoneNumbers: [] }),
      upsertPersonActivity: jest.fn().mockImplementation(async (update: any) => ({ success: true, person: { ...person, ...update } })),
      upsertLeadForPersonActivity: jest.fn().mockResolvedValue({ success: true, leadId: 'lead' }),
    };
    return { deps, options: { site_id: 'site', person_id: '1', source_search_result: source } };
  }
  it('does not promote known-invalid contacts or let their plain copies bypass rejection', () => {
    expect(emailCandidates(['bounce@acme.test'], source.person.work_emails)).toEqual([]);
    expect(usablePhoneNumbers(['not a phone', '+14155551234'], [{ phone_number: '+14155551234', status: 'invalid' }])).toEqual([]);
  });
  it('searches and validates an alternative instead of counting an invalid provider email', async () => {
    const f = fixture();
    expect(await enrichWithValidatedContacts(f.options, f.deps)).toMatchObject({ success: true, outcome: 'matched', leadId: 'lead' });
    expect(f.deps.lookEmailOnIcyPeas).toHaveBeenCalled();
    expect(f.deps.validateContactInformation).toHaveBeenCalledWith({ email: 'valid@acme.test', hasEmailMessage: true });
    expect(f.deps.upsertLeadForPersonActivity.mock.calls[0][0]).toMatchObject({ email: 'valid@acme.test', validated_contact_policy: true });
    expect(f.deps.upsertPersonActivity.mock.calls[0][0].raw_result.finder_search_result).toEqual(source);
  });
  it('distinguishes genuine no-match from transient validation/provider errors', async () => {
    const f = fixture();
    f.deps.lookEmailOnIcyPeas.mockResolvedValue({ success: true, data: {} });
    expect(await enrichWithValidatedContacts(f.options, f.deps)).toMatchObject({ success: true, outcome: 'no_match' });
    expect(f.deps.upsertLeadForPersonActivity).not.toHaveBeenCalled();
    f.deps.callPersonWorkEmailsActivity.mockResolvedValue({ success: false, error: 'provider timeout' });
    expect(await enrichWithValidatedContacts(f.options, f.deps)).toMatchObject({ success: false, errors: ['provider timeout'] });
  });
  it('does not turn a database write error into a definitive no-match', async () => {
    const f = fixture();
    f.deps.upsertLeadForPersonActivity.mockResolvedValue({ success: false, error: 'db down' });
    expect(await enrichWithValidatedContacts(f.options, f.deps)).toMatchObject({ success: false, errors: ['db down'] });
  });
  it('preserves a trusted existing primary before validated provider alternatives', async () => {
    const f = fixture();
    f.deps.checkExistingLeadForPersonActivity.mockResolvedValue({ success: true, existingLead: {
      email: 'trusted@acme.test', metadata: { emailVerified: true }, phone: '+14155551234',
    } });
    f.deps.validateContactInformation.mockRejectedValue(new Error('offline'));
    expect(await enrichWithValidatedContacts(f.options, f.deps)).toMatchObject({ success: true, outcome: 'matched' });
    expect(f.deps.upsertLeadForPersonActivity.mock.calls[0][0]).toMatchObject({ email: 'trusted@acme.test' });
  });
  it('continues to save a reachable phone when email validation throws', async () => {
    const f = fixture();
    f.deps.checkExistingLeadForPersonActivity.mockResolvedValue({ success: true, existingLead: { email: 'unknown@acme.test', phone: '+14155551234' } });
    f.deps.validateContactInformation.mockRejectedValue(new Error('offline'));
    expect(await enrichWithValidatedContacts(f.options, f.deps)).toMatchObject({ success: true, outcome: 'matched' });
    expect(f.deps.upsertLeadForPersonActivity.mock.calls[0][0]).toMatchObject({ phone: '+14155551234' });
  });

  it('does not spend on fallback providers while the durable IcyPeas search is pending', async () => {
    const f = fixture();
    f.deps.lookEmailOnIcyPeas.mockResolvedValue({ success: false, outcome: 'pending', searchId: 'search', error: 'Still pending' });
    expect(await enrichWithValidatedContacts(f.options, f.deps)).toMatchObject({ success: false, errors: ['Still pending'] });
    expect(f.deps.callPersonWorkEmailsActivity).not.toHaveBeenCalled();
    expect(f.deps.callPersonContactsLookupPersonalEmailsActivity).not.toHaveBeenCalled();
    expect(f.deps.callPersonContactsLookupPhoneNumbersActivity).not.toHaveBeenCalled();
    expect(f.deps.upsertLeadForPersonActivity).not.toHaveBeenCalled();
  });

  it('stops trying paid contact providers after a credit failure', async () => {
    const f = fixture();
    f.deps.lookEmailOnIcyPeas.mockResolvedValue({ success: false, error: 'Insufficient credits' });
    expect(await enrichWithValidatedContacts(f.options, f.deps, { stopOnCreditFailure: true }))
      .toMatchObject({ success: false, errors: ['Insufficient credits'] });
    expect(f.deps.callPersonWorkEmailsActivity).not.toHaveBeenCalled();
    expect(f.deps.callPersonContactsLookupPersonalEmailsActivity).not.toHaveBeenCalled();
    expect(f.deps.callPersonContactsLookupPhoneNumbersActivity).not.toHaveBeenCalled();
  });

  it('validates all completed IcyPeas alternatives instead of treating certainty as verified', async () => {
    const f = fixture();
    f.deps.lookEmailOnIcyPeas.mockResolvedValue({ success: true, outcome: 'matched', searchId: 'search',
      data: { email: 'first@acme.test', emails: [{ email: 'first@acme.test', certainty: 'ultra_sure' }, { email: 'valid@acme.test', certainty: 'probable' }] } });
    f.deps.validateContactInformation.mockResolvedValueOnce({ success: true, isValid: false })
      .mockResolvedValueOnce({ success: true, isValid: true });
    expect(await enrichWithValidatedContacts(f.options, f.deps)).toMatchObject({ success: true, leadId: 'lead' });
    expect(f.deps.validateContactInformation).toHaveBeenCalledTimes(2);
    expect(f.deps.upsertLeadForPersonActivity).toHaveBeenCalledWith(expect.objectContaining({ email: 'valid@acme.test' }));
    expect(f.deps.callPersonWorkEmailsActivity).not.toHaveBeenCalled();
  });

  describe('provider-trust policy', () => {
    const policy = { trustProviderEmails: true };
    const noCredits = { success: false, error: 'Reoon has no available verification credits' };

    it.each(['icypeas', 'work_emails', 'personal_emails'])('saves %s results without Reoon credits or AI generation', async provider => {
      const f = fixture();
      f.deps.validateContactInformation.mockResolvedValue(noCredits);
      f.deps.generateEmail = jest.fn();
      if (provider !== 'icypeas') f.deps.lookEmailOnIcyPeas.mockResolvedValue({ success: true, data: {} });
      if (provider === 'work_emails') f.deps.callPersonWorkEmailsActivity.mockResolvedValue({ success: true, emails: ['valid@acme.test'] });
      if (provider === 'personal_emails') f.deps.callPersonContactsLookupPersonalEmailsActivity.mockResolvedValue({ success: true, emails: ['valid@acme.test'] });
      expect(await enrichWithValidatedContacts(f.options, f.deps, policy)).toMatchObject({ success: true, outcome: 'matched', leadId: 'lead', errors: [] });
      expect(f.deps.validateContactInformation).not.toHaveBeenCalled();
      expect(f.deps.generateEmail).not.toHaveBeenCalled();
      expect(f.deps.callPersonContactsLookupPhoneNumbersActivity).not.toHaveBeenCalled();
      expect(f.deps.upsertLeadForPersonActivity).toHaveBeenCalledWith(expect.objectContaining({
        [provider === 'personal_emails' ? 'personal_email' : 'email']: 'valid@acme.test', validated_contact_policy: true,
      }));
    });

    it.each([
      { emails: ['cached@acme.test'] },
      { raw_result: { work_emails: ['cached@acme.test'] } },
      { raw_result: { finder_search_result: { person: { work_emails: ['cached@acme.test'] } } } },
      { raw_result: { finder_details: { person: { work_emails: ['cached@acme.test'] } } } },
      { raw_result: { roles: [{ work_emails: ['cached@acme.test'] }] } },
    ])('reuses cached/prepared provider contacts without verification (%j)', async contacts => {
      const f = fixture();
      f.deps.prepareFinderPersonActivity.mockResolvedValue({ success: true, errors: [], person: { id: 'person', ...contacts } });
      f.deps.validateContactInformation.mockResolvedValue(noCredits);
      expect(await enrichWithValidatedContacts(f.options, f.deps, policy)).toMatchObject({ success: true, outcome: 'matched', errors: [] });
      expect(f.deps.upsertLeadForPersonActivity).toHaveBeenCalledWith(expect.objectContaining({ email: 'cached@acme.test' }));
      expect(f.deps.validateContactInformation).not.toHaveBeenCalled();
      expect(f.deps.lookEmailOnIcyPeas).not.toHaveBeenCalled();
    });

    it('still rejects malformed and explicitly invalid provider results and deduplicates alternatives', async () => {
      const f = fixture();
      f.deps.lookEmailOnIcyPeas.mockResolvedValue({ success: true, data: { emails: [
        'not-an-email', 'bounce@acme.test', { email: 'BOUNCE@acme.test', validation_status: 'invalid' },
        { email: 'valid@acme.test', certainty: 'probable' }, 'VALID@acme.test',
      ] } });
      expect(await enrichWithValidatedContacts(f.options, f.deps, policy)).toMatchObject({ success: true, errors: [] });
      expect(f.deps.upsertPersonActivity).toHaveBeenCalledWith(expect.objectContaining({ emails: ['valid@acme.test'] }));
      expect(f.deps.validateContactInformation).not.toHaveBeenCalled();
    });

    it('does not assume an unknown-origin legacy lead email came from a provider', async () => {
      const f = fixture();
      f.deps.checkExistingLeadForPersonActivity.mockResolvedValue({ success: true, existingLead: { email: 'unknown@acme.test' } });
      expect(await enrichWithValidatedContacts(f.options, f.deps, policy)).toMatchObject({ success: true, errors: [] });
      expect(f.deps.upsertLeadForPersonActivity).toHaveBeenCalledWith(expect.objectContaining({ email: 'valid@acme.test' }));
      expect(f.deps.validateContactInformation).not.toHaveBeenCalled();
    });

    it('does not revive a known-invalid email returned without annotations by a later provider', async () => {
      const f = fixture();
      f.deps.lookEmailOnIcyPeas.mockResolvedValue({ success: true, data: { email: 'bounce@acme.test' } });
      f.deps.callPersonWorkEmailsActivity.mockResolvedValue({ success: true, emails: [
        { email: 'bounce@acme.test', verified: true }, 'valid@acme.test',
      ] });
      expect(await enrichWithValidatedContacts(f.options, f.deps, policy)).toMatchObject({ success: true, outcome: 'matched', errors: [] });
      expect(f.deps.upsertPersonActivity).toHaveBeenCalledWith(expect.objectContaining({ emails: ['valid@acme.test'] }));
      expect(f.deps.validateContactInformation).not.toHaveBeenCalled();
    });

    it('does not bypass a work-email rejection by returning its plain copy as a personal email', async () => {
      const f = fixture();
      f.deps.lookEmailOnIcyPeas.mockResolvedValue({ success: true, data: {} });
      f.deps.callPersonContactsLookupPersonalEmailsActivity.mockResolvedValue({ success: true, emails: ['bounce@acme.test'] });
      expect(await enrichWithValidatedContacts(f.options, f.deps, policy)).toMatchObject({ success: true, outcome: 'no_match' });
      expect(f.deps.upsertLeadForPersonActivity).not.toHaveBeenCalled();
      expect(f.deps.validateContactInformation).not.toHaveBeenCalled();
    });

    it('retains the pending-provider and database-failure safeguards', async () => {
      const f = fixture();
      f.deps.lookEmailOnIcyPeas.mockResolvedValueOnce({ success: false, outcome: 'pending', error: 'Still pending' });
      expect(await enrichWithValidatedContacts(f.options, f.deps, policy)).toMatchObject({ success: false, errors: ['Still pending'] });
      expect(f.deps.callPersonWorkEmailsActivity).not.toHaveBeenCalled();
      expect(f.deps.upsertLeadForPersonActivity).not.toHaveBeenCalled();
      f.deps.upsertLeadForPersonActivity.mockResolvedValue({ success: false, error: 'db down' });
      expect(await enrichWithValidatedContacts(f.options, f.deps, policy)).toMatchObject({ success: false, errors: ['db down'] });
      expect(f.deps.validateContactInformation).not.toHaveBeenCalled();
    });

    it('preserves a previously verified primary before provider alternatives', async () => {
      const f = fixture();
      f.deps.checkExistingLeadForPersonActivity.mockResolvedValue({ success: true,
        existingLead: { email: 'trusted@acme.test', metadata: { emailVerified: true } } });
      expect(await enrichWithValidatedContacts(f.options, f.deps, policy)).toMatchObject({ success: true, errors: [] });
      expect(f.deps.upsertLeadForPersonActivity).toHaveBeenCalledWith(expect.objectContaining({ email: 'trusted@acme.test' }));
      expect(f.deps.validateContactInformation).not.toHaveBeenCalled();
      expect(f.deps.lookEmailOnIcyPeas).not.toHaveBeenCalled();
    });

    it('does not harvest unvalidated AI guesses stored in raw enrichment responses', async () => {
      const f = fixture();
      f.deps.prepareFinderPersonActivity.mockResolvedValue({ success: true, errors: [], person: { id: 'person',
        raw_result: { finder_contact_enrichment: { generated_email: { success: false, generatedEmails: ['guess@acme.test'] } } } } });
      expect(await enrichWithValidatedContacts(f.options, f.deps, policy)).toMatchObject({ success: true, outcome: 'no_match' });
      expect(f.deps.upsertLeadForPersonActivity).not.toHaveBeenCalled();
      expect(f.deps.validateContactInformation).not.toHaveBeenCalled();
    });

    it.each([
      { success: true, outcome: 'matched', validatedEmail: 'ai@acme.test', generatedEmails: ['guess@acme.test', 'ai@acme.test'] },
      { success: false, outcome: 'no_match', generatedEmails: ['guess@acme.test'] },
      { success: false, outcome: 'retryable_error', error: noCredits.error, generatedEmails: ['guess@acme.test'] },
    ])('accepts only the validated AI fallback result (%j)', async generated => {
      const f = fixture();
      f.deps.lookEmailOnIcyPeas.mockResolvedValue({ success: true, data: {} });
      f.deps.generateEmail = jest.fn().mockResolvedValue(generated);
      const result = await enrichWithValidatedContacts(f.options, f.deps, policy);
      expect(f.deps.generateEmail).toHaveBeenCalledWith(expect.objectContaining({ reportOutcome: true, person_id: 'person' }));
      if (generated.success) {
        expect(result).toMatchObject({ success: true, outcome: 'matched', errors: [] });
        expect(f.deps.upsertLeadForPersonActivity).toHaveBeenCalledWith(expect.objectContaining({ email: 'ai@acme.test', person_emails: ['ai@acme.test'] }));
      } else {
        expect(f.deps.upsertLeadForPersonActivity).not.toHaveBeenCalled();
        expect(result).toMatchObject(generated.outcome === 'no_match'
          ? { success: true, outcome: 'no_match' } : { success: false, errors: [noCredits.error] });
      }
      expect(f.deps.validateContactInformation).not.toHaveBeenCalled();
    });
  });
});