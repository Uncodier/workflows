import path from 'node:path';
import { defaultPayloadConverter } from '@temporalio/common';
import { temporal } from '@temporalio/proto';
import { bundleWorkflowCode, DefaultLogger, Runtime, Worker } from '@temporalio/worker';

const payloads = (...values: unknown[]) => ({ payloads: values.map(value => defaultPayloadConverter.toPayload(value)) });

it('replays an acknowledged dispatcher page and settlement without starting paid work', async () => {
  Runtime.install({ logger: new DefaultLogger('ERROR') });
  try {
    const workflowBundle = await bundleWorkflowCode({ workflowsPath: path.resolve(__dirname, '../src/temporal/workflows/icpMiningSliceWorkflow.ts'), logger: new DefaultLogger('ERROR') });
    const events: Record<string, unknown>[] = [];
    let taskId = 0;
    let activityId = 0;
    const event = (type: string, attributes: Record<string, unknown>) => {
      events.push({ eventId: events.length + 1, eventTime: { seconds: 1790985600 + events.length },
        eventType: `EVENT_TYPE_${type.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase()}`,
        [`${type[0].toLowerCase()}${type.slice(1)}EventAttributes`]: attributes });
      return events.length;
    };
    const task = () => {
      const scheduledEventId = event('WorkflowTaskScheduled', { taskQueue: { name: 'replay' }, startToCloseTimeout: { seconds: 10 }, attempt: 1 });
      const startedEventId = event('WorkflowTaskStarted', { scheduledEventId, identity: 'replay', requestId: 'task' });
      taskId = event('WorkflowTaskCompleted', { scheduledEventId, startedEventId, identity: 'replay' });
    };
    const activity = (name: string, result: unknown) => {
      const scheduledEventId = event('ActivityTaskScheduled', { activityId: String(++activityId), activityType: { name },
        taskQueue: { name: 'replay' }, input: payloads({}), startToCloseTimeout: { seconds: 300 }, workflowTaskCompletedEventId: taskId,
        retryPolicy: { initialInterval: { seconds: 1 }, backoffCoefficient: 2, maximumAttempts: 3 } });
      const startedEventId = event('ActivityTaskStarted', { scheduledEventId, identity: 'replay', requestId: 'activity', attempt: 1 });
      event('ActivityTaskCompleted', { scheduledEventId, startedEventId, identity: 'replay', result: payloads(result) });
      task();
    };
    const runId = '11111111-1111-4111-8111-111111111111';
    event('WorkflowExecutionStarted', { workflowType: { name: 'icpMiningSliceWorkflow' }, taskQueue: { name: 'replay' },
      input: payloads({ reservationId: 'r' }), workflowTaskTimeout: { seconds: 10 }, originalExecutionRunId: runId, firstExecutionRunId: runId, attempt: 1 });
    task();
    activity('beginIcpDispatchActivity', { reservation: { id: 'r', site_id: 'site', reserved_candidates: 10, reserved_matches: 2, research_enabled: false },
      icp: { id: 'list', site_id: 'site', role_query_id: 'role', current_page: 0, current_page_offset: 0,
        processed_targets: 0, found_matches: 0, checkpoint_version: 0, current_page_snapshot: null } });
    activity('getSiteActivity', { success: true, site: { user_id: 'user' } });
    activity('saveCronStatusActivity', null);
    const childId = 'icp-slice-page-r';
    const initiatedEventId = event('StartChildWorkflowExecutionInitiated', { namespace: 'default', workflowId: childId,
      workflowType: { name: 'idealClientProfilePageSearchWorkflow' }, taskQueue: { name: 'replay' }, input: payloads({}),
      workflowTaskCompletedEventId: taskId, parentClosePolicy: 'PARENT_CLOSE_POLICY_TERMINATE', workflowIdReusePolicy: 'WORKFLOW_ID_REUSE_POLICY_ALLOW_DUPLICATE' });
    const startedEventId = event('ChildWorkflowExecutionStarted', { namespace: 'default', initiatedEventId,
      workflowExecution: { workflowId: childId, runId }, workflowType: { name: 'idealClientProfilePageSearchWorkflow' } });
    task();
    event('ChildWorkflowExecutionCompleted', { namespace: 'default', initiatedEventId, startedEventId,
      workflowExecution: { workflowId: childId, runId }, workflowType: { name: 'idealClientProfilePageSearchWorkflow' },
      result: payloads({ success: true, processed: 2, foundMatches: 2, errors: [], pageCompleted: true, hasMore: false,
        checkpoint: { processed: 2, found: 2, version: 3, page: 1, offset: 0, snapshot: null } }) });
    task();
    activity('checkpointIcpMiningExecutionActivity', { success: true });
    activity('finishIcpDispatchActivity', { success: true, next_eligible_at: '2026-10-03T00:05:00Z' });
    activity('saveCronStatusActivity', null);
    event('WorkflowExecutionCompleted', { workflowTaskCompletedEventId: taskId,
      result: payloads({ success: true, processed: 2, foundMatches: 2, reservationId: 'r' }) });
    await Worker.runReplayHistory({ workflowBundle }, temporal.api.history.v1.History.fromObject({ events }), 'slice-replay');
  } finally { await Runtime.instance().shutdown(); }
});