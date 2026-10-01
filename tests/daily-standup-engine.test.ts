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
const standupPatch = 'daily-standup-configuration-v1';
const miningPatch = 'icp-mining-distributed-scheduling-v1';
const outreachPatch = 'configured-outreach-scheduling-v1';
const configuredOutreachCommands = ['scheduleIndividualDailyProspectionActivity', 'scheduleLeadQualificationActivity'];
const patchedNowCommands = nowCommands.slice(0, -2);
const patchedLaterCommands = laterCommands.filter(name => name !== 'scheduleLeadQualificationActivity');

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
    mockExecuteChild.mockImplementation(async () => ({ monitored: true }));
    // These standup/ICP cases model histories that predate configured outreach.
    mockPatched.mockImplementation(id => id === standupPatch || id === miningPatch);
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
    mockPatched.mockImplementation(id => id === standupPatch);
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

  describe('configured outreach scheduling', () => {
    beforeEach(() => mockPatched.mockReturnValue(true));

    const independentSchedulers = [
      ['scheduleIcpMiningWorkflowsActivity', 'icpMiningScheduling'],
      ['scheduleIndividualDailyStandUpsActivity', 'dailyStandUpScheduling'],
      ['scheduleIndividualDailyProspectionActivity', 'configuredDailyProspectionScheduling'],
      ['scheduleLeadQualificationActivity', 'leadQualificationScheduling'],
    ] as const;
    const patchedCommands = (decision: TimingDecision) => [
      ...initialCommands, 'scheduleIcpMiningWorkflowsActivity', 'scheduleIndividualDailyStandUpsActivity',
      ...configuredOutreachCommands,
      ...(decision === 'skip' ? [] : decision === 'execute_now' ? patchedNowCommands : patchedLaterCommands),
    ];

    it.each<TimingDecision>(['skip', 'execute_now', 'schedule_for_later'])(
      'schedules configured cold and all followups once before the %s branch, without open sites', async decision => {
        const businessHours = analysis(decision);
        mockActivities.evaluateBusinessHoursForDay.mockResolvedValue(businessHours);
        const configuredSummary = { ...summary, scheduled: 3, results: [{ workflowId: 'configured-cold' }] };
        mockActivities.scheduleIndividualDailyProspectionActivity.mockImplementation(async (_analysis, options) =>
          options.timingFilter === 'configured' ? configuredSummary : summary);

        const result = await activityPrioritizationEngineWorkflow();

        expect(result).toMatchObject({
          shouldExecute: decision !== 'skip', timingDecision: decision, operationsExecuted: decision === 'execute_now',
          operationsResult: {
            configuredDailyProspectionScheduling: configuredSummary, leadQualificationScheduling: summary,
            dailyStandUpScheduling: summary, icpMiningScheduling: summary,
          },
        });
        expect(mockPatched.mock.calls).toEqual([[standupPatch], [miningPatch], [outreachPatch]]);
        expect(commandSequence()).toEqual(patchedCommands(decision));
        expect(mockActivities.scheduleIndividualDailyProspectionActivity.mock.calls).toEqual([
          [businessHours, { hoursThreshold: 48, maxLeads: 100, parentScheduleId: 'parent-schedule', timingFilter: 'configured' }],
          ...(decision === 'schedule_for_later' ? [[businessHours, {
            timezone: 'America/Mexico_City', hoursThreshold: 48, maxLeads: 100,
            parentScheduleId: 'parent-schedule', activitiesMap: {}, timingFilter: 'legacy',
          }]] : []),
        ]);
        expect(mockActivities.scheduleLeadQualificationActivity.mock.calls).toEqual([[businessHours, {
          daysWithoutReply: 7, maxLeads: 100, parentScheduleId: 'parent-schedule',
        }]]);
        if (decision === 'execute_now') {
          expect(mockActivities.executeDailyProspectionWorkflowsActivity.mock.calls).toEqual([[{
            dryRun: false, testMode: false, businessHoursAnalysis: businessHours,
            hoursThreshold: 48, maxLeads: 100, parentScheduleId: 'parent-schedule', activitiesMap: {}, timingFilter: 'legacy',
          }]]);
          expect(result.operationsResult.dailyProspectionExecution).toEqual(summary);
        } else {
          expect(mockActivities.executeDailyProspectionWorkflowsActivity).not.toHaveBeenCalled();
        }
        if (decision === 'schedule_for_later') {
          expect(result.operationsResult.dailyProspectionScheduling).toEqual(summary);
        }
        if (decision === 'skip') {
          expect(mockExecuteChild).not.toHaveBeenCalled();
          expect(mockActivities.fetchActivitiesMapActivity).not.toHaveBeenCalled();
          expect(mockActivities.scheduleIndividualSiteAnalysisActivity).not.toHaveBeenCalled();
          expect(mockActivities.scheduleIndividualLeadGenerationActivity).not.toHaveBeenCalled();
        }
      },
    );

    describe.each<TimingDecision>(['skip', 'execute_now', 'schedule_for_later'])('%s failure isolation', decision => {
      it.each(independentSchedulers)('isolates %s failure and never retries it in the branch', async (activity, resultKey) => {
        mockActivities.evaluateBusinessHoursForDay.mockResolvedValue(analysis(decision));
        mockActivities[activity].mockRejectedValueOnce(new Error(`${activity} unavailable`));

        const result = await activityPrioritizationEngineWorkflow();

        expect(commandSequence()).toEqual(patchedCommands(decision));
        expect(result.operationsExecuted).toBe(decision === 'execute_now');
        for (const [scheduler, key] of independentSchedulers) {
          expect(result.operationsResult[key]).toEqual(key === resultKey
            ? { scheduled: 0, skipped: 0, failed: 1, results: [], errors: [`${activity} unavailable`] }
            : summary);
          if (scheduler === 'scheduleIndividualDailyProspectionActivity') {
            expect(mockActivities[scheduler].mock.calls.filter(([, options]) => options.timingFilter === 'configured')).toHaveLength(1);
          } else {
            expect(mockActivities[scheduler]).toHaveBeenCalledTimes(1);
          }
        }
        if (decision === 'schedule_for_later') expect(result.operationsResult.dailyProspectionScheduling).toEqual(summary);
        if (decision === 'execute_now') expect(result.operationsResult.dailyProspectionExecution).toEqual(summary);
      });
    });

    it('retains every independent outcome when the monitoring child fails', async () => {
      mockActivities.evaluateBusinessHoursForDay.mockResolvedValue(analysis('execute_now'));
      mockExecuteChild.mockRejectedValue(new Error('Monitor failed'));
      const result = await activityPrioritizationEngineWorkflow();
      expect(result).toMatchObject({ operationsExecuted: false, operationsResult: { error: 'Monitor failed' } });
      for (const [, key] of independentSchedulers) expect(result.operationsResult[key]).toEqual(summary);
      expect(commandSequence()).toEqual([
        ...initialCommands, 'scheduleIcpMiningWorkflowsActivity', 'scheduleIndividualDailyStandUpsActivity',
        ...configuredOutreachCommands, 'executeChild',
      ]);
    });

    it.each<TimingDecision>(['execute_now', 'schedule_for_later'])(
      'does not couple independent schedulers to failing branch map fetches: %s', async decision => {
        mockActivities.evaluateBusinessHoursForDay.mockResolvedValue(analysis(decision));
        mockActivities.fetchActivitiesMapActivity.mockRejectedValue(new Error('Activity map unavailable'));
        const result = await activityPrioritizationEngineWorkflow();
        for (const [, key] of independentSchedulers) expect(result.operationsResult[key]).toEqual(summary);
        expect(mockActivities.scheduleIndividualDailyProspectionActivity).toHaveBeenCalledTimes(1);
        expect(mockActivities.scheduleLeadQualificationActivity).toHaveBeenCalledTimes(1);
      },
    );

    it('records independent non-Error failures without losing the remaining scheduling', async () => {
      mockActivities.scheduleIndividualDailyProspectionActivity.mockRejectedValue('Cold unavailable');
      mockActivities.scheduleLeadQualificationActivity.mockRejectedValue('Followup unavailable');
      expect(await activityPrioritizationEngineWorkflow()).toMatchObject({ operationsResult: {
        configuredDailyProspectionScheduling: { scheduled: 0, failed: 1, errors: ['Cold unavailable'] },
        leadQualificationScheduling: { scheduled: 0, failed: 1, errors: ['Followup unavailable'] },
        dailyStandUpScheduling: summary, icpMiningScheduling: summary,
      } });
    });
  });

  describe.each([
    ['no older markers', []],
    ['standup marker only', [standupPatch]],
    ['mining marker only', [miningPatch]],
    ['both older markers', [standupPatch, miningPatch]],
  ] as const)('pre-outreach histories with %s', (_label, markers) => {
    beforeEach(() => mockPatched.mockImplementation(id => (markers as readonly string[]).includes(id)));

    it.each([
      ['2026-09-28', 'skip'], ['2026-09-28', 'execute_now'], ['2026-09-28', 'schedule_for_later'],
      ['2026-09-29', 'schedule_for_later'],
    ] as const)('preserves commands and outreach arguments on %s / %s', async (date, decision) => {
      jest.setSystemTime(new Date(`${date}T12:00:00Z`));
      const businessHours = analysis(decision);
      mockActivities.evaluateBusinessHoursForDay.mockResolvedValue(businessHours);
      const result = await activityPrioritizationEngineWorkflow();
      const configuredStandup = (markers as readonly string[]).includes(standupPatch);
      const distributedMining = (markers as readonly string[]).includes(miningPatch);
      const legacyStandup = !configuredStandup && decision === 'schedule_for_later' && date === '2026-09-28';
      expect(commandSequence()).toEqual([
        ...initialCommands,
        ...(distributedMining ? ['scheduleIcpMiningWorkflowsActivity'] : []),
        ...(configuredStandup || legacyStandup ? ['scheduleIndividualDailyStandUpsActivity'] : []),
        ...(decision === 'skip' ? [] : decision === 'execute_now' ? nowCommands : laterCommands),
      ]);
      expect(result.operationsResult || {}).not.toHaveProperty('configuredDailyProspectionScheduling');
      if (decision === 'skip') {
        expect(result.operationsResult || {}).not.toHaveProperty('leadQualificationScheduling');
        expect(mockActivities.scheduleLeadQualificationActivity).not.toHaveBeenCalled();
      } else {
        const options = { timezone: 'America/Mexico_City', parentScheduleId: 'parent-schedule' };
        expect(mockActivities.scheduleLeadQualificationActivity.mock.calls).toEqual([[businessHours, {
          ...options, daysWithoutReply: 7, maxLeads: 100,
          ...(decision === 'execute_now' ? { activitiesMap: {} } : {}),
        }]]);
        if (decision === 'execute_now') {
          expect(mockActivities.executeDailyProspectionWorkflowsActivity.mock.calls).toEqual([[{
            dryRun: false, testMode: false, businessHoursAnalysis: businessHours,
            hoursThreshold: 48, maxLeads: 100, parentScheduleId: 'parent-schedule', activitiesMap: {},
          }]]);
        } else {
          expect(mockActivities.scheduleIndividualDailyProspectionActivity.mock.calls).toEqual([[businessHours, {
            ...options, hoursThreshold: 48, maxLeads: 100, activitiesMap: {},
          }]]);
        }
      }
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