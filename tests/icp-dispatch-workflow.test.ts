const mockActivities = {
  dispatchIcpMiningActivity: jest.fn(), beginIcpDispatchActivity: jest.fn(), finishIcpDispatchActivity: jest.fn(),
  checkpointIcpMiningExecutionActivity: jest.fn(), getSiteActivity: jest.fn(), saveCronStatusActivity: jest.fn(),
};
const mockExecuteChild = jest.fn();
jest.mock('@temporalio/workflow', () => ({
  proxyActivities: () => mockActivities, executeChild: (...args: any[]) => mockExecuteChild(...args),
  workflowInfo: () => ({ runId: 'run-id', workflowId: 'slice-workflow' }),
}));
jest.mock('../src/temporal/workflows/idealClientProfilePageSearchWorkflow', () => ({ idealClientProfilePageSearchWorkflow: jest.fn() }));
import { icpDispatcherWorkflow } from '../src/temporal/workflows/icpDispatcherWorkflow';
import { icpMiningSliceWorkflow } from '../src/temporal/workflows/icpMiningSliceWorkflow';
import { processPageSafely } from '../src/temporal/workflows/icpMining/processPageSafely';

const reservation = { id: 'reservation', site_id: 'site', reserved_candidates: 2, reserved_matches: 1, research_enabled: false };
const icp = { id: 'list', role_query_id: 'role', current_page: 0, current_page_offset: 3,
  processed_targets: 3, found_matches: 1, checkpoint_version: 0, current_page_snapshot: { page: 0, candidates: [] } };
const result = { success: true, processed: 1, foundMatches: 1, total: 100, errors: [], pageCompleted: false, hasMore: true,
  checkpoint: { version: 2, processed: 4, found: 2, page: 0, offset: 4, snapshot: { page: 0, candidates: [] } } };

beforeEach(() => {
  jest.resetAllMocks();
  mockActivities.beginIcpDispatchActivity.mockResolvedValue({ reservation, icp });
  mockActivities.getSiteActivity.mockResolvedValue({ success: true, site: { user_id: 'user' } });
  mockActivities.checkpointIcpMiningExecutionActivity.mockResolvedValue({ success: true });
  mockActivities.finishIcpDispatchActivity.mockResolvedValue({ success: true });
  mockExecuteChild.mockResolvedValue(result);
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