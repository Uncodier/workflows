const mockStart = jest.fn();
const mockFetchSites = jest.fn();
const mockFetchSettings = jest.fn();
const mockSaveCron = jest.fn();
jest.mock('../src/temporal/client', () => ({ getTemporalClient: async () => ({ workflow: { start: mockStart } }) }));
jest.mock('../src/config/config', () => ({ temporalConfig: { taskQueue: 'test' } }));
jest.mock('../src/temporal/services', () => ({}));
jest.mock('../src/temporal/activities/cronActivities', () => ({ saveCronStatusActivity: mockSaveCron }));
jest.mock('../src/temporal/activities/icpMiningScheduledStatusActivity', () => ({ saveIcpMiningScheduledStatusActivity: mockSaveCron }));
jest.mock('../src/temporal/activities/supabaseActivities', () => ({}));
jest.mock('../src/temporal/activities/outreachConfigurationActivity', () => ({ getOutreachConfigurationActivity: jest.fn() }));
jest.mock('../src/temporal/services/supabaseService', () => ({ getSupabaseService: () => ({
  fetchSites: mockFetchSites, fetchCompleteSettings: mockFetchSettings,
}) }));
import { scheduleIndividualLeadGenerationActivity } from '../src/temporal/activities/workflowSchedulingActivities';
import { scheduleIcpMiningWorkflowsActivity } from '../src/temporal/activities/icpMiningSchedulingActivity';
import { nextDistributedIcpRun } from '../src/temporal/utils/icpMiningScheduling';
import { DAILY_WORKFLOW_REUSE_POLICY } from '../src/temporal/utils/workflowIdHelper';

