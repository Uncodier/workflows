const mockActivities = {
  dispatchIcpMiningActivity: jest.fn(), beginIcpDispatchActivity: jest.fn(), finishIcpDispatchActivity: jest.fn(),
  checkpointIcpMiningExecutionActivity: jest.fn(), getSiteActivity: jest.fn(), saveCronStatusActivity: jest.fn(),
  checkIcpMiningCreditsActivity: jest.fn(), warnIcpMiningCreditsActivity: jest.fn(),
  readSelectedIcpPeopleActivity: jest.fn(), finalizeSelectedIcpSliceActivity: jest.fn(),
  getSelectedIcpPersonActivity: jest.fn(), acknowledgeSelectedIcpPersonActivity: jest.fn(), getLeadActivity: jest.fn(),
  reconcileSelectedIcpPersonAckActivity: jest.fn(), settleIcpDispatchPreflightActivity: jest.fn(),
};
const mockExecuteChild = jest.fn();
const mockPatched = jest.fn();
const mockSourceAttemptLimits: number[] = [];
jest.mock('@temporalio/workflow', () => ({
  proxyActivities: (policy: any) => ({ ...mockActivities, getSelectedIcpPersonActivity: (...args: unknown[]) => {
    mockSourceAttemptLimits.push(policy.retry.maximumAttempts); return mockActivities.getSelectedIcpPersonActivity(...args);
  } }), executeChild: (...args: any[]) => mockExecuteChild(...args),
  workflowInfo: () => ({ runId: 'run-id', workflowId: 'slice-workflow' }),
  patched: (key: string) => mockPatched(key),
  CancellationScope: { nonCancellable: (fn: () => Promise<unknown>) => fn() },
}));
jest.mock('../src/temporal/workflows/idealClientProfilePageSearchWorkflow', () => ({ idealClientProfilePageSearchWorkflow: jest.fn() }));
import { icpDispatcherWorkflow } from '../src/temporal/workflows/icpDispatcherWorkflow';
import { icpMiningSliceWorkflow } from '../src/temporal/workflows/icpMiningSliceWorkflow';
import { processPageSafely } from '../src/temporal/workflows/icpMining/processPageSafely';
import { ActivityFailure, ApplicationFailure, CancelledFailure } from '@temporalio/common';

const reservation = { id: 'reservation', site_id: 'site', reserved_candidates: 2, reserved_matches: 1, research_enabled: false };
const icp = { id: 'list', role_query_id: 'role', current_page: 0, current_page_offset: 3,
  processed_targets: 3, found_matches: 1, checkpoint_version: 0, current_page_snapshot: { page: 0, candidates: [] } };
const result = { success: true, processed: 1, foundMatches: 1, total: 100, errors: [], pageCompleted: false, hasMore: true,
  checkpoint: { version: 2, processed: 4, found: 2, page: 0, offset: 4, snapshot: { page: 0, candidates: [] } } };

beforeEach(() => {
  jest.resetAllMocks();
  mockSourceAttemptLimits.length = 0;
  mockPatched.mockReturnValue(true);
  mockActivities.beginIcpDispatchActivity.mockResolvedValue({ reservation, icp });
  mockActivities.getSiteActivity.mockResolvedValue({ success: true, site: { user_id: 'user' } });
  mockActivities.checkpointIcpMiningExecutionActivity.mockResolvedValue({ success: true });
  mockActivities.finishIcpDispatchActivity.mockResolvedValue({ success: true });
  mockActivities.settleIcpDispatchPreflightActivity.mockResolvedValue({ next_eligible_at: '2026-10-03T08:00:00Z' });
  mockActivities.checkIcpMiningCreditsActivity.mockResolvedValue(true);
  mockActivities.readSelectedIcpPeopleActivity.mockResolvedValue({ selectedOnly: false, searchExhausted: false, pending: 0, members: [] });
  mockActivities.finalizeSelectedIcpSliceActivity.mockResolvedValue(undefined);
  mockExecuteChild.mockResolvedValue(result);
});

