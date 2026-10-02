const mockActivities: Record<string, jest.Mock> = {};
const mockExecuteChild = jest.fn();
const mockPatched = jest.fn();
jest.mock('@temporalio/workflow', () => ({
  proxyActivities: () => new Proxy({}, { get: (_target, name: string) => {
    if (!mockActivities[name]) mockActivities[name] = jest.fn();
    return mockActivities[name];
  } }),
  upsertSearchAttributes: jest.fn(), executeChild: (...args: any[]) => mockExecuteChild(...args),
  patched: (...args: any[]) => mockPatched(...args),
}));
jest.mock('../src/temporal/workflows/generatePersonEmailWorkflow', () => ({ generatePersonEmailWorkflow: jest.fn() }));

import { enrichLeadWorkflow } from '../src/temporal/workflows/enrichLeadWorkflow';

const source = { id: 21, person: { id: 11, full_name: 'Ada' }, organization: { id: 31, name: 'Acme', domain: 'acme.test' } };
const person = { id: 'local-person', external_person_id: 11, external_role_id: 21, full_name: 'Ada', company_name: 'Acme',
  role_title: 'President', emails: ['ada@acme.test'], phones: ['+1234'], personal_emails: ['ada@personal.test'],
  raw_result: { finder_search_result: source, roles: [{ id: 21, organization: source.organization }], research: { report: 'rich report' } } };

