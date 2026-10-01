const mockPatched = jest.fn();
const mockWorkflowInfo = jest.fn();
const mockExecuteChild = jest.fn();
const mockSleep = jest.fn();
const mockSingle = jest.fn();
const mockNonCancellable = jest.fn();
const mockActivities = {
  logWorkflowExecutionActivity: jest.fn(), saveCronStatusActivity: jest.fn(),
  getIcpMiningConfigurationActivity: jest.fn(), getPendingIcpMiningActivity: jest.fn(),
  getIcpMiningByIdActivity: jest.fn(), getSiteActivity: jest.fn(),
  claimIcpMiningExecutionActivity: jest.fn(), checkpointIcpMiningExecutionActivity: jest.fn(),
};
jest.mock('../src/lib/supabase/client', () => ({ supabaseServiceRole: {
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mockSingle }) }) }),
} }));
jest.mock('@temporalio/workflow', () => ({
  ...jest.requireActual('@temporalio/workflow'),
  proxyActivities: () => mockActivities, patched: mockPatched,
  workflowInfo: mockWorkflowInfo, executeChild: mockExecuteChild, sleep: mockSleep,
  CancellationScope: { nonCancellable: mockNonCancellable },
}));
import { CancelledFailure } from '@temporalio/workflow';
import { getIcpMiningConfigurationActivity } from '../src/temporal/activities/icpMiningConfigurationActivity';
import { idealClientProfileMiningWorkflow } from '../src/temporal/workflows/idealClientProfileMiningWorkflow';
import { delayedExecutionWorkflow } from '../src/temporal/workflows/delayedExecutionWorkflow';

const selectedId = 'abcdef12-3456-7890-abcd-ef1234567890';
const row = { id: selectedId, site_id: 'site', role_query_id: 'role', status: 'pending',
  total_targets: 1188, processed_targets: 0, found_matches: 0,
  current_page: 0, current_page_offset: 0, checkpoint_version: 0 };
const options = { site_id: 'site', userId: 'user' };
const settings = (controls = {}) => ({ data: { activities: { icp_lead_generation: {
  target_leads: 3, research_enabled: false, all_lists: false, list_ids: [selectedId], ...controls,
} } }, error: null });