it('settles without starting a page when credits have run out', async () => {
  mockActivities.checkIcpMiningCreditsActivity.mockResolvedValue(false);
  expect(await icpMiningSliceWorkflow({ reservationId: 'reservation' })).toMatchObject({ success: false, processed: 0 });
  expect(mockExecuteChild).not.toHaveBeenCalled();
  expect(mockActivities.settleIcpDispatchPreflightActivity).toHaveBeenCalledWith({ id: 'reservation', runId: 'run-id',
    workflowId: 'slice-workflow', errors: ['ICP mining skipped: no credits available'], retryAfterSeconds: 21600 });
  expect(mockActivities.finishIcpDispatchActivity).not.toHaveBeenCalled();
  expect(mockActivities.saveCronStatusActivity).toHaveBeenLastCalledWith(expect.objectContaining({
    status: 'FAILED', nextRun: '2026-10-03T08:00:00Z' }));
  expect(mockActivities.warnIcpMiningCreditsActivity).not.toHaveBeenCalled();
});

it.each(['getSiteActivity', 'saveCronStatusActivity', 'checkIcpMiningCreditsActivity', 'readSelectedIcpPeopleActivity'] as const)(
  'cleans up a confirmed untouched reservation if %s fails before paid work', async activity => {
    mockActivities[activity].mockRejectedValueOnce(new Error('preflight denied'));
    await expect(icpMiningSliceWorkflow({ reservationId: 'reservation' })).rejects.toThrow('preflight denied');
    expect(mockExecuteChild).not.toHaveBeenCalled();
    expect(mockActivities.getSelectedIcpPersonActivity).not.toHaveBeenCalled();
    expect(mockActivities.settleIcpDispatchPreflightActivity).toHaveBeenCalledTimes(1);
    expect(mockActivities.settleIcpDispatchPreflightActivity).toHaveBeenCalledWith({ id: 'reservation', runId: 'run-id',
      workflowId: 'slice-workflow', errors: ['ICP dispatch preflight: preflight denied'], retryAfterSeconds: 300 });
    expect(mockActivities.finishIcpDispatchActivity).not.toHaveBeenCalled();
    expect(mockActivities.finalizeSelectedIcpSliceActivity).not.toHaveBeenCalled();
    expect(mockActivities.checkpointIcpMiningExecutionActivity).not.toHaveBeenCalled();
  },
);

it('also releases a pristine reservation for a site that is now unavailable', async () => {
  mockActivities.getSiteActivity.mockResolvedValue({ success: false });
  await expect(icpMiningSliceWorkflow({ reservationId: 'reservation' })).rejects.toThrow('site unavailable');
  expect(mockActivities.settleIcpDispatchPreflightActivity).toHaveBeenCalledTimes(1);
  expect(mockExecuteChild).not.toHaveBeenCalled();
});

it('never guesses ownership if begin was rejected or its ACK lost', async () => {
  mockActivities.beginIcpDispatchActivity.mockRejectedValue(new Error('begin unconfirmed'));
  await expect(icpMiningSliceWorkflow({ reservationId: 'reservation' })).rejects.toThrow('begin unconfirmed');
  expect(mockActivities.settleIcpDispatchPreflightActivity).not.toHaveBeenCalled();
  expect(mockActivities.finishIcpDispatchActivity).not.toHaveBeenCalled();
  expect(mockExecuteChild).not.toHaveBeenCalled();
});

it('never falls back to a stale checkpoint or finish on unconfirmed preflight settlement', async () => {
  mockActivities.checkIcpMiningCreditsActivity.mockResolvedValue(false);
  mockActivities.settleIcpDispatchPreflightActivity.mockRejectedValue(new Error('owner lost'));
  await expect(icpMiningSliceWorkflow({ reservationId: 'reservation' })).rejects.toThrow('owner lost');
  expect(mockActivities.settleIcpDispatchPreflightActivity).toHaveBeenCalledTimes(1);
  expect(mockActivities.finishIcpDispatchActivity).not.toHaveBeenCalled();
  expect(mockActivities.checkpointIcpMiningExecutionActivity).not.toHaveBeenCalled();
  expect(mockExecuteChild).not.toHaveBeenCalled();
});

