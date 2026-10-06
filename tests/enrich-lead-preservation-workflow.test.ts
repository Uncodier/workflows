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
import { processPageSafely } from '../src/temporal/workflows/icpMining/processPageSafely';
import { generatePersonEmailWorkflow } from '../src/temporal/workflows/generatePersonEmailWorkflow';

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

  it('isolates employer review without buying contacts or associating a lead', async () => {
    const identityReviews = [{ id: 'site:31', site_id: 'site', organization: source.organization,
      selected: true, status: 'pending', error: 'Ambiguous organization identity: Acme' }];
    mockActivities.prepareFinderPersonActivity.mockResolvedValue({ success: true, person, errors: [],
      requiresIdentityReview: true, identityReviews });
    expect(await enrichLeadWorkflow({ person_id: '11', site_id: 'site', source_search_result: source, validated_contact_policy: true }))
      .toMatchObject({ success: true, outcome: 'needs_review', personId: person.id, identityReviews, errors: [] });
    expect(mockActivities.prepareFinderPersonActivity).toHaveBeenCalledWith(expect.objectContaining({ isolate_identity_reviews: true }));
    for (const name of ['checkExistingLeadForPersonActivity', 'lookEmailOnIcyPeas', 'callPersonWorkEmailsActivity',
      'callPersonContactsLookupPersonalEmailsActivity', 'callPersonContactsLookupPhoneNumbersActivity', 'upsertLeadForPersonActivity']) {
      expect(mockActivities[name]).not.toHaveBeenCalled();
    }
    expect(mockExecuteChild).not.toHaveBeenCalled();
  });

  it('keeps secondary identity reviews out of contact errors and returns the saved lead', async () => {
    const identityReviews = [{ id: 'site:32', site_id: 'site', organization: { name: 'University' },
      selected: false, status: 'pending', error: 'Ambiguous organization identity: University' }];
    mockActivities.prepareFinderPersonActivity.mockResolvedValue({ success: true, person, role: person.raw_result.roles[0],
      companyId: 'correct-company', errors: [], requiresIdentityReview: false, identityReviews });
    expect(await enrichLeadWorkflow({ person_id: '11', site_id: 'site', source_search_result: source, validated_contact_policy: true }))
      .toMatchObject({ success: true, outcome: 'matched', leadId: 'saved-lead', identityReviews, errors: [] });
    expect(mockActivities.upsertLeadForPersonActivity).toHaveBeenCalledWith(expect.objectContaining({ company_id: 'correct-company' }));
  });

  it('keeps preparation payload unchanged for histories without the review-isolation patch', async () => {
    mockPatched.mockImplementation(id => id !== 'icp-isolate-organization-reviews-v1');
    await enrichLeadWorkflow({ person_id: '11', site_id: 'site', source_search_result: source, validated_contact_policy: true });
    expect(mockActivities.prepareFinderPersonActivity.mock.calls[0][0]).not.toHaveProperty('isolate_identity_reviews');
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

  function withoutContacts() {
    mockActivities.prepareFinderPersonActivity.mockResolvedValue({ success: true,
      person: { ...person, emails: [], phones: [], personal_emails: [], raw_result: { finder_search_result: source } },
      role: { organization: source.organization }, companyId: 'company', errors: [] });
  }

  it('finishes a provider-only ICP no-match without generation or Reoon calls', async () => {
    withoutContacts();
    expect(await enrichLeadWorkflow({ person_id: '11', site_id: 'site', source_search_result: source, validated_contact_policy: true }))
      .toMatchObject({ success: true, outcome: 'no_match', errors: [] });
    expect(mockPatched).toHaveBeenCalledWith('icp-provider-only-contacts-v1');
    for (const name of ['lookEmailOnIcyPeas', 'callPersonWorkEmailsActivity',
      'callPersonContactsLookupPersonalEmailsActivity', 'callPersonContactsLookupPhoneNumbersActivity']) {
      expect(mockActivities[name]).toHaveBeenCalledTimes(1);
    }
    expect(mockExecuteChild).not.toHaveBeenCalled();
    expect(mockActivities.validateContactInformation).not.toHaveBeenCalled();
    expect(mockActivities.upsertLeadForPersonActivity).not.toHaveBeenCalled();
    expect(mockActivities.logWorkflowExecutionActivity).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'COMPLETED' }));
  });

  it('still saves a phone-only provider match without generating an email', async () => {
    withoutContacts();
    mockActivities.callPersonContactsLookupPhoneNumbersActivity.mockResolvedValue({ success: true, phoneNumbers: [{ phone_number: '+14155551234' }] });
    expect(await enrichLeadWorkflow({ person_id: '11', site_id: 'site', source_search_result: source, validated_contact_policy: true }))
      .toMatchObject({ success: true, outcome: 'matched', leadId: 'saved-lead', errors: [] });
    expect(mockActivities.upsertLeadForPersonActivity).toHaveBeenCalledWith(expect.objectContaining({ phone: '+14155551234', email: undefined }));
    expect(mockExecuteChild).not.toHaveBeenCalled();
    expect(mockActivities.validateContactInformation).not.toHaveBeenCalled();
  });

  it('does not mistake a provider failure for a definitive no-match', async () => {
    withoutContacts();
    mockActivities.callPersonWorkEmailsActivity.mockResolvedValue({ success: false, error: 'HTTP 402 INSUFFICIENT_CREDITS' });
    expect(await enrichLeadWorkflow({ person_id: '11', site_id: 'site', source_search_result: source, validated_contact_policy: true }))
      .toMatchObject({ success: false, errors: ['HTTP 402 INSUFFICIENT_CREDITS'] });
    expect(mockExecuteChild).not.toHaveBeenCalled();
    expect(mockActivities.upsertLeadForPersonActivity).not.toHaveBeenCalled();
  });

  it('keeps the generation child for ICP histories without the provider-only patch', async () => {
    withoutContacts();
    mockPatched.mockImplementation(id => id !== 'icp-provider-only-contacts-v1');
    mockExecuteChild.mockResolvedValue({ success: false, outcome: 'retryable_error', error: 'Reoon has no available verification credits' });
    expect(await enrichLeadWorkflow({ person_id: '11', site_id: 'site', source_search_result: source, validated_contact_policy: true }))
      .toMatchObject({ success: false, errors: ['Reoon has no available verification credits'] });
    expect(mockExecuteChild).toHaveBeenCalledWith(generatePersonEmailWorkflow, expect.objectContaining({
      workflowId: 'generate-email-icp-local-person-site', args: [expect.objectContaining({ reportOutcome: true })],
    }));
  });

  it('checkpoints a provider no-match and moves on to the next candidate in the same slice', async () => {
    withoutContacts();
    mockActivities.callPersonWorkEmailsActivity.mockResolvedValueOnce({ success: true, emails: [] })
      .mockResolvedValueOnce({ success: true, emails: ['next@acme.test'] });
    const enrich = jest.fn((options: Parameters<typeof enrichLeadWorkflow>[0]) => enrichLeadWorkflow(options));
    const checkpoint = jest.fn().mockResolvedValue({ success: true });
    const result = await processPageSafely({ site_id: 'site', userId: 'user', role_query_id: 'role', icp_mining_id: 'list',
      page: 0, page_size: 10, max_candidates: 2, max_matches: 1,
      snapshot: { page: 0, candidates: [source, { ...source, person: { id: 12, full_name: 'Next Person' } }], hasMore: false },
      execution: { run_id: 'run', version: 0, processed: 0, found: 0 },
    }, { enrich, checkpointIcpMiningExecutionActivity: checkpoint,
      getSegmentIdFromRoleQueryActivity: jest.fn().mockResolvedValue({ success: true }),
    } as any);
    expect(result).toMatchObject({ success: true, processed: 2, foundMatches: 1, pageCompleted: true, errors: [],
      checkpoint: { processed: 2, found: 1, page: 1, offset: 0, snapshot: null } });
    expect(enrich.mock.calls.map(([options]) => options.person_id)).toEqual(['11', '12']);
    expect(checkpoint).toHaveBeenNthCalledWith(1, expect.objectContaining({ processed: 1, found: 0, offset: 1 }));
    expect(mockActivities.upsertLeadForPersonActivity).toHaveBeenCalledTimes(1);
    expect(mockExecuteChild).not.toHaveBeenCalled();
    expect(mockActivities.validateContactInformation).not.toHaveBeenCalled();
  });
});