describe('enrichLeadWorkflow source-aware persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPatched.mockReturnValue(true);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockActivities.logWorkflowExecutionActivity.mockResolvedValue(undefined);
    mockActivities.checkPersonByLinkedInActivity.mockResolvedValue({ success: true, hasExistingPerson: false });
    mockActivities.prepareFinderPersonActivity.mockResolvedValue({ success: true, person, role: person.raw_result.roles[0], companyId: 'correct-company', errors: [] });
    mockActivities.checkExistingLeadForPersonActivity.mockResolvedValue({ success: true, hasExistingLead: false });
    mockActivities.upsertPersonActivity.mockImplementation(async input => ({ success: true, person: { ...person, ...input, id: person.id } }));
    mockActivities.upsertLeadForPersonActivity.mockResolvedValue({ success: true, leadId: 'saved-lead' });
    mockActivities.upsertCompanyActivity.mockResolvedValue({ success: true, company: { id: 'company' } });
    mockActivities.lookEmailOnIcyPeas.mockResolvedValue({ success: true, data: {} });
    mockActivities.callPersonContactsLookupPersonalEmailsActivity.mockResolvedValue({ success: true, emails: [] });
    mockActivities.callPersonWorkEmailsActivity.mockResolvedValue({ success: true, emails: [] });
    mockActivities.callPersonContactsLookupPhoneNumbersActivity.mockResolvedValue({ success: true, phoneNumbers: [] });
    mockExecuteChild.mockResolvedValue({ success: false });
  });
  afterEach(() => jest.restoreAllMocks());

  it('passes full provider person/org and correct company link through actual workflow saves', async () => {
    const result = await enrichLeadWorkflow({ person_id: '11', site_id: 'site', segment_id: 'segment', source_search_result: source });
    expect(result).toMatchObject({ success: true, personId: 'local-person', leadId: 'saved-lead', errors: [] });
    expect(mockActivities.prepareFinderPersonActivity).toHaveBeenCalledWith(expect.objectContaining({ source_search_result: source }));
    expect(mockActivities.upsertPersonActivity).toHaveBeenCalledWith(expect.objectContaining({ id: 'local-person', emails: ['ada@acme.test', 'ada@personal.test'],
      phones: ['+1234'], raw_result: expect.objectContaining({ research: { report: 'rich report' }, finder_search_result: source }) }));
    expect(mockActivities.upsertLeadForPersonActivity).toHaveBeenCalledWith(expect.objectContaining({ company_id: 'correct-company', segment_id: 'segment',
      profile: expect.objectContaining({ position: 'President', company: source.organization,
        metadata: { finder: { person: expect.objectContaining({ finder_search_result: source }) } } }) }));
    expect(mockActivities.upsertCompanyActivity).not.toHaveBeenCalled();
    expect(mockActivities.callPersonContactsLookupDetailsActivity).not.toHaveBeenCalled();
  });

  it('returns optional provider errors alongside a successfully persisted existing lead', async () => {
    mockActivities.prepareFinderPersonActivity.mockResolvedValue({ success: true, person, companyId: 'company', errors: ['Details lookup: quota exceeded'] });
    const result = await enrichLeadWorkflow({ person_id: '11', site_id: 'site', source_search_result: source });
    expect(result).toMatchObject({ success: true, leadId: 'saved-lead', errors: ['Details lookup: quota exceeded'] });
  });

  it('cannot claim a successful save after a company preparation failure', async () => {
    mockActivities.prepareFinderPersonActivity.mockResolvedValue({ success: false, error: 'Company save denied', errors: ['Company save denied'] });
    const result = await enrichLeadWorkflow({ person_id: '11', site_id: 'site', source_search_result: source });
    expect(result).toMatchObject({ success: false, errors: ['Company save denied'] });
    expect(mockActivities.upsertLeadForPersonActivity).not.toHaveBeenCalled();
  });

  it('cannot claim success when lead save returns success without a persisted row ID', async () => {
    mockActivities.upsertLeadForPersonActivity.mockResolvedValue({ success: true });
    expect(await enrichLeadWorkflow({ person_id: '11', site_id: 'site', source_search_result: source }))
      .toMatchObject({ success: false, errors: [expect.stringContaining('Failed to update/create lead')] });
  });

  it('keeps all lookup errors and fails when no contact can be saved', async () => {
    const empty = { ...person, emails: [], phones: [], personal_emails: [] };
    mockActivities.prepareFinderPersonActivity.mockResolvedValue({ success: true, person: empty, companyId: 'company', errors: [] });
    mockActivities.lookEmailOnIcyPeas.mockRejectedValue(new Error('Icy unavailable'));
    mockActivities.callPersonContactsLookupPersonalEmailsActivity.mockResolvedValue({ success: false, error: 'Personal unavailable' });
    mockActivities.callPersonWorkEmailsActivity.mockResolvedValue({ success: false, error: 'Work unavailable' });
    mockActivities.callPersonContactsLookupPhoneNumbersActivity.mockRejectedValue(new Error('Phone unavailable'));
    mockActivities.upsertLeadForPersonActivity.mockResolvedValue({ success: false, error: 'No contacts' });
    const result = await enrichLeadWorkflow({ person_id: '11', site_id: 'site', source_search_result: source });
    expect(result.success).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining(['IcyPeas: Icy unavailable', 'Personal emails: Personal unavailable',
      'Work emails: Work unavailable', 'Phone numbers: Phone unavailable', 'Failed to update/create lead: No contacts']));
    expect(mockActivities.upsertPersonActivity).toHaveBeenCalledWith(expect.objectContaining({
      raw_result: expect.objectContaining({ finder_contact_enrichment: expect.objectContaining({ work_emails: { success: false, error: 'Work unavailable' } }) }),
    }));
  });

  it('does not schedule the new preparation activity for historical no-source workflow inputs', async () => {
    mockActivities.checkPersonByLinkedInActivity.mockResolvedValue({ success: true, hasExistingPerson: true, existingPerson: { ...person, created_at: new Date().toISOString() } });
    const result = await enrichLeadWorkflow({ person_id: '11', site_id: 'site' });
    expect(mockActivities.prepareFinderPersonActivity).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it.each([false, true])('preserves legacy IcyPeas payloads and adds tenant context only with the patch (%s)', async enabled => {
    mockPatched.mockReturnValue(enabled);
    const empty = { ...person, emails: [], phones: [], personal_emails: [] };
    mockActivities.prepareFinderPersonActivity.mockResolvedValue({ success: true, person: empty, companyId: 'company', errors: [] });
    await enrichLeadWorkflow({ person_id: '11', site_id: 'site', source_search_result: source });
    expect(mockPatched).toHaveBeenCalledWith('icypeas-durable-email-search-v1');
    expect(mockActivities.lookEmailOnIcyPeas).toHaveBeenCalledWith({ domainOrCompany: 'acme.test',
      firstname: 'Ada', lastname: undefined, ...(enabled ? { site_id: 'site' } : {}) });
  });

  it('also stops non-validated enrichment while IcyPeas is pending', async () => {
    mockActivities.prepareFinderPersonActivity.mockResolvedValue({ success: true,
      person: { ...person, emails: [], phones: [], personal_emails: [] }, companyId: 'company', errors: [] });
    mockActivities.lookEmailOnIcyPeas.mockResolvedValue({ success: false, outcome: 'pending', error: 'Still pending' });
    expect(await enrichLeadWorkflow({ person_id: '11', site_id: 'site', source_search_result: source }))
      .toMatchObject({ success: false, errors: ['IcyPeas: Still pending'] });
    expect(mockActivities.callPersonWorkEmailsActivity).not.toHaveBeenCalled();
    expect(mockActivities.callPersonContactsLookupPersonalEmailsActivity).not.toHaveBeenCalled();
    expect(mockActivities.callPersonContactsLookupPhoneNumbersActivity).not.toHaveBeenCalled();
  });

  it.each([false, true])('uses the provider-trust patch only for the ICP contact policy (%s)', async enabled => {
    mockPatched.mockImplementation(id => id !== 'icp-provider-email-trust-v1' || enabled);
    mockActivities.validateContactInformation.mockResolvedValue({ success: true, isValid: true });
    expect(await enrichLeadWorkflow({ person_id: '11', site_id: 'site', source_search_result: source, validated_contact_policy: true }))
      .toMatchObject({ success: true, leadId: 'saved-lead', errors: [] });
    expect(mockPatched).toHaveBeenCalledWith('icp-provider-email-trust-v1');
    if (enabled) expect(mockActivities.validateContactInformation).not.toHaveBeenCalled();
    else expect(mockActivities.validateContactInformation).toHaveBeenCalledTimes(2);
    expect(mockExecuteChild).not.toHaveBeenCalled();
  });
});