it('retains the original no-credit finish command on histories without preflight settlement', async () => {
  mockPatched.mockImplementation(key => key !== 'icp-dispatch-preflight-settlement-v1');
  mockActivities.checkIcpMiningCreditsActivity.mockResolvedValue(false);
  expect(await icpMiningSliceWorkflow({ reservationId: 'reservation' })).toMatchObject({ success: false });
  expect(mockActivities.finishIcpDispatchActivity).toHaveBeenCalledTimes(1);
  expect(mockActivities.settleIcpDispatchPreflightActivity).not.toHaveBeenCalled();
});

it.each([0, 1])('selected-only slice never starts a provider search with %s pending members', async pending => {
  mockActivities.readSelectedIcpPeopleActivity.mockResolvedValue({ selectedOnly: true, searchExhausted: false, pending,
    members: pending ? [{ ordinal: '9007199254740993', person_id: '123', created_by: 'carlos' }] : [] });
  mockActivities.getSelectedIcpPersonActivity.mockResolvedValue({ person: { id: '123' } });
  mockExecuteChild.mockResolvedValue({ success: true, leadId: 'selected-lead', errors: [] });
  mockActivities.acknowledgeSelectedIcpPersonActivity.mockResolvedValue({ version: 1, processed: 4, found: 2 });
  await icpMiningSliceWorkflow({ reservationId: 'reservation' });
  expect(mockExecuteChild).toHaveBeenCalledTimes(pending);
  if (pending) expect(mockExecuteChild.mock.calls[0][1].args[0]).toMatchObject({ person_id: '123', userId: 'carlos' });
  expect(mockActivities.checkpointIcpMiningExecutionActivity).toHaveBeenCalledWith(expect.objectContaining({
    page: icp.current_page, offset: icp.current_page_offset, snapshot: icp.current_page_snapshot, total: undefined }));
  expect(mockActivities.finalizeSelectedIcpSliceActivity).toHaveBeenCalledWith(expect.objectContaining({ searchExhausted: false }));
});

it('warns the owner once after a credit failure in the page', async () => {
  mockExecuteChild.mockResolvedValue({ ...result, success: false, errors: ['Insufficient credits', 'No credits remaining'], retryableFailure: true });
  await icpMiningSliceWorkflow({ reservationId: 'reservation' });
  expect(mockActivities.warnIcpMiningCreditsActivity).toHaveBeenCalledTimes(1);
  expect(mockActivities.warnIcpMiningCreditsActivity).toHaveBeenCalledWith({ siteId: 'site', workflowId: 'slice-workflow' });
});

