import path from 'node:path';
import { defaultPayloadConverter } from '@temporalio/common';
import { temporal } from '@temporalio/proto';
import { bundleWorkflowCode, DefaultLogger, Runtime, Worker } from '@temporalio/worker';

const payloads = (...values: unknown[]) => ({ payloads: values.map(value => defaultPayloadConverter.toPayload(value)) });

it('replays legacy archived-site activity results and closes with a non-retryable failure', async () => {
  Runtime.install({ logger: new DefaultLogger('ERROR') });
  try {
    const workflowBundle = await bundleWorkflowCode({
      workflowsPath: path.resolve(__dirname, '../src/temporal/workflows/analyzeSiteWorkflow.ts'),
      logger: new DefaultLogger('ERROR'),
    });
    const events: Record<string, unknown>[] = [];
    let taskId = 0;
    let activityId = 0;
    const event = (type: string, attributes: Record<string, unknown>) => {
      events.push({ eventId: events.length + 1, eventTime: { seconds: 1793023200 + events.length },
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
    event('WorkflowExecutionStarted', { workflowType: { name: 'analyzeSiteWorkflow' }, taskQueue: { name: 'replay' },
      input: payloads({ site_id: 'site' }), workflowTaskTimeout: { seconds: 10 }, originalExecutionRunId: runId, firstExecutionRunId: runId, attempt: 1 });
    task();
    event('UpsertWorkflowSearchAttributes', { workflowTaskCompletedEventId: taskId,
      searchAttributes: { indexedFields: { site_id: defaultPayloadConverter.toPayload(['site']) } } });
    activity('logWorkflowExecutionActivity', null);
    activity('saveCronStatusActivity', null);
    activity('getSiteActivity', { success: false, error: 'Archived sites cannot be set up' });
    activity('saveCronStatusActivity', null);
    activity('logWorkflowExecutionActivity', null);
    event('WorkflowExecutionFailed', { workflowTaskCompletedEventId: taskId,
      retryState: 'RETRY_STATE_NON_RETRYABLE_FAILURE',
      failure: { message: 'Failed to get site information: Archived sites cannot be set up',
        applicationFailureInfo: { type: 'SITE_ARCHIVED', nonRetryable: true } } });
    await Worker.runReplayHistory({ workflowBundle }, temporal.api.history.v1.History.fromObject({ events }), 'analysis-replay');
  } finally {
    await Runtime.instance().shutdown();
  }
});