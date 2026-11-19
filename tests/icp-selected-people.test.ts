import { processSelectedPeople } from '../src/temporal/workflows/icpMining/processSelectedPeople';
import { processOwnedIcp } from '../src/temporal/workflows/icpMining/processOwned';

const member = { ordinal: '9007199254740993', person_id: '12345', created_by: 'carlos' };
const state = { selectedOnly: true, searchExhausted: false, pending: 1, members: [member] };
const source = { person: { id: '12345', first_name: 'Real' }, organization: { name: 'Company' } };
const options = { id: 'list', site_id: 'site', run_id: 'run', version: 0, processed: 4, found: 1,
  max_candidates: 2, max_matches: 1, research_enabled: false, state };
const matched = { success: true, leadId: 'lead', errors: [], executionTime: '', completedAt: '' };
const deps = {
  getSelectedIcpPersonActivity: jest.fn(), acknowledgeSelectedIcpPersonActivity: jest.fn(),
  getLeadActivity: jest.fn(), enrich: jest.fn(), research: jest.fn(),
};
beforeEach(() => {
  jest.resetAllMocks(); deps.getSelectedIcpPersonActivity.mockResolvedValue(source);
  deps.enrich.mockResolvedValue(matched);
  deps.acknowledgeSelectedIcpPersonActivity.mockResolvedValue({ version: 1, processed: 5, found: 2 });
});

it('uses the real persisted person document and creator, preserving BIGINT ordinal', async () => {
  expect(await processSelectedPeople(options, deps)).toMatchObject({ version: 1, processed: 5, found: 2, success: true });
  expect(deps.enrich).toHaveBeenCalledWith(expect.objectContaining({ person_id: '12345', userId: 'carlos',
    source_search_result: source, validated_contact_policy: true, selected_member_attribution: true }), member.ordinal);
  expect(deps.acknowledgeSelectedIcpPersonActivity).toHaveBeenCalledWith(expect.objectContaining({
    ordinal: member.ordinal, version: 1, lead_id: 'lead', outcome: 'matched' }));
});

it.each([['provider outage'], ['Insufficient credits']])('leaves failed candidates pending: %s', async message => {
  deps.enrich.mockResolvedValue({ ...matched, success: false, leadId: undefined, errors: [message] });
  expect(await processSelectedPeople(options, deps)).toMatchObject({ retryableFailure: true, processed: 4, found: 1 });
  expect(deps.acknowledgeSelectedIcpPersonActivity).not.toHaveBeenCalled();
});

it('keeps the selected candidate pending until requested real research completes', async () => {
  deps.getLeadActivity.mockResolvedValue({ success: true, lead: { id: 'lead', site_id: 'site' } });
  deps.research.mockResolvedValue({ success: false, errors: ['Research retry required'] });
  expect(await processSelectedPeople({ ...options, research_enabled: true }, deps)).toMatchObject({ retryableFailure: true });
  expect(deps.research).toHaveBeenCalledWith(expect.objectContaining({ userId: 'carlos', lead_id: 'lead' }), member.ordinal);
  expect(deps.acknowledgeSelectedIcpPersonActivity).not.toHaveBeenCalled();
});

it('durably consumes no-match but does not count a lead', async () => {
  deps.enrich.mockResolvedValue({ ...matched, leadId: undefined, outcome: 'no_match' });
  deps.acknowledgeSelectedIcpPersonActivity.mockResolvedValue({ version: 1, processed: 5, found: 1 });
  expect(await processSelectedPeople(options, deps)).toMatchObject({ processed: 5, found: 1 });
});

const identityReview = { ...matched, personId: 'persisted-person', leadId: undefined, outcome: 'needs_review',
  selectedIdentityReview: { siteId: 'site', providerId: member.person_id, reason: 'conflicting_lead_identity' } };
it('persists an exact selected contact identity conflict as review without linking or counting a lead', async () => {
  deps.enrich.mockResolvedValue(identityReview);
  deps.acknowledgeSelectedIcpPersonActivity.mockRejectedValue(new Error('ACK lost'));
  const reconcile = jest.fn().mockResolvedValue({ version: 1, processed: 5, found: 1 });
  expect(await processSelectedPeople({ ...options, research_enabled: true }, { ...deps, reconcileSelectedIcpPersonAckActivity: reconcile }))
    .toMatchObject({ processed: 5, found: 1, retryableFailure: false });
  expect(reconcile).toHaveBeenCalledWith(expect.objectContaining({ ordinal: member.ordinal, person_id: member.person_id,
    lead_id: undefined, outcome: 'needs_review', processed: 5, found: 1 }));
  expect(deps.getLeadActivity).not.toHaveBeenCalled(); expect(deps.research).not.toHaveBeenCalled();
});

it.each([{ success: false }, { personId: undefined }, { personId: ' ' }, { leadId: 'unrelated-lead' }, { outcome: 'matched' },
  { outcome: 'no_match' }, { selectedIdentityReview: null }, { selectedIdentityReview: undefined },
  { selectedIdentityReview: { ...identityReview.selectedIdentityReview, reason: 'uncertain' } },
  { selectedIdentityReview: { ...identityReview.selectedIdentityReview, providerId: '012345' } },
  { selectedIdentityReview: { ...identityReview.selectedIdentityReview, siteId: 'other-site' } }])(
  'refuses unproven/mismatched selected identity-review outcomes: %j', async invalid => {
    deps.enrich.mockResolvedValue({ ...identityReview, ...invalid });
    const reconcile = jest.fn();
    expect(await processSelectedPeople(options, { ...deps, reconcileSelectedIcpPersonAckActivity: reconcile }))
      .toMatchObject({ processed: 4, found: 1, retryableFailure: true });
    expect(deps.acknowledgeSelectedIcpPersonActivity).not.toHaveBeenCalled();
    expect(reconcile).not.toHaveBeenCalled();
  },
);

it('does not introduce a new needs_review ACK on pre-recovery histories', async () => {
  deps.enrich.mockResolvedValue(identityReview);
  expect(await processSelectedPeople(options, deps)).toMatchObject({ processed: 4, found: 1, retryableFailure: true });
  expect(deps.acknowledgeSelectedIcpPersonActivity).not.toHaveBeenCalled();
});

it.each([state, { ...state, pending: 0, members: [] }])('selected-only legacy owned runs never execute role search', async selected => {
  const executePageSearch = jest.fn(); const checkpoint = jest.fn(); const finalize = jest.fn();
  const snapshot = { page: 2, candidates: [{ person: { id: 'search-person' } }], hasMore: true };
  await processOwnedIcp({ icp: { id: 'list' }, options: { site_id: 'site' }, workflowId: 'workflow', maxPages: 3,
    pageSize: 10, targetLeadsWithEmail: 1, actualUserId: 'site-owner',
    deps: { executePageSearch } as any, execution: { runId: 'run', workflowId: 'workflow' },
    claim: async () => ({ acquired: true, icp: { id: 'list', processed_targets: 4, found_matches: 1,
      current_page: 2, current_page_offset: 1, current_page_snapshot: snapshot, checkpoint_version: 0 } as any }),
    checkpoint, selected: { read: async () => selected, finalize, deps } });
  expect(executePageSearch).not.toHaveBeenCalled();
  expect(checkpoint).toHaveBeenCalledWith(expect.objectContaining({ page: 2, offset: 1, snapshot, status: 'pending' }));
  expect(finalize).toHaveBeenCalled();
});