const mockActivities: Record<string, jest.Mock> = {};
const mockPatched = jest.fn();
const mockExecuteChild = jest.fn();
jest.mock('@temporalio/workflow', () => ({
  proxyActivities: () => new Proxy({}, { get: (_target, name: string) => {
    if (!mockActivities[name]) mockActivities[name] = jest.fn();
    return mockActivities[name];
  } }),
  patched: (id: string) => mockPatched(id),
  executeChild: (...args: any[]) => mockExecuteChild(...args),
  workflowInfo: () => ({ workflowId: 'prioritization-engine', memo: { scheduleId: 'parent-schedule' } }),
}));

import { activityPrioritizationEngineWorkflow } from '../src/temporal/workflows/activityPrioritizationEngineWorkflow';

type TimingDecision = 'skip' | 'execute_now' | 'schedule_for_later';
const analysis = (decision: TimingDecision) => ({
  shouldExecuteOperations: decision !== 'skip', shouldExecuteNow: decision === 'execute_now',
  shouldScheduleForLater: decision === 'schedule_for_later', reason: decision,
  sitesWithBusinessHours: 0, sitesOpenToday: 0, openSites: [], nextExecutionTime: '09:00',
});
const summary = { scheduled: 2, skipped: 1, failed: 0, results: [], errors: [] };
const commandSequence = () => Object.entries({ ...mockActivities, executeChild: mockExecuteChild })
  .flatMap(([name, mock]) => mock.mock.invocationCallOrder.map(order => ({ order, name })))
  .sort((a, b) => a.order - b.order).map(command => command.name);
const laterCommands = [
  'fetchActivitiesMapActivity', 'scheduleIndividualDailyProspectionActivity',
  'scheduleLeadQualificationActivity', 'fetchActivitiesMapActivity', 'scheduleIndividualSiteAnalysisActivity',
  'fetchActivitiesMapActivity', 'scheduleIndividualLeadGenerationActivity',
];
const nowCommands = [
  'executeChild', 'fetchActivitiesMapActivity', 'executeDailyProspectionWorkflowsActivity',
  'fetchActivitiesMapActivity', 'scheduleIndividualSiteAnalysisActivity',
  'fetchActivitiesMapActivity', 'scheduleIndividualLeadGenerationActivity',
  'fetchActivitiesMapActivity', 'scheduleLeadQualificationActivity',
];
const initialCommands = ['validateAndCleanStuckCronStatusActivity', 'evaluateBusinessHoursForDay'];