describe('ICP execution-time settings and terminal status', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockPatched.mockReturnValue(true);
    mockWorkflowInfo.mockReturnValue({ workflowId: 'actual-mining-run', runId: 'run',
      parent: { workflowId: 'icp-timer' } });
    mockNonCancellable.mockImplementation(fn => fn());
    mockSingle.mockResolvedValue(settings());
    mockActivities.getIcpMiningConfigurationActivity.mockImplementation(getIcpMiningConfigurationActivity);
    mockActivities.getPendingIcpMiningActivity.mockResolvedValue({ success: true, items: [] });
    mockActivities.claimIcpMiningExecutionActivity.mockResolvedValue({ acquired: true, icp: row });
    mockActivities.checkpointIcpMiningExecutionActivity.mockResolvedValue({ success: true });
    mockExecuteChild.mockResolvedValue({ success: true, processed: 3, foundMatches: 3, errors: [],
      hasMore: true, pageCompleted: false, checkpoint: { processed: 3, found: 3, version: 4,
        page: 0, offset: 3, snapshot: null } });
  });
  afterEach(() => jest.restoreAllMocks());

  it('reads changed controls after an already-scheduled timer wakes, ignoring stale overrides', async () => {
    mockSingle.mockResolvedValue(settings({ target_leads: 150, research_enabled: true, all_lists: true }));
    mockActivities.getPendingIcpMiningActivity.mockResolvedValue({ success: true, items: [row] });
    mockSleep.mockImplementation(async () => {
      expect(mockSingle).not.toHaveBeenCalled();
      mockSingle.mockResolvedValue(settings());
    });
    mockExecuteChild.mockImplementation(async (workflow, { args }) => {
      if (workflow === 'idealClientProfileMiningWorkflow') return idealClientProfileMiningWorkflow(args[0]);
      return { success: true, processed: 3, foundMatches: 3, errors: [], hasMore: true, pageCompleted: false,
        checkpoint: { processed: 3, found: 3, version: 4, page: 0, offset: 3, snapshot: null } };
    });
    const result = await delayedExecutionWorkflow({ delayMs: 3600000,
      targetWorkflow: 'idealClientProfileMiningWorkflow',
      targetArgs: [{ ...options, targetLeadsWithEmail: 150, researchEnabled: true }],
    });
    expect(result.targetResult).toMatchObject({ success: true, processed: 3, foundMatches: 3 });
    expect(mockSingle).toHaveBeenCalledTimes(1);
    expect(mockActivities.getIcpMiningConfigurationActivity).toHaveBeenCalledWith({
      site_id: 'site', targetLeadsWithEmail: undefined, researchEnabled: undefined,
    });
    expect(mockActivities.getPendingIcpMiningActivity).toHaveBeenCalledWith({
      site_id: 'site', limit: 50, icp_mining_ids: [selectedId],
    });
    expect(mockExecuteChild.mock.calls[1][1].args[0]).toMatchObject({
      max_matches: 3, research_enabled: false, icp_mining_id: selectedId,
    });
  });

  it('retains intentional direct manual overrides, including research=false', async () => {
    mockWorkflowInfo.mockReturnValue({ workflowId: 'manual-run', runId: 'run' });
    mockSingle.mockResolvedValue(settings({ target_leads: 150, research_enabled: true }));
    await idealClientProfileMiningWorkflow({ ...options, targetLeadsWithEmail: 7, researchEnabled: false });
    expect(mockActivities.getIcpMiningConfigurationActivity).toHaveBeenCalledWith({
      site_id: 'site', targetLeadsWithEmail: 7, researchEnabled: false,
    });
    expect(mockActivities.saveCronStatusActivity).toHaveBeenLastCalledWith(expect.objectContaining({
      scheduleId: 'manual-execution', workflowId: 'manual-run', status: 'COMPLETED',
    }));
  });

  it('saves RUNNING and COMPLETED with actual workflow and timer IDs, even when no lists are pending', async () => {
    expect(await idealClientProfileMiningWorkflow(options)).toMatchObject({ success: true, processed: 0 });
    expect(mockActivities.saveCronStatusActivity.mock.calls.map(([update]) => update.status))
      .toEqual(['RUNNING', 'COMPLETED']);
    for (const [update] of mockActivities.saveCronStatusActivity.mock.calls) {
      expect(update).toMatchObject({ workflowId: 'actual-mining-run', scheduleId: 'icp-timer', siteId: 'site' });
    }
    expect(mockActivities.saveCronStatusActivity).toHaveBeenLastCalledWith(expect.objectContaining({ errorMessage: null }));
    expect(mockActivities.saveCronStatusActivity.mock.invocationCallOrder[0])
      .toBeLessThan(mockActivities.getIcpMiningConfigurationActivity.mock.invocationCallOrder[0]);
  });

  it.each([
    { info: {}, args: { scheduleId: 'explicit-timer' }, expected: 'explicit-timer' },
    { info: { searchAttributes: { TemporalScheduledById: ['native-schedule'] } }, args: {}, expected: 'native-schedule' },
    { info: { memo: { scheduleId: 'memo-schedule' } }, args: {}, expected: 'memo-schedule' },
    { info: {}, args: { additionalData: { parentScheduleId: 'central' } }, expected: 'central' },
    { info: {}, args: { additionalData: { scheduledBy: 'activityPrioritizationEngine-icpMining' } }, expected: 'actual-mining-run' },
  ])('recognizes scheduled invocations and normalizes schedule metadata: $expected', async ({ info, args, expected }) => {
    mockWorkflowInfo.mockReturnValue({ workflowId: 'actual-mining-run', runId: 'run', ...info });
    await idealClientProfileMiningWorkflow({ ...options, ...args, targetLeadsWithEmail: 999, researchEnabled: true });
    expect(mockActivities.getIcpMiningConfigurationActivity).toHaveBeenCalledWith({
      site_id: 'site', targetLeadsWithEmail: undefined, researchEnabled: undefined,
    });
    expect(mockActivities.saveCronStatusActivity).toHaveBeenLastCalledWith(expect.objectContaining({ scheduleId: expected }));
  });

  it('records returned database failures instead of leaving RUNNING', async () => {
    mockActivities.getPendingIcpMiningActivity.mockResolvedValue({ success: false, error: 'pending lists unavailable' });
    expect(await idealClientProfileMiningWorkflow(options)).toMatchObject({ success: false });
    expect(mockActivities.saveCronStatusActivity).toHaveBeenLastCalledWith(expect.objectContaining({
      status: 'FAILED', errorMessage: 'pending lists unavailable',
    }));
  });

  it('records early list-selection rejections without claiming or searching', async () => {
    mockSingle.mockResolvedValue(settings({ list_ids: [] }));
    expect(await idealClientProfileMiningWorkflow({ ...options, icp_mining_id: selectedId })).toMatchObject({ success: false });
    expect(mockActivities.saveCronStatusActivity).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'FAILED' }));
    expect(mockActivities.claimIcpMiningExecutionActivity).not.toHaveBeenCalled();
    expect(mockExecuteChild).not.toHaveBeenCalled();
  });

  it('records settings-read errors before any lists or paid children are requested', async () => {
    mockSingle.mockResolvedValue({ data: null, error: { message: 'database unavailable' } });
    await expect(idealClientProfileMiningWorkflow(options)).rejects.toThrow('ICP settings unavailable');
    expect(mockActivities.saveCronStatusActivity).toHaveBeenLastCalledWith(expect.objectContaining({
      status: 'FAILED', errorMessage: 'ICP settings unavailable: database unavailable',
    }));
    expect(mockActivities.getPendingIcpMiningActivity).not.toHaveBeenCalled();
    expect(mockExecuteChild).not.toHaveBeenCalled();
  });

  it.each(['getPendingIcpMiningActivity', 'claimIcpMiningExecutionActivity', 'checkpointIcpMiningExecutionActivity'] as const)
  ('persists thrown %s failures and propagates the original error', async activity => {
    const error = new Error('activity unavailable');
    mockActivities.getPendingIcpMiningActivity.mockResolvedValue({ success: true, items: [row] });
    mockActivities[activity].mockRejectedValue(error);
    await expect(idealClientProfileMiningWorkflow(options)).rejects.toBe(error);
    expect(mockActivities.saveCronStatusActivity).toHaveBeenLastCalledWith(expect.objectContaining({
      status: 'FAILED', errorMessage: 'activity unavailable',
    }));
  });

  it('bounds failure payloads while including the underlying Temporal cause', async () => {
    const error = Object.assign(new Error('Activity task failed'), { cause: new Error('grpc message larger than max: ' + 'x'.repeat(9000000)) });
    mockActivities.getPendingIcpMiningActivity.mockRejectedValue(error);
    await expect(idealClientProfileMiningWorkflow(options)).rejects.toBe(error);
    const { errorMessage } = mockActivities.saveCronStatusActivity.mock.calls[1][0];
    expect(errorMessage).toContain('grpc message larger than max');
    expect(errorMessage.length).toBeLessThanOrEqual(2000);
  });

  it('does not hide the original failure if saving the failure status also fails', async () => {
    const original = new Error('pending lists unavailable');
    mockActivities.getPendingIcpMiningActivity.mockRejectedValue(original);
    mockActivities.saveCronStatusActivity.mockResolvedValueOnce(undefined).mockRejectedValue(new Error('status database unavailable'));
    await expect(idealClientProfileMiningWorkflow(options)).rejects.toBe(original);
    expect(console.error).toHaveBeenCalled();
  });

  it('records cancellation in a non-cancellable scope and rethrows it', async () => {
    const error = new CancelledFailure('cancelled by operator');
    mockActivities.getPendingIcpMiningActivity.mockRejectedValue(error);
    await expect(idealClientProfileMiningWorkflow(options)).rejects.toBe(error);
    expect(mockNonCancellable).toHaveBeenCalledTimes(1);
    expect(mockActivities.saveCronStatusActivity).toHaveBeenLastCalledWith(expect.objectContaining({
      status: 'FAILED', errorMessage: 'cancelled by operator',
    }));
  });

  it('preserves the old command sequence and overrides when the patch is absent', async () => {
    mockPatched.mockImplementation(key => key !== 'icp-mining-runtime-settings-status-v1');
    await idealClientProfileMiningWorkflow({ ...options, targetLeadsWithEmail: 7 });
    expect(mockActivities.getIcpMiningConfigurationActivity).toHaveBeenCalledWith({
      site_id: 'site', targetLeadsWithEmail: 7, researchEnabled: undefined,
    });
    expect(mockActivities.saveCronStatusActivity).toHaveBeenCalledTimes(1);
    expect(mockActivities.saveCronStatusActivity).toHaveBeenCalledWith(expect.objectContaining({
      workflowId: 'icp-mining-batch', scheduleId: 'icp-mining-batch', status: 'RUNNING',
    }));
    expect(mockActivities.getIcpMiningConfigurationActivity.mock.invocationCallOrder[0])
      .toBeLessThan(mockActivities.saveCronStatusActivity.mock.invocationCallOrder[0]);
  });
});