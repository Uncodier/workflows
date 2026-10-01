import path from 'node:path';
import { defaultPayloadConverter } from '@temporalio/common';
import { temporal } from '@temporalio/proto';
import { bundleWorkflowCode, DefaultLogger, Runtime, Worker } from '@temporalio/worker';

// Offline replay through Temporal Core: no server, database or activity execution.
const workflowType = 'idealClientProfileMiningWorkflow';
const runtimePatch = 'icp-mining-runtime-settings-status-v1';
const input = { site_id: 'site', userId: 'user', scheduleId: 'timer' };
const payloads = (...values: unknown[]) => ({ payloads: values.map(value => defaultPayloadConverter.toPayload(value)) });

class MiningHistory {
  private events: Record<string, unknown>[] = [];
  private completedTaskId = 0;
  private activitySequence = 0;

  constructor() {
    const runId = '11111111-1111-4111-8111-111111111111';
    this.event('WorkflowExecutionStarted', { workflowType: { name: workflowType }, taskQueue: { name: 'replay' },
      input: payloads(input), workflowTaskTimeout: { seconds: 10 }, originalExecutionRunId: runId,
      firstExecutionRunId: runId, attempt: 1 });
    this.task();
  }

  private event(type: string, attributes: Record<string, unknown>) {
    this.events.push({ eventId: this.events.length + 1, eventTime: { seconds: 1790794800 + this.events.length, nanos: 0 },
      eventType: `EVENT_TYPE_${type.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase()}`,
      [`${type[0].toLowerCase()}${type.slice(1)}EventAttributes`]: attributes });
    return this.events.length;
  }

  private task() {
    const scheduledEventId = this.event('WorkflowTaskScheduled', { taskQueue: { name: 'replay' },
      startToCloseTimeout: { seconds: 10 }, attempt: 1 });
    const startedEventId = this.event('WorkflowTaskStarted', { scheduledEventId, identity: 'replay', requestId: 'task' });
    this.completedTaskId = this.event('WorkflowTaskCompleted', { scheduledEventId, startedEventId, identity: 'replay' });
  }

  patch(id: string) {
    this.event('MarkerRecorded', { markerName: 'core_patch', details: { 'patch-data': payloads({ id, deprecated: false }) },
      workflowTaskCompletedEventId: this.completedTaskId });
  }

  activity(name: string, args: unknown[], result: unknown) {
    const scheduledEventId = this.event('ActivityTaskScheduled', { activityId: String(++this.activitySequence),
      activityType: { name }, taskQueue: { name: 'replay' }, input: payloads(...args),
      startToCloseTimeout: { seconds: name === 'getPendingIcpMiningActivity' ? 600 : 300 },
      workflowTaskCompletedEventId: this.completedTaskId,
      retryPolicy: { initialInterval: { seconds: 1 }, backoffCoefficient: 2, maximumAttempts: 3 } });
    const startedEventId = this.event('ActivityTaskStarted', { scheduledEventId, identity: 'replay', requestId: 'activity', attempt: 1 });
    this.event('ActivityTaskCompleted', { scheduledEventId, startedEventId, identity: 'replay', result: payloads(result) });
    this.task();
  }

  complete(result: unknown) {
    this.event('WorkflowExecutionCompleted', { workflowTaskCompletedEventId: this.completedTaskId, result: payloads(result) });
    return temporal.api.history.v1.History.fromObject({ events: this.events });
  }
}

function emptyMiningHistory(runtime: boolean, addTerminalStatus = runtime, pendingFailure = false) {
  const history = new MiningHistory();
  const workflowId = runtime ? 'mining-replay' : 'icp-mining-batch';
  const cron = { siteId: 'site', activityName: workflowType, workflowId, scheduleId: runtime ? 'timer' : workflowId };
  if (runtime) {
    history.patch(runtimePatch);
    history.activity('saveCronStatusActivity', [{ ...cron, status: 'RUNNING' }], null);
  }
  for (const patch of ['icp-mining-configurable-independent-v1', 'icp-mining-list-selection-v1', 'icp-mining-owned-checkpoints-v1']) {
    history.patch(patch);
  }
  history.activity('getIcpMiningConfigurationActivity', [{ site_id: 'site' }], {
    targetLeads: 3, researchEnabled: false, allLists: true, listIds: [],
  });
  history.activity('logWorkflowExecutionActivity', [{ workflowId, workflowType, status: 'STARTED', input }], null);
  if (!runtime) history.activity('saveCronStatusActivity', [{ ...cron, status: 'RUNNING' }], null);
  history.activity('getPendingIcpMiningActivity', [{ limit: 50, site_id: 'site' }], pendingFailure
    ? { success: false, error: 'pending lists unavailable' } : { success: true, items: [] });
  if (!pendingFailure) history.activity('logWorkflowExecutionActivity', [{ workflowId, workflowType, status: 'INFO',
    input, output: { pendingItemsCount: 0, pendingItems: [] } }], null);
  history.activity('logWorkflowExecutionActivity', [{ workflowId, workflowType, status: pendingFailure ? 'FAILED' : 'COMPLETED',
    input, output: pendingFailure ? { error: 'pending lists unavailable' } : { message: 'No pending ICP mining records found for this site' } }], null);
  if (addTerminalStatus) history.activity('saveCronStatusActivity', [{ ...cron, status: pendingFailure ? 'FAILED' : 'COMPLETED' }], null);
  return history.complete({ success: !pendingFailure, icp_mining_id: 'batch', processed: 0, foundMatches: 0,
    ...(pendingFailure ? { errors: ['pending lists unavailable'] } : {}) });
}

describe('ICP runtime settings/status Temporal replay', () => {
  let workflowBundle: Awaited<ReturnType<typeof bundleWorkflowCode>>;
  beforeAll(async () => {
    Runtime.install({ logger: new DefaultLogger('ERROR') });
    workflowBundle = await bundleWorkflowCode({
      workflowsPath: path.resolve(__dirname, '../src/temporal/workflows/idealClientProfileMiningWorkflow.ts'),
      logger: new DefaultLogger('ERROR'),
    });
  });
  afterAll(async () => { await Runtime.instance().shutdown(); });

  it.each([false, true])('replays completed histories with runtime patch = %s', async runtime => {
    await Worker.runReplayHistory({ workflowBundle }, emptyMiningHistory(runtime), 'mining-replay');
  });
  it('replays a failed pending-list result with terminal FAILED status', async () => {
    await Worker.runReplayHistory({ workflowBundle }, emptyMiningHistory(true, true, true), 'mining-replay');
  });
  it('replays a fresh legacy timer skipped by the five-minute dispatcher guard', async () => {
    const history = new MiningHistory();
    history.patch(runtimePatch);
    history.patch('icp-dispatcher-replaces-daily-v1');
    history.activity('isIcpDispatcherEnabledActivity', [], true);
    await Worker.runReplayHistory({ workflowBundle }, history.complete({ success: false, icp_mining_id: 'batch',
      processed: 0, foundMatches: 0, errors: ['ICP is managed by the five-minute dispatcher; legacy daily/manual execution skipped'] }), 'mining-replay');
  });
  it('detects a terminal-status command incorrectly added to a pre-patch history', async () => {
    const results = [];
    for await (const result of Worker.runReplayHistories({ workflowBundle }, [
      { history: emptyMiningHistory(false, true), workflowId: 'mining-replay' },
    ])) results.push(result);
    expect(results).toHaveLength(1);
    expect(results[0].error).toMatchObject({ name: 'DeterminismViolationError' });
  });
});