describe('always-on ICP scheduling', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-09-29T15:00:00Z'));
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    mockFetchSites.mockResolvedValue([{ id: 'site', user_id: 'user', name: 'Test' }]);
    mockFetchSettings.mockResolvedValue([{ site_id: 'site', activities: {
      icp_lead_generation: { status: 'inactive', target_leads: 25, research_enabled: true },
      local_lead_generation: { status: 'inactive' }, leads_follow_up: { status: 'inactive' },
      leads_initial_cold_outreach: { status: 'inactive' }, daily_resume_and_stand_up: { status: 'inactive' },
    } }]);
    mockStart.mockResolvedValue({ workflowId: 'scheduled' });
  });
  afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });
  it('schedules mining with no channels while every outreach/generation toggle is off', async () => {
    const result = await scheduleIcpMiningWorkflowsActivity();
    expect(result.failed).toBe(0);
    expect(result.scheduled).toBe(2);
    expect(mockStart).toHaveBeenCalledTimes(2);
    expect(mockStart.mock.calls[0][1].args[0]).toMatchObject({
      targetWorkflow: 'idealClientProfileMiningWorkflow', targetArgs: [{ site_id: 'site', userId: 'user' }],
    });
    // Controls are loaded at execution, not snapshotted when the timer is created.
    const timer = mockStart.mock.calls[0][1];
    const miningArgs = timer.args[0].targetArgs[0];
    for (const key of ['targetLeadsWithEmail', 'researchEnabled', 'icp_mining_id', 'allLists', 'listIds']) {
      expect(miningArgs).not.toHaveProperty(key);
    }
    expect(miningArgs.scheduleId).toBe(timer.workflowId);
    expect(mockSaveCron).toHaveBeenCalledTimes(1);
    expect(mockSaveCron).toHaveBeenCalledWith(expect.objectContaining({ siteId: 'site', scheduleId: timer.workflowId }));
  });

  it('runs on weekends without business hours and without reading outreach settings', async () => {
    jest.setSystemTime(new Date('2026-10-04T12:00:00Z'));
    mockFetchSettings.mockRejectedValue(new Error('Unrelated settings unavailable'));
    expect(await scheduleIcpMiningWorkflowsActivity()).toMatchObject({ scheduled: 2, failed: 0 });
    expect(mockFetchSettings).not.toHaveBeenCalled();
    const options = mockStart.mock.calls[0][1];
    const target = nextDistributedIcpRun('site', new Date());
    expect(options).toMatchObject({ workflowIdReusePolicy: DAILY_WORKFLOW_REUSE_POLICY, workflowRunTimeout: '48h' });
    expect(options.args[0].delayMs).toBe(target.getTime() - Date.now());
    expect(options.args[0].targetArgs[0].additionalData).toMatchObject({
      scheduleType: 'icp-mining-distributed', executionDay: target.toISOString().slice(0, 10),
      targetTimeUTC: target.toISOString(), timezone: 'UTC',
    });
    expect(options.workflowId).toBe(`icp-mining-timer-site-${target.toISOString().slice(0, 10)}`);
    expect(mockSaveCron).toHaveBeenCalledWith(expect.objectContaining({ nextRun: target.toISOString() }));
  });

  it('does not schedule ICP a second time through the local lead-generation scheduler', async () => {
    await scheduleIndividualLeadGenerationActivity({ openSites: [] });
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('spreads sites throughout the day instead of accumulating at a common opening time', async () => {
    const sites = Array.from({ length: 200 }, (_, n) => ({ id: `site-${n}`, user_id: 'user' }));
    mockFetchSites.mockResolvedValue(sites);
    const result = await scheduleIcpMiningWorkflowsActivity({ parentScheduleId: 'parent' });
    expect(result).toMatchObject({ scheduled: 400, failed: 0 });
    const targets = mockStart.mock.calls.map(([, options]) => options.args[0].targetArgs[0].additionalData);
    expect(new Set(targets.map(data => new Date(data.targetTimeUTC).getUTCHours())).size).toBe(24);
    expect(new Set(targets.map(data => data.targetTimeUTC)).size).toBeGreaterThan(190);
    expect(targets.every(data => data.parentScheduleId === 'parent')).toBe(true);
  });

  it.each(['WorkflowExecutionAlreadyStartedError', 'Error'])('handles duplicates (%s) without overwriting execution status', async name => {
    mockStart.mockRejectedValue(Object.assign(new Error('Workflow execution already started'), { name }));
    expect(await scheduleIcpMiningWorkflowsActivity()).toMatchObject({ scheduled: 0, skipped: 2, failed: 0 });
    expect(mockSaveCron).not.toHaveBeenCalled();
  });

  it('keeps other sites schedulable if one start fails', async () => {
    mockFetchSites.mockResolvedValue([{ id: 'site-1' }, { id: 'site-2' }]);
    mockStart.mockRejectedValueOnce(new Error('Temporal unavailable'));
    expect(await scheduleIcpMiningWorkflowsActivity()).toMatchObject({ scheduled: 3, failed: 1,
      errors: ['Site site-1: Temporal unavailable'] });
  });

  it('reports a site read failure without dispatching work', async () => {
    mockFetchSites.mockRejectedValue(new Error('Sites unavailable'));
    expect(await scheduleIcpMiningWorkflowsActivity()).toMatchObject({ scheduled: 0, failed: 1, errors: ['Sites unavailable'] });
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('does no work without sites', async () => {
    mockFetchSites.mockResolvedValue([]);
    expect(await scheduleIcpMiningWorkflowsActivity()).toMatchObject({ scheduled: 0, failed: 0 });
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('covers daily scheduler jitter without skipping a mining day or publishing the later timer', async () => {
    // This site has a stable 00:00:10 UTC slot; daily engine jitter straddles it.
    mockFetchSites.mockResolvedValue([{ id: 'site-68684', user_id: 'user' }]);
    const timers = new Set<string>();
    mockStart.mockImplementation(async (_workflow, options) => {
      if (timers.has(options.workflowId)) throw Object.assign(new Error('duplicate'), { name: 'WorkflowExecutionAlreadyStartedError' });
      timers.add(options.workflowId);
      return { workflowId: options.workflowId };
    });
    jest.setSystemTime(new Date('2026-09-29T00:00:20Z'));
    expect(await scheduleIcpMiningWorkflowsActivity()).toMatchObject({ scheduled: 2, skipped: 0 });
    expect(mockSaveCron).toHaveBeenCalledTimes(1);
    expect(mockSaveCron).toHaveBeenCalledWith(expect.objectContaining({ nextRun: '2026-09-30T00:00:10.000Z' }));
    const secondDelay = mockStart.mock.calls[1][1].args[0].delayMs;
    expect(secondDelay).toBeGreaterThan(24 * 3600000);
    expect(mockStart.mock.calls[1][1].workflowRunTimeout).toBe('50h');
    mockSaveCron.mockClear();
    jest.setSystemTime(new Date('2026-09-30T00:00:05Z'));
    expect(await scheduleIcpMiningWorkflowsActivity()).toMatchObject({ scheduled: 0, skipped: 2 });
    expect(mockSaveCron).not.toHaveBeenCalled();
    jest.setSystemTime(new Date('2026-10-01T00:00:20Z'));
    await scheduleIcpMiningWorkflowsActivity();
    for (const day of ['2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03']) {
      expect(timers.has(`icp-mining-timer-site-68684-${day}`)).toBe(true);
    }
  });

  it('continues to create coverage after an earliest-slot duplicate without replacing its status', async () => {
    mockStart.mockRejectedValueOnce(Object.assign(new Error('duplicate'), { name: 'WorkflowExecutionAlreadyStartedError' }));
    expect(await scheduleIcpMiningWorkflowsActivity()).toMatchObject({ scheduled: 1, skipped: 1 });
    expect(mockSaveCron).not.toHaveBeenCalled();
  });
});

describe('distributed daily ICP slots', () => {
  it('keeps a stable next slot within 24h independently of input ordering or retries', () => {
    const now = new Date('2026-09-30T23:59:59Z');
    const target = nextDistributedIcpRun('site', now);
    expect(target.getTime()).toBeGreaterThanOrEqual(now.getTime());
    expect(target.getTime()).toBeLessThan(now.getTime() + 86400000);
    expect(nextDistributedIcpRun('site', new Date(now.getTime() + 1000))).toEqual(target);
    expect(nextDistributedIcpRun('site', target)).toEqual(target);
    expect(nextDistributedIcpRun('site', new Date(target.getTime() + 1)).getTime()).toBe(target.getTime() + 86400000);
  });

  it('validates scheduler input', () => {
    expect(() => nextDistributedIcpRun('', new Date())).toThrow('Invalid ICP scheduling input');
    expect(() => nextDistributedIcpRun('site', new Date('invalid'))).toThrow('Invalid ICP scheduling input');
  });
});