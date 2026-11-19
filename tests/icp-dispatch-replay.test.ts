import path from 'node:path';
import { defaultPayloadConverter } from '@temporalio/common';
import { temporal } from '@temporalio/proto';
import { bundleWorkflowCode, DefaultLogger, Runtime, Worker } from '@temporalio/worker';

const payloads = (...values: unknown[]) => ({ payloads: values.map(value => defaultPayloadConverter.toPayload(value)) });

let workflowBundle: Awaited<ReturnType<typeof bundleWorkflowCode>>;
beforeAll(async () => {
  Runtime.install({ logger: new DefaultLogger('ERROR') });
  workflowBundle = await bundleWorkflowCode({ workflowsPath: path.resolve(__dirname, '../src/temporal/workflows/icpMiningSliceWorkflow.ts'), logger: new DefaultLogger('ERROR') });
});
afterAll(async () => { await Runtime.instance().shutdown(); });

it.each(['page', 'lost ACK pre-patch', 'lost ACK reconciled', 'zero credit pre-patch', 'zero credit settled'])(
  'replays a reserved slice without executing paid work: %s', async scenario => {
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
    const patch = (id: string) => event('MarkerRecorded', { markerName: 'core_patch',
      details: { 'patch-data': payloads({ id, deprecated: false }) }, workflowTaskCompletedEventId: taskId });
    const activity = (name: string, result: unknown, failed = false) => {
      const scheduledEventId = event('ActivityTaskScheduled', { activityId: String(++activityId), activityType: { name },
        taskQueue: { name: 'replay' }, input: payloads({}), startToCloseTimeout: { seconds: 300 }, workflowTaskCompletedEventId: taskId,
        retryPolicy: { initialInterval: { seconds: 1 }, backoffCoefficient: 2, maximumAttempts: 3 } });
      const startedEventId = event('ActivityTaskStarted', { scheduledEventId, identity: 'replay', requestId: 'activity', attempt: 1 });
      if (failed) event('ActivityTaskFailed', { scheduledEventId, startedEventId, identity: 'replay',
        failure: { message: 'ACK lost', applicationFailureInfo: { type: 'Error' } }, retryState: 'RETRY_STATE_MAXIMUM_ATTEMPTS_REACHED' });
      else event('ActivityTaskCompleted', { scheduledEventId, startedEventId, identity: 'replay', result: payloads(result) });
      task();
    };
    const runId = '11111111-1111-4111-8111-111111111111';
    event('WorkflowExecutionStarted', { workflowType: { name: 'icpMiningSliceWorkflow' }, taskQueue: { name: 'replay' },
      input: payloads({ reservationId: 'r' }), workflowTaskTimeout: { seconds: 10 }, originalExecutionRunId: runId, firstExecutionRunId: runId, attempt: 1 });
    task();
    activity('beginIcpDispatchActivity', { reservation: { id: 'r', site_id: 'site', reserved_candidates: 10, reserved_matches: 2, research_enabled: false },
      icp: { id: 'list', site_id: 'site', role_query_id: 'role', current_page: 0, current_page_offset: 0,
        processed_targets: 0, found_matches: 0, checkpoint_version: 0, current_page_snapshot: null } });
    const recovered = scenario === 'lost ACK reconciled';
    const selected = scenario.startsWith('lost ACK');
    const canSpend = !scenario.startsWith('zero credit');
    if (recovered || scenario === 'zero credit settled') patch('icp-dispatch-preflight-settlement-v1');
    activity('getSiteActivity', { success: true, site: { user_id: 'user' } });
    activity('saveCronStatusActivity', null);
    if (scenario !== 'page') {
      patch('icp-slice-credit-guard-v1');
      activity('checkIcpMiningCreditsActivity', canSpend);
    }
    if (selected) {
      patch('icp-selected-members-v1');
      activity('readSelectedIcpPeopleActivity', { selectedOnly: true, searchExhausted: false, pending: 1,
        members: [{ ordinal: '1', person_id: '0001', created_by: 'user' }] });
      if (recovered) patch('icp-selected-member-ack-recovery-v1');
      activity('getSelectedIcpPersonActivity', { person: { id: '0001' } });
    }
    const childId = selected ? `icp-selected-enrich-list-${runId}-1` : 'icp-slice-page-r';
    const childType = selected ? 'enrichLeadWorkflow' : 'idealClientProfilePageSearchWorkflow';
    if (canSpend) {
      const initiatedEventId = event('StartChildWorkflowExecutionInitiated', { namespace: 'default', workflowId: childId,
        workflowType: { name: childType }, taskQueue: { name: 'replay' }, input: payloads({}),
        workflowTaskCompletedEventId: taskId, parentClosePolicy: 'PARENT_CLOSE_POLICY_TERMINATE', workflowIdReusePolicy: 'WORKFLOW_ID_REUSE_POLICY_ALLOW_DUPLICATE' });
      const startedEventId = event('ChildWorkflowExecutionStarted', { namespace: 'default', initiatedEventId,
        workflowExecution: { workflowId: childId, runId }, workflowType: { name: childType } });
      task();
      event('ChildWorkflowExecutionCompleted', { namespace: 'default', initiatedEventId, startedEventId,
        workflowExecution: { workflowId: childId, runId }, workflowType: { name: childType },
        result: payloads(selected ? { success: true, leadId: 'lead', errors: [] } : { success: true, processed: 2, foundMatches: 2, errors: [], pageCompleted: true, hasMore: false,
          checkpoint: { processed: 2, found: 2, version: 3, page: 1, offset: 0, snapshot: null } }) });
      task();
      if (selected) {
        activity('acknowledgeSelectedIcpPersonActivity', undefined, true);
        if (recovered) activity('reconcileSelectedIcpPersonAckActivity', { version: 1, processed: 1, found: 1 });
      }
      activity('checkpointIcpMiningExecutionActivity', { success: true });
      if (selected) activity('finalizeSelectedIcpSliceActivity', undefined);
    }
    activity(scenario === 'zero credit settled' ? 'settleIcpDispatchPreflightActivity' : 'finishIcpDispatchActivity',
      { success: true, next_eligible_at: '2026-10-03T00:05:00Z' });
    activity('saveCronStatusActivity', null);
    event('WorkflowExecutionCompleted', { workflowTaskCompletedEventId: taskId,
      result: payloads({ success: scenario === 'page' || recovered, processed: scenario === 'page' ? 2 : Number(recovered),
        foundMatches: scenario === 'page' ? 2 : Number(recovered), reservationId: 'r' }) });
    await Worker.runReplayHistory({ workflowBundle }, temporal.api.history.v1.History.fromObject({ events }), 'slice-replay');
  },
);