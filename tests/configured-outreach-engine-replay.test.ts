import path from 'node:path';
import { defaultPayloadConverter } from '@temporalio/common';
import { temporal } from '@temporalio/proto';
import { bundleWorkflowCode, DefaultLogger, Runtime, Worker } from '@temporalio/worker';

// Offline Temporal Core replay only: synthetic histories, no server or activity execution.
const workflowType = 'activityPrioritizationEngineWorkflow';
const standupPatch = 'daily-standup-configuration-v1';
const miningPatch = 'icp-mining-distributed-scheduling-v1';
const outreachPatch = 'configured-outreach-scheduling-v1';
const parentScheduleId = 'parent-schedule';
const summary = { scheduled: 1, skipped: 0, failed: 0, results: [], errors: [] };
const payloads = (...values: unknown[]) => ({ payloads: values.map(value => defaultPayloadConverter.toPayload(value)) });
type TimingDecision = 'skip' | 'execute_now' | 'schedule_for_later';

class EngineHistory {
  private events: Record<string, unknown>[] = [];
  private completedTaskId = 0;
  private activitySequence = 0;
  readonly time: number;

  constructor(date: string) {
    this.time = Date.parse(`${date}T12:00:00Z`);
    const runId = '11111111-1111-4111-8111-111111111111';
    this.event('WorkflowExecutionStarted', {
      workflowType: { name: workflowType }, taskQueue: { name: 'replay' }, input: payloads(),
      memo: { fields: { scheduleId: defaultPayloadConverter.toPayload(parentScheduleId) } },
      workflowTaskTimeout: { seconds: 10 }, originalExecutionRunId: runId, firstExecutionRunId: runId, attempt: 1,
    });
    this.task();
  }

  private event(type: string, attributes: Record<string, unknown>) {
    this.events.push({
      eventId: this.events.length + 1, eventTime: { seconds: this.time / 1000, nanos: 0 },
      eventType: `EVENT_TYPE_${type.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase()}`,
      [`${type[0].toLowerCase()}${type.slice(1)}EventAttributes`]: attributes,
    });
    return this.events.length;
  }

  private task() {
    const scheduledEventId = this.event('WorkflowTaskScheduled', {
      taskQueue: { name: 'replay' }, startToCloseTimeout: { seconds: 10 }, attempt: 1,
    });
    const startedEventId = this.event('WorkflowTaskStarted', { scheduledEventId, identity: 'replay', requestId: 'task' });
    this.completedTaskId = this.event('WorkflowTaskCompleted', { scheduledEventId, startedEventId, identity: 'replay' });
  }

  patch(id: string) {
    this.event('MarkerRecorded', {
      markerName: 'core_patch', details: { 'patch-data': payloads({ id, deprecated: false }) },
      workflowTaskCompletedEventId: this.completedTaskId,
    });
  }

  activity(name: string, args: unknown[], result: unknown) {
    const scheduledEventId = this.event('ActivityTaskScheduled', {
      activityId: String(++this.activitySequence), activityType: { name }, taskQueue: { name: 'replay' },
      input: payloads(...args), startToCloseTimeout: { seconds: 600 },
      workflowTaskCompletedEventId: this.completedTaskId,
      retryPolicy: { initialInterval: { seconds: 1 }, backoffCoefficient: 2, maximumInterval: { seconds: 100 } },
    });
    const startedEventId = this.event('ActivityTaskStarted', { scheduledEventId, identity: 'replay', requestId: 'activity', attempt: 1 });
    this.event('ActivityTaskCompleted', { scheduledEventId, startedEventId, identity: 'replay', result: payloads(result) });
    this.task();
  }

  child(businessHoursAnalysis: unknown) {
    const childType = { name: 'dailyOperationsWorkflow' };
    const workflowExecution = { workflowId: `daily-operations-${this.time}`, runId: '22222222-2222-4222-8222-222222222222' };
    const initiatedEventId = this.event('StartChildWorkflowExecutionInitiated', {
      namespace: 'default', workflowId: workflowExecution.workflowId, workflowType: childType,
      taskQueue: { name: 'replay' }, input: payloads({ businessHoursAnalysis }),
      parentClosePolicy: 'PARENT_CLOSE_POLICY_TERMINATE', workflowTaskCompletedEventId: this.completedTaskId,
    });
    const startedEventId = this.event('ChildWorkflowExecutionStarted', {
      namespace: 'default', initiatedEventId, workflowExecution, workflowType: childType,
    });
    this.event('ChildWorkflowExecutionCompleted', {
      namespace: 'default', initiatedEventId, startedEventId, workflowExecution,
      workflowType: childType, result: payloads({ monitored: true }),
    });
    this.task();
  }