describe('configured Daily Standup engine scheduling', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-09-29T12:00:00Z'));
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    for (const activity of Object.values(mockActivities)) activity.mockResolvedValue(summary);
    mockActivities.validateAndCleanStuckCronStatusActivity.mockResolvedValue({ canProceed: true });
    mockActivities.evaluateBusinessHoursForDay.mockResolvedValue(analysis('skip'));
    mockActivities.fetchActivitiesMapActivity.mockResolvedValue({});
    mockExecuteChild.mockResolvedValue({ monitored: true });
    mockPatched.mockReturnValue(true);
  });
  afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

  it.each<TimingDecision>(['skip', 'execute_now', 'schedule_for_later'])(
    'schedules exactly once on Tuesday despite decision %s and no open sites', async decision => {
      const businessHours = analysis(decision);
      mockActivities.evaluateBusinessHoursForDay.mockResolvedValue(businessHours);
      const result = await activityPrioritizationEngineWorkflow();
      expect(result).toMatchObject({
        timingDecision: decision, operationsExecuted: decision === 'execute_now',
        operationsResult: { dailyStandUpScheduling: summary, icpMiningScheduling: summary },
      });
      expect(mockActivities.scheduleIndividualDailyStandUpsActivity).toHaveBeenCalledTimes(1);
      expect(mockActivities.scheduleIndividualDailyStandUpsActivity).toHaveBeenCalledWith(businessHours, {
        parentScheduleId: 'parent-schedule',
      });
      expect(mockPatched).toHaveBeenCalledWith('daily-standup-configuration-v1');
      expect(mockPatched).toHaveBeenCalledWith('icp-mining-distributed-scheduling-v1');
      expect(mockActivities.scheduleIcpMiningWorkflowsActivity).toHaveBeenCalledTimes(1);
      expect(mockActivities.scheduleIcpMiningWorkflowsActivity).toHaveBeenCalledWith({ parentScheduleId: 'parent-schedule' });
      const remainingCommands = decision === 'skip' ? [] : decision === 'execute_now' ? nowCommands : laterCommands;
      expect(commandSequence()).toEqual([
        ...initialCommands, 'scheduleIcpMiningWorkflowsActivity', 'scheduleIndividualDailyStandUpsActivity', ...remainingCommands,
      ]);
    },
  );

  it('does not schedule again in the legacy Monday/Friday branch', async () => {
    jest.setSystemTime(new Date('2026-09-28T12:00:00Z'));
    mockActivities.evaluateBusinessHoursForDay.mockResolvedValue(analysis('schedule_for_later'));
    const result = await activityPrioritizationEngineWorkflow();
    expect(mockActivities.scheduleIndividualDailyStandUpsActivity).toHaveBeenCalledTimes(1);
    expect(result.operationsResult).toMatchObject({ individualSchedules: 2, dailyStandUpScheduling: summary });
  });

  it('honors selected weekend scheduling without broadening other operations', async () => {
    jest.setSystemTime(new Date('2026-10-03T12:00:00Z'));
    const result = await activityPrioritizationEngineWorkflow();
    expect(result).toMatchObject({ shouldExecute: false, timingDecision: 'skip', operationsExecuted: false });
    expect(mockActivities.scheduleIndividualDailyStandUpsActivity).toHaveBeenCalledTimes(1);
    expect(mockExecuteChild).not.toHaveBeenCalled();
    expect(mockActivities.scheduleIndividualDailyProspectionActivity).not.toHaveBeenCalled();
    expect(mockActivities.scheduleIcpMiningWorkflowsActivity).toHaveBeenCalledTimes(1);
  });

  it('isolates ICP scheduler failures from other scheduled work', async () => {
    mockActivities.scheduleIcpMiningWorkflowsActivity.mockRejectedValue(new Error('Sites unavailable'));
    expect(await activityPrioritizationEngineWorkflow()).toMatchObject({ operationsResult: {
      icpMiningScheduling: { scheduled: 0, failed: 1, errors: ['Sites unavailable'] },
      dailyStandUpScheduling: summary,
    } });
  });

  it('does not add ICP commands to histories that already have configured standups but predate distributed mining', async () => {
    mockPatched.mockImplementation(id => id !== 'icp-mining-distributed-scheduling-v1');
    await activityPrioritizationEngineWorkflow();
    expect(commandSequence()).toEqual([...initialCommands, 'scheduleIndividualDailyStandUpsActivity']);
    expect(mockActivities.scheduleIcpMiningWorkflowsActivity).not.toHaveBeenCalled();
  });

  it('keeps the invocation concurrency guard ahead of all scheduling', async () => {
    mockActivities.validateAndCleanStuckCronStatusActivity.mockResolvedValue({ canProceed: false, reason: 'Already running' });
    expect(await activityPrioritizationEngineWorkflow()).toMatchObject({ timingDecision: 'skip', reason: 'Already running' });
    expect(commandSequence()).toEqual(['validateAndCleanStuckCronStatusActivity']);
    expect(mockPatched).not.toHaveBeenCalled();
  });

  it('reports scheduler errors without blocking unrelated operations or retrying in the timing branch', async () => {
    mockActivities.evaluateBusinessHoursForDay.mockResolvedValue(analysis('schedule_for_later'));
    mockActivities.scheduleIndividualDailyStandUpsActivity.mockRejectedValue(new Error('Settings unavailable'));
    const result = await activityPrioritizationEngineWorkflow();
    expect(result.operationsResult).toMatchObject({
      dailyStandUpScheduling: { scheduled: 0, failed: 1, errors: ['Settings unavailable'] },
      dailyProspectionScheduling: summary,
    });
    expect(mockActivities.scheduleIndividualDailyStandUpsActivity).toHaveBeenCalledTimes(1);
  });

  it('retains standup results when the monitoring child fails', async () => {
    mockActivities.evaluateBusinessHoursForDay.mockResolvedValue(analysis('execute_now'));
    mockExecuteChild.mockRejectedValue(new Error('Monitor failed'));
    expect(await activityPrioritizationEngineWorkflow()).toMatchObject({
      operationsExecuted: false, operationsResult: { error: 'Monitor failed', dailyStandUpScheduling: summary },
    });
  });

  describe('pre-patch histories', () => {
    beforeEach(() => mockPatched.mockReturnValue(false));

    it.each([
      ['Monday later', '2026-09-28', 'schedule_for_later', true],
      ['Friday later', '2026-10-02', 'schedule_for_later', true],
      ['Tuesday later', '2026-09-29', 'schedule_for_later', false],
      ['Saturday skip', '2026-10-03', 'skip', false],
      ['Monday now', '2026-09-28', 'execute_now', false],
    ] as const)('preserves the complete historical command sequence: %s', async (_label, date, decision, expectedStandup) => {
      jest.setSystemTime(new Date(`${date}T12:00:00Z`));
      const businessHours = analysis(decision);
      mockActivities.evaluateBusinessHoursForDay.mockResolvedValue(businessHours);
      const result = await activityPrioritizationEngineWorkflow();
      const remainingCommands = decision === 'skip' ? [] : decision === 'execute_now' ? nowCommands : laterCommands;
      expect(commandSequence()).toEqual([
        ...initialCommands,
        ...(expectedStandup ? ['scheduleIndividualDailyStandUpsActivity'] : []),
        ...remainingCommands,
      ]);
      expect(result.operationsResult || {}).not.toHaveProperty('dailyStandUpScheduling');
      if (expectedStandup) {
        expect(mockActivities.scheduleIndividualDailyStandUpsActivity).toHaveBeenCalledWith(businessHours, {
          timezone: 'America/Mexico_City', parentScheduleId: 'parent-schedule',
        });
        expect(result.operationsResult).toMatchObject({ approach: 'individual-site-schedules', individualSchedules: 2 });
      }
    });
  });
});