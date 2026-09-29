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
});