  complete(result: unknown) {
    this.event('WorkflowExecutionCompleted', { workflowTaskCompletedEventId: this.completedTaskId, result: payloads(result) });
    return temporal.api.history.v1.History.fromObject({ events: this.events });
  }
}

function engineHistory(decision: TimingDecision, markers: readonly string[], date = '2026-09-28', injectUnmarkedOutreach = false) {
  const history = new EngineHistory(date);
  const dayOfWeek = new Date(history.time).getUTCDay();
  const businessHours = {
    shouldExecuteOperations: decision !== 'skip', shouldExecuteNow: decision === 'execute_now',
    shouldScheduleForLater: decision === 'schedule_for_later', reason: decision,
    sitesWithBusinessHours: 0, sitesOpenToday: 0, openSites: [], nextExecutionTime: '09:00',
  };
  const configuredStandups = markers.includes(standupPatch);
  const distributedMining = markers.includes(miningPatch);
  const configuredOutreach = markers.includes(outreachPatch);
  history.activity('validateAndCleanStuckCronStatusActivity', [workflowType, 'global', 24], { canProceed: true });
  history.activity('evaluateBusinessHoursForDay', [dayOfWeek], businessHours);
  if (configuredStandups) history.patch(standupPatch);
  if (distributedMining) {
    history.patch(miningPatch);
    history.activity('scheduleIcpMiningWorkflowsActivity', [{ parentScheduleId }], summary);
  }
  if (configuredStandups) history.activity('scheduleIndividualDailyStandUpsActivity', [businessHours, { parentScheduleId }], summary);
  if (configuredOutreach) history.patch(outreachPatch);
  if (configuredOutreach || injectUnmarkedOutreach) {
    history.activity('scheduleIndividualDailyProspectionActivity', [businessHours, {
      hoursThreshold: 48, maxLeads: 100, parentScheduleId, timingFilter: 'configured',
    }], summary);
    history.activity('scheduleLeadQualificationActivity', [businessHours, { daysWithoutReply: 7, maxLeads: 100, parentScheduleId }], summary);
  }

  let operationsResult: Record<string, unknown> | undefined;
  const commonOptions = { timezone: 'America/Mexico_City', parentScheduleId };
  const coldFilter = configuredOutreach ? { timingFilter: 'legacy' } : {};
  if (decision === 'execute_now') {
    history.child(businessHours);
    operationsResult = { monitored: true, dailyProspectionExecution: summary };
    history.activity('fetchActivitiesMapActivity', [[]], {});
    history.activity('executeDailyProspectionWorkflowsActivity', [{
      dryRun: false, testMode: false, businessHoursAnalysis: businessHours,
      hoursThreshold: 48, maxLeads: 100, parentScheduleId, activitiesMap: {}, ...coldFilter,
    }], summary);
  } else if (decision === 'schedule_for_later') {
    if (configuredStandups) {
      operationsResult = { scheduled: true, individualSchedules: 1, failedSchedules: 0, approach: 'configured-daily-standup-schedules' };
    } else if (dayOfWeek === 1 || dayOfWeek === 5) {
      history.activity('scheduleIndividualDailyStandUpsActivity', [businessHours, commonOptions], summary);
      operationsResult = {
        scheduled: true, scheduledTime: '09:00', individualSchedules: 1, failedSchedules: 0, scheduleDetails: [],
        message: 'Individual schedules created: 1 sites will execute at their specific business hours', approach: 'individual-site-schedules',
      };
    } else {
      const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dayOfWeek];
      operationsResult = {
        scheduled: false, scheduledTime: '09:00', individualSchedules: 0, failedSchedules: 0,
        message: `Daily standups skipped - only execute on Monday and Friday (today is ${dayName})`,
        approach: 'individual-site-schedules', standupsSkipped: true, skipReason: 'Day restriction: standups only on Monday and Friday',
      };
    }
    history.activity('fetchActivitiesMapActivity', [[]], {});
    history.activity('scheduleIndividualDailyProspectionActivity', [businessHours, {
      ...commonOptions, hoursThreshold: 48, maxLeads: 100, activitiesMap: {}, ...coldFilter,
    }], summary);
    operationsResult.dailyProspectionScheduling = summary;
    if (!configuredOutreach) {
      history.activity('scheduleLeadQualificationActivity', [businessHours, { ...commonOptions, daysWithoutReply: 7, maxLeads: 100 }], summary);
      operationsResult.leadQualificationScheduling = summary;
    }
  }
  if (operationsResult) {
    for (const [name, resultKey] of [
      ['scheduleIndividualSiteAnalysisActivity', 'siteAnalysisScheduling'],
      ['scheduleIndividualLeadGenerationActivity', 'leadGenerationScheduling'],
    ]) {
      history.activity('fetchActivitiesMapActivity', [[]], {});
      history.activity(name, [businessHours, { ...commonOptions, activitiesMap: {} }], summary);
      operationsResult[resultKey] = summary;
    }
    if (decision === 'execute_now' && !configuredOutreach) {
      history.activity('fetchActivitiesMapActivity', [[]], {});
      history.activity('scheduleLeadQualificationActivity', [businessHours, {
        ...commonOptions, daysWithoutReply: 7, maxLeads: 100, activitiesMap: {},
      }], summary);
      operationsResult.leadQualificationScheduling = summary;
    }
  }
  if (configuredStandups) operationsResult = { ...operationsResult, dailyStandUpScheduling: summary };
  if (distributedMining) operationsResult = { ...operationsResult, icpMiningScheduling: summary };
  if (configuredOutreach) operationsResult = {
    ...operationsResult, configuredDailyProspectionScheduling: summary, leadQualificationScheduling: summary,
  };
  return history.complete({
    shouldExecute: decision !== 'skip', reason: decision, operationsExecuted: decision === 'execute_now',
    operationsResult, executionTime: '0ms', businessHoursAnalysis: businessHours, timingDecision: decision,
    ...(decision === 'schedule_for_later' ? { scheduledForTime: '09:00' } : {}),
  });
}