describe('selected ACK recovery in a reserved slice', () => {
  const ordinal = '9007199254740993';
  const expected = { id: 'list', site_id: 'site', run_id: 'run-id', ordinal, person_id: '00017',
    version: 1, processed: 4, found: 2, lead_id: 'lead', outcome: 'matched' };

  beforeEach(() => {
    mockActivities.readSelectedIcpPeopleActivity.mockResolvedValue({ selectedOnly: true, searchExhausted: false, pending: 1,
      members: [{ ordinal, person_id: '00017', created_by: 'creator' }] });
    mockActivities.getSelectedIcpPersonActivity.mockResolvedValue({ person: { id: '00017' } });
    mockActivities.acknowledgeSelectedIcpPersonActivity.mockRejectedValue(new Error('ACK timed out'));
    mockExecuteChild.mockResolvedValue({ success: true, leadId: 'lead', errors: [] });
  });

  it('reconciles an exhausted ACK from the recorded result and settles with the authoritative totals', async () => {
    mockActivities.reconcileSelectedIcpPersonAckActivity.mockResolvedValue({ version: 1, processed: 4, found: 2 });
    const slice = await icpMiningSliceWorkflow({ reservationId: 'reservation' });
    expect(slice).toMatchObject({ success: true, processed: 1, foundMatches: 1 });
    expect(mockActivities.acknowledgeSelectedIcpPersonActivity).toHaveBeenCalledWith(expected);
    expect(mockActivities.reconcileSelectedIcpPersonAckActivity).toHaveBeenCalledWith(expected);
    expect(mockExecuteChild).toHaveBeenCalledTimes(1);
    expect(mockActivities.getSelectedIcpPersonActivity).toHaveBeenCalledTimes(1);
    expect(mockSourceAttemptLimits).toEqual([1]);
    expect(mockActivities.checkpointIcpMiningExecutionActivity).toHaveBeenCalledWith(expect.objectContaining({
      version: 2, processed: 4, found: 2, page: 0, offset: 3, snapshot: icp.current_page_snapshot, status: 'pending' }));
    expect(mockActivities.finishIcpDispatchActivity).toHaveBeenCalledTimes(1);
    expect(mockActivities.settleIcpDispatchPreflightActivity).not.toHaveBeenCalled();
  });

  it.each(['conflict', 'wrong totals', 'later version', 'source timeout', 'unconfirmed paid child'])(
    'never releases or retries paid work for %s', async failure => {
      if (failure === 'wrong totals') {
        mockActivities.reconcileSelectedIcpPersonAckActivity.mockResolvedValue({ version: 1, processed: 4, found: 1 });
      } else if (failure === 'later version') {
        mockActivities.reconcileSelectedIcpPersonAckActivity.mockResolvedValue({ version: 2, processed: 4, found: 2 });
      } else if (failure === 'source timeout') {
        mockActivities.getSelectedIcpPersonActivity.mockRejectedValue(new Error('source timeout'));
      } else if (failure === 'unconfirmed paid child') {
        mockExecuteChild.mockRejectedValue(new Error('child timed out'));
      } else mockActivities.reconcileSelectedIcpPersonAckActivity.mockRejectedValue(new Error('receipt conflict'));
      await expect(icpMiningSliceWorkflow({ reservationId: 'reservation' })).rejects.toThrow();
      expect(mockExecuteChild).toHaveBeenCalledTimes(failure === 'source timeout' ? 0 : 1);
      expect(mockActivities.checkpointIcpMiningExecutionActivity).not.toHaveBeenCalled();
      expect(mockActivities.finalizeSelectedIcpSliceActivity).not.toHaveBeenCalled();
      expect(mockActivities.finishIcpDispatchActivity).not.toHaveBeenCalled();
      expect(mockActivities.settleIcpDispatchPreflightActivity).not.toHaveBeenCalled();
    },
  );

  it('releases a confirmed second license-check denial only when the provider was not called', async () => {
    const cause = ApplicationFailure.nonRetryable('Creator no longer licensed', 'SELECTED_SOURCE_NOT_STARTED');
    mockActivities.getSelectedIcpPersonActivity.mockRejectedValue(new ActivityFailure('Activity task failed',
      'getSelectedIcpPersonActivity', '7', 'NON_RETRYABLE_FAILURE', 'worker', cause));
    expect(await icpMiningSliceWorkflow({ reservationId: 'reservation' })).toMatchObject({ success: false, processed: 0 });
    expect(mockActivities.getSelectedIcpPersonActivity).toHaveBeenCalledWith({ id: 'list', site_id: 'site', run_id: 'run-id', ordinal,
      classifyPreflight: true });
    expect(mockSourceAttemptLimits).toEqual([1]);
    expect(mockExecuteChild).not.toHaveBeenCalled();
    expect(mockActivities.acknowledgeSelectedIcpPersonActivity).not.toHaveBeenCalled();
    expect(mockActivities.checkpointIcpMiningExecutionActivity).not.toHaveBeenCalled();
    expect(mockActivities.finishIcpDispatchActivity).not.toHaveBeenCalled();
    expect(mockActivities.settleIcpDispatchPreflightActivity).toHaveBeenCalledTimes(1);
  });

  it('never uses pristine preflight cleanup when a prior member already committed', async () => {
    mockActivities.readSelectedIcpPeopleActivity.mockResolvedValue({ selectedOnly: true, searchExhausted: false, pending: 2,
      members: [{ ordinal: '1', person_id: 'A', created_by: 'creator' }, { ordinal: '2', person_id: 'B', created_by: 'creator' }] });
    mockActivities.getSelectedIcpPersonActivity.mockResolvedValueOnce({ person: { id: 'A' } })
      .mockRejectedValueOnce(ApplicationFailure.nonRetryable('Creator revoked', 'SELECTED_SOURCE_NOT_STARTED'));
    mockExecuteChild.mockResolvedValue({ success: true, outcome: 'no_match', errors: [] });
    mockActivities.acknowledgeSelectedIcpPersonActivity.mockResolvedValue({ version: 1, processed: 4, found: 1 });
    expect(await icpMiningSliceWorkflow({ reservationId: 'reservation' })).toMatchObject({ success: false, processed: 1, foundMatches: 0 });
    expect(mockExecuteChild).toHaveBeenCalledTimes(1);
    expect(mockActivities.settleIcpDispatchPreflightActivity).not.toHaveBeenCalled();
    expect(mockActivities.checkpointIcpMiningExecutionActivity).toHaveBeenCalledWith(expect.objectContaining({
      version: 2, processed: 4, found: 1, status: 'pending' }));
    expect(mockActivities.finishIcpDispatchActivity).toHaveBeenCalledTimes(1);
  });

  it.each(['source-message-only', 'error from child', 'ACK denied', 'cancelled ACK'])('does not infer unpaid work or retry on %s', async mode => {
    const denial = ApplicationFailure.nonRetryable('SELECTED_SOURCE_NOT_STARTED', 'SELECTED_SOURCE_NOT_STARTED');
    if (mode === 'source-message-only') mockActivities.getSelectedIcpPersonActivity.mockRejectedValue(new Error(denial.message));
    else if (mode === 'error from child') mockExecuteChild.mockRejectedValue(denial);
    else mockActivities.acknowledgeSelectedIcpPersonActivity.mockRejectedValue(new ActivityFailure('Activity failed',
      'acknowledgeSelectedIcpPersonActivity', '8', 'NON_RETRYABLE_FAILURE', 'worker', mode === 'cancelled ACK'
        ? new CancelledFailure('cancelled') : ApplicationFailure.nonRetryable('owned elsewhere', 'ICP_RECEIPT_DENIED')));
    await expect(icpMiningSliceWorkflow({ reservationId: 'reservation' })).rejects.toThrow();
    expect(mockActivities.reconcileSelectedIcpPersonAckActivity).not.toHaveBeenCalled();
    expect(mockActivities.checkpointIcpMiningExecutionActivity).not.toHaveBeenCalled();
    expect(mockActivities.finishIcpDispatchActivity).not.toHaveBeenCalled();
    expect(mockActivities.settleIcpDispatchPreflightActivity).not.toHaveBeenCalled();
  });

  it('retains the historical member error path without the ACK recovery marker', async () => {
    mockPatched.mockImplementation(key => key !== 'icp-selected-member-ack-recovery-v1');
    expect(await icpMiningSliceWorkflow({ reservationId: 'reservation' })).toMatchObject({ success: false, processed: 0 });
    expect(mockActivities.acknowledgeSelectedIcpPersonActivity).toHaveBeenCalledWith({ id: 'list', site_id: 'site',
      run_id: 'run-id', ordinal, version: 1, lead_id: 'lead', outcome: 'matched' });
    expect(mockSourceAttemptLimits).toEqual([3]);
    expect(mockActivities.getSelectedIcpPersonActivity).toHaveBeenCalledWith({ id: 'list', site_id: 'site', run_id: 'run-id', ordinal });
    expect(mockActivities.reconcileSelectedIcpPersonAckActivity).not.toHaveBeenCalled();
    expect(mockActivities.finishIcpDispatchActivity).toHaveBeenCalledTimes(1);
  });
});

