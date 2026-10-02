import { resolveIcyPeasEmail } from '../src/temporal/activities/icypeas/resolveEmail';
import { enrichWithValidatedContacts } from '../src/temporal/workflows/icpMining/enrichWithValidatedContacts';
import { processOwnedIcp } from '../src/temporal/workflows/icpMining/processOwned';
import { processPageSafely } from '../src/temporal/workflows/icpMining/processPageSafely';

// Real worker orchestration/lookup/validation/checkpoint flow. Only external
// API/storage boundaries are simulated; tests never buy a provider search.
describe('IcyPeas results reach ICP checkpoints', () => {
  it.each([false, true])('waits through provider pending, saves and counts once (trustProviderEmails=%s)', async trustProviderEmails => {
    const site_id = '9be0a6a2-5567-41bf-ad06-cb4014f0faf2';
    const source = { person: { id: 1 }, organization: { name: 'Acme', domain: 'acme.test' } };
    let now = 0;
    let row: any = { id: 'icp', site_id, role_query_id: 'role', total_targets: 1,
      current_page: 0, current_page_offset: 0, processed_targets: 0, found_matches: 0, checkpoint_version: 0 };
    const api = jest.fn().mockResolvedValueOnce({ success: true, data: { outcome: 'pending', status: 'NONE', searchId: 'durable-search' } })
      .mockResolvedValueOnce({ success: true, data: { outcome: 'matched', status: 'FOUND', searchId: 'durable-search',
        emails: [{ email: 'ada@acme.test', certainty: 'ultra_sure' }] } });
    const sleep = jest.fn(async (ms: number) => {
      expect(row.processed_targets).toBe(0);
      expect(row.found_matches).toBe(0);
      expect(row.current_page_snapshot.candidates).toEqual([source]);
      now += ms;
    });
    const person = { id: 'person', external_person_id: 1, full_name: 'Ada Example', raw_result: {} };
    const contacts: any = {
      prepareFinderPersonActivity: jest.fn().mockResolvedValue({ success: true, person, errors: [], role: { organization: source.organization } }),
      checkExistingLeadForPersonActivity: jest.fn().mockResolvedValue({ success: true }),
      lookEmailOnIcyPeas: (options: any) => resolveIcyPeasEmail({ ...options, site_id }, { request: api, now: () => now, sleep }),
      validateContactInformation: jest.fn().mockResolvedValue(trustProviderEmails
        ? { success: false, error: 'Reoon has no available verification credits' }
        : { success: true, isValid: true }),
      upsertPersonActivity: jest.fn().mockImplementation(async (options: any) => ({ success: true, person: { ...person, ...options } })),
      upsertLeadForPersonActivity: jest.fn().mockResolvedValue({ success: true, leadId: 'saved-lead' }),
      callPersonWorkEmailsActivity: jest.fn(), callPersonContactsLookupPersonalEmailsActivity: jest.fn(),
      callPersonContactsLookupPhoneNumbersActivity: jest.fn(), generateEmail: jest.fn(),
    };
    const checkpoint = jest.fn(async (change: any) => {
      expect(change.version).toBe(row.checkpoint_version + 1);
      row = { ...row, checkpoint_version: change.version, processed_targets: change.processed,
        found_matches: change.found, current_page: change.page, current_page_offset: change.offset,
        current_page_snapshot: change.snapshot, status: change.status };
      return { success: true };
    });
    const pageDeps: any = {
      getRoleQueryByIdActivity: jest.fn().mockResolvedValue({ success: true, roleQuery: { query: {} } }),
      callPersonRoleSearchActivity: jest.fn().mockResolvedValue({ success: true, total: 1, hasMore: false, data: { search_results: [source] } }),
      getSegmentIdFromRoleQueryActivity: jest.fn().mockResolvedValue({ success: true }),
      checkpointIcpMiningExecutionActivity: checkpoint,
      enrich: (options: any) => enrichWithValidatedContacts(options, contacts, { trustProviderEmails }),
    };
    const result = await processOwnedIcp({ icp: row, options: { site_id }, maxPages: 300, targetLeadsWithEmail: 150,
      execution: { runId: 'run', workflowId: 'workflow' }, claim: async () => ({ acquired: true, icp: row }), checkpoint,
      deps: { executePageSearch: (options: any) => processPageSafely(options, pageDeps) },
    } as any);
    expect(result).toMatchObject({ processed: 1, foundMatches: 1, errors: [] });
    expect(row).toMatchObject({ status: 'completed', processed_targets: 1, found_matches: 1, current_page_snapshot: null });
    expect(api).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(15_000);
    if (trustProviderEmails) expect(contacts.validateContactInformation).not.toHaveBeenCalled();
    else expect(contacts.validateContactInformation).toHaveBeenCalledWith({ email: 'ada@acme.test', hasEmailMessage: true });
    expect(contacts.upsertLeadForPersonActivity).toHaveBeenCalledTimes(1);
    expect(contacts.upsertPersonActivity.mock.calls[0][0].raw_result.finder_contact_enrichment.icypeas.searchId).toBe('durable-search');
    expect(contacts.callPersonWorkEmailsActivity).not.toHaveBeenCalled();
    expect(contacts.callPersonContactsLookupPersonalEmailsActivity).not.toHaveBeenCalled();
    expect(contacts.callPersonContactsLookupPhoneNumbersActivity).not.toHaveBeenCalled();
    expect(contacts.generateEmail).not.toHaveBeenCalled();
  });
});