describe('configured outreach engine Temporal replay', () => {
  let workflowBundle: Awaited<ReturnType<typeof bundleWorkflowCode>>;
  beforeAll(async () => {
    Runtime.install({ logger: new DefaultLogger('ERROR') });
    workflowBundle = await bundleWorkflowCode({
      workflowsPath: path.resolve(__dirname, '../src/temporal/workflows/activityPrioritizationEngineWorkflow.ts'),
      logger: new DefaultLogger('ERROR'),
    });
  });
  afterAll(async () => { await Runtime.instance().shutdown(); });

  describe.each([
    ['no markers', []], ['standup only', [standupPatch]], ['mining only', [miningPatch]],
    ['both old markers', [standupPatch, miningPatch]], ['all markers', [standupPatch, miningPatch, outreachPatch]],
  ] as const)('%s', (_label, markers) => {
    it.each<TimingDecision>(['skip', 'execute_now', 'schedule_for_later'])('replays the completed %s history', async decision => {
      await Worker.runReplayHistory({ workflowBundle }, engineHistory(decision, markers), 'engine-replay');
    });
    it('replays later scheduling on a non-legacy-standup day', async () => {
      await Worker.runReplayHistory({ workflowBundle }, engineHistory('schedule_for_later', markers, '2026-09-29'), 'engine-replay');
    });
  });

  it('detects outreach commands incorrectly added without the new marker', async () => {
    const results = [];
    for await (const result of Worker.runReplayHistories({ workflowBundle }, [{
      history: engineHistory('skip', [standupPatch, miningPatch], '2026-09-28', true), workflowId: 'engine-replay',
    }])) results.push(result);
    expect(results).toHaveLength(1);
    expect(results[0].error).toMatchObject({ name: 'DeterminismViolationError' });
  });
});