it('consumes a saved member despite legacy counters without consuming a stale search snapshot', async () => {
  const snapshot = { page: 12, candidates: [{ person: { id: 'not-a-member' } }], hasMore: true };
  mockActivities.beginIcpDispatchActivity.mockResolvedValue({ reservation, icp: { ...icp,
    total_targets: 129, processed_targets: 130, found_matches: 113, selected_processed_targets: 0,
    current_page: 12, current_page_offset: null, current_page_snapshot: snapshot } });
  mockActivities.readSelectedIcpPeopleActivity.mockResolvedValue({ selectedOnly: true, searchExhausted: false,
    pending: 129, members: Array.from({ length: 10 }, (_, i) => ({ ordinal: String(17+i), person_id: `selected-${17+i}`, created_by: 'creator' })) });
  mockActivities.getSelectedIcpPersonActivity.mockResolvedValue({ person: { id: 'selected-17' } });
  mockExecuteChild.mockResolvedValue({ success: true, leadId: 'lead-17', errors: [] });
  mockActivities.acknowledgeSelectedIcpPersonActivity.mockResolvedValue({ version: 1, processed: 131, found: 114 });
  expect(await icpMiningSliceWorkflow({ reservationId: 'reservation' })).toMatchObject({ success: true, processed: 1, foundMatches: 1 });
  expect(mockExecuteChild).toHaveBeenCalledTimes(1);
  expect(mockExecuteChild.mock.calls[0][1].args[0]).toMatchObject({ person_id: 'selected-17', userId: 'creator' });
  expect(mockActivities.acknowledgeSelectedIcpPersonActivity).toHaveBeenCalledWith(expect.objectContaining({
    id: 'list', site_id: 'site', run_id: 'run-id', ordinal: '17', lead_id: 'lead-17', outcome: 'matched' }));
  expect(mockActivities.checkpointIcpMiningExecutionActivity).toHaveBeenCalledWith(expect.objectContaining({
    page: 12, snapshot, status: 'pending', processed: 131, found: 114, total: undefined }));
  expect(mockActivities.finishIcpDispatchActivity).toHaveBeenCalledTimes(1);
});

it('does not warn for ordinary page failures', async () => {
  mockExecuteChild.mockResolvedValue({ ...result, success: false, errors: ['Provider unavailable'] });
  await icpMiningSliceWorkflow({ reservationId: 'reservation' });
  expect(mockActivities.warnIcpMiningCreditsActivity).not.toHaveBeenCalled();
});

it.each([false, true])('finalizes an exhausted mixed list without a new search (has pending membership: %s)', async pending => {
  mockActivities.beginIcpDispatchActivity.mockResolvedValue({ reservation, icp: { ...icp,
    total_targets: 10, processed_targets: 13, selected_processed_targets: 3, current_page: 1, current_page_offset: 0, current_page_snapshot: null } });
  mockActivities.readSelectedIcpPeopleActivity.mockResolvedValue({ selectedOnly: false, searchExhausted: false,
    pending: pending ? 1 : 0, members: pending ? [{ ordinal: '17', person_id: '17', created_by: 'creator' }] : [] });
  mockActivities.getSelectedIcpPersonActivity.mockResolvedValue({ person: { id: '17' } });
  mockExecuteChild.mockResolvedValue({ success: true, leadId: 'lead-17', errors: [] });
  mockActivities.acknowledgeSelectedIcpPersonActivity.mockResolvedValue({ version: 1, processed: 14, found: 2 });
  await icpMiningSliceWorkflow({ reservationId: 'reservation' });
  expect(mockExecuteChild).toHaveBeenCalledTimes(Number(pending));
  if (pending) expect(mockExecuteChild.mock.calls[0][1].args[0]).toMatchObject({ person_id: '17' });
  expect(mockActivities.finalizeSelectedIcpSliceActivity).toHaveBeenCalledWith(expect.objectContaining({ searchExhausted: true }));
});

it('warns once if the page throws a credit error, without releasing an uncertain reservation', async () => {
  mockExecuteChild.mockRejectedValue(new Error('Insufficient credits'));
  await expect(icpMiningSliceWorkflow({ reservationId: 'reservation' })).rejects.toThrow('Insufficient credits');
  expect(mockActivities.warnIcpMiningCreditsActivity).toHaveBeenCalledTimes(1);
  expect(mockActivities.finishIcpDispatchActivity).not.toHaveBeenCalled();
});

it('dispatches only admission under the stable coordinator workflow ID', async () => {
  mockActivities.dispatchIcpMiningActivity.mockResolvedValue({ started: 3 });
  expect(await icpDispatcherWorkflow()).toEqual({ started: 3 });
  expect(mockActivities.dispatchIcpMiningActivity).toHaveBeenCalledWith({ dispatchId: 'slice-workflow' });
  expect(mockExecuteChild).not.toHaveBeenCalled();
});

it('executes exactly one reserved page and settles only after its final checkpoint', async () => {
  expect(await icpMiningSliceWorkflow({ reservationId: 'reservation' })).toMatchObject({ processed: 1, foundMatches: 1 });
  expect(mockActivities.beginIcpDispatchActivity).toHaveBeenCalledWith({ id: 'reservation', runId: 'run-id', workflowId: 'slice-workflow' });
  expect(mockExecuteChild).toHaveBeenCalledTimes(1);
  expect(mockExecuteChild.mock.calls[0][1]).toMatchObject({ workflowId: 'icp-slice-page-reservation', args: [{
    site_id: 'site', max_matches: 1, max_candidates: 2, page_size: 10, start_index: 3, research_enabled: false,
  }] });
  expect(mockActivities.checkpointIcpMiningExecutionActivity).toHaveBeenCalledWith(expect.objectContaining({
    version: 3, processed: 4, found: 2, page: 0, offset: 4, status: 'pending',
  }));
  expect(mockActivities.finishIcpDispatchActivity).toHaveBeenCalledWith({ id: 'reservation', runId: 'run-id', errors: [], retryAfterSeconds: 300 });
  expect(mockActivities.checkpointIcpMiningExecutionActivity.mock.invocationCallOrder[0])
    .toBeLessThan(mockActivities.finishIcpDispatchActivity.mock.invocationCallOrder[0]);
});

it('backs off insufficient-credit errors without pretending the page completed', async () => {
  mockExecuteChild.mockResolvedValue({ ...result, success: false, errors: ['HTTP 402 INSUFFICIENT_CREDITS'] });
  expect(await icpMiningSliceWorkflow({ reservationId: 'reservation' })).toMatchObject({ success: false });
  expect(mockActivities.finishIcpDispatchActivity).toHaveBeenCalledWith(expect.objectContaining({ retryAfterSeconds: 21600 }));
  expect(mockActivities.saveCronStatusActivity).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'FAILED' }));
});

it('settles organization review diagnostics without a retry cooldown', async () => {
  mockExecuteChild.mockResolvedValue({ ...result, success: false, errors: ['Ambiguous organization identity: UNITEC'] });
  await icpMiningSliceWorkflow({ reservationId: 'reservation' });
  expect(mockActivities.finishIcpDispatchActivity).toHaveBeenCalledWith(expect.objectContaining({ retryAfterSeconds: 0 }));
});

it('publishes the database cooldown after exponential backoff instead of an optimistic five-minute time', async () => {
  mockActivities.finishIcpDispatchActivity.mockResolvedValue({ success: true, next_eligible_at: '2026-10-03T08:00:00Z' });
  await icpMiningSliceWorkflow({ reservationId: 'reservation' });
  expect(mockActivities.saveCronStatusActivity).toHaveBeenLastCalledWith(expect.objectContaining({ nextRun: '2026-10-03T08:00:00Z' }));
});

it.each(['child', 'checkpoint'])('never releases a reservation after an unconfirmed %s failure', async stage => {
  if (stage === 'child') mockExecuteChild.mockRejectedValue(new Error('child crashed'));
  else mockActivities.checkpointIcpMiningExecutionActivity.mockRejectedValue(new Error('checkpoint failed'));
  await expect(icpMiningSliceWorkflow({ reservationId: 'reservation' })).rejects.toThrow();
  expect(mockActivities.finishIcpDispatchActivity).not.toHaveBeenCalled();
  expect(mockActivities.settleIcpDispatchPreflightActivity).not.toHaveBeenCalled();
});

it('limits candidates independently from matches and preserves the remaining page snapshot', async () => {
  const snapshot = { page: 0, candidates: Array.from({ length: 10 }, (_, id) => ({ person: { id: id + 1 } })), hasMore: true };
  const deps: any = { getSegmentIdFromRoleQueryActivity: jest.fn().mockResolvedValue({ success: true }),
    enrich: jest.fn().mockResolvedValue({ success: true, outcome: 'no_match', errors: [] }),
    checkpointIcpMiningExecutionActivity: jest.fn().mockResolvedValue({ success: true }) };
  const page = await processPageSafely({ site_id: 'site', userId: 'user', role_query_id: 'role', icp_mining_id: 'list',
    page: 0, page_size: 10, snapshot, max_candidates: 2, max_matches: 1,
    execution: { run_id: 'run', version: 0, processed: 0, found: 0 } }, deps);
  expect(page).toMatchObject({ processed: 2, foundMatches: 0, pageCompleted: false,
    checkpoint: { processed: 2, offset: 2, snapshot } });
  expect(deps.enrich).toHaveBeenCalledTimes(2);
});

it('continues past a durably deferred candidate without counting it as a match', async () => {
  const snapshot = { page: 0, candidates: [{ person: { id: 1 } }, { person: { id: 2 } }], hasMore: false };
  const deps: any = { getSegmentIdFromRoleQueryActivity: jest.fn().mockResolvedValue({ success: true }),
    enrich: jest.fn().mockResolvedValueOnce({ success: true, outcome: 'needs_review', personId: 'person', errors: [],
      identityReviews: [{ id: 'site:31', site_id: 'site', selected: true, status: 'pending',
        error: 'Ambiguous organization identity: Acme' }] })
      .mockResolvedValueOnce({ success: true, outcome: 'matched', leadId: 'lead', errors: [] }),
    checkpointIcpMiningExecutionActivity: jest.fn().mockResolvedValue({ success: true }) };
  const page = await processPageSafely({ site_id: 'site', userId: 'user', role_query_id: 'role', icp_mining_id: 'list',
    page: 0, page_size: 10, snapshot, max_candidates: 2, max_matches: 2,
    execution: { run_id: 'run', version: 0, processed: 0, found: 0 } }, deps);
  expect(page).toMatchObject({ processed: 2, foundMatches: 1, pageCompleted: true, retryableFailure: false,
    errors: ['Ambiguous organization identity: Acme'], checkpoint: { processed: 2, found: 1, page: 1, offset: 0 } });
  expect(deps.enrich).toHaveBeenCalledTimes(2);
});

it('does not advance an unpersisted or cross-site review outcome', async () => {
  for (const identityReviews of [undefined, [{ id: 'other:31', site_id: 'other', selected: true, status: 'pending' }]]) {
    const deps: any = { getSegmentIdFromRoleQueryActivity: jest.fn().mockResolvedValue({ success: true }),
      enrich: jest.fn().mockResolvedValue({ success: true, outcome: 'needs_review', personId: 'person', errors: [], identityReviews }),
      checkpointIcpMiningExecutionActivity: jest.fn() };
    const page = await processPageSafely({ site_id: 'site', userId: 'user', role_query_id: 'role', icp_mining_id: 'list',
      page: 0, page_size: 10, snapshot: { page: 0, candidates: [{ person: { id: 1 } }], hasMore: false },
      execution: { run_id: 'run', version: 0, processed: 0, found: 0 } }, deps);
    expect(page).toMatchObject({ processed: 0, foundMatches: 0, retryableFailure: true, checkpoint: { offset: 0 } });
    expect(deps.checkpointIcpMiningExecutionActivity).not.toHaveBeenCalled();
  }
});

it('stops the owned page at the first credit error instead of trying the next lead', async () => {
  const snapshot = { page: 0, candidates: [{ person: { id: 1 } }, { person: { id: 2 } }], hasMore: true };
  const deps: any = { getSegmentIdFromRoleQueryActivity: jest.fn().mockResolvedValue({ success: true }),
    enrich: jest.fn().mockResolvedValue({ success: false, errors: ['Insufficient credits'] }),
    checkpointIcpMiningExecutionActivity: jest.fn() };
  const page = await processPageSafely({ site_id: 'site', userId: 'user', role_query_id: 'role', icp_mining_id: 'list',
    page: 0, page_size: 10, snapshot, stop_on_credit_failure: true,
    execution: { run_id: 'run', version: 0, processed: 0, found: 0 } }, deps);
  expect(page).toMatchObject({ processed: 0, retryableFailure: true, checkpoint: { offset: 0 }, errors: ['Insufficient credits'] });
  expect(deps.enrich).toHaveBeenCalledTimes(1);
  expect(deps.checkpointIcpMiningExecutionActivity).not.toHaveBeenCalled();
});