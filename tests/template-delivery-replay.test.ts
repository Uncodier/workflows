import path from 'node:path';
import { defaultPayloadConverter } from '@temporalio/common';
import { temporal } from '@temporalio/proto';
import { bundleWorkflowCode, DefaultLogger, Runtime, Worker } from '@temporalio/worker';

// Offline Temporal Core replay of exact queued audio histories from before both
// polling patches. No server, HTTP, database, or credentials are used.
const payloads = (...values: unknown[]) => ({ payloads: values.map(value => defaultPayloadConverter.toPayload(value)) });
function oldExactAudioHistory(withPolling = false) {
  const events: Record<string, unknown>[] = [];
  let completedTaskId = 0;
  let sequence = 0;
  function event(type: string, attributes: Record<string, unknown>) {
    events.push({ eventId: events.length + 1, eventTime: { seconds: 1794268800 },
      eventType: `EVENT_TYPE_${type.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase()}`,
      [`${type[0].toLowerCase()}${type.slice(1)}EventAttributes`]: attributes });
    return events.length;
  }
  function task() {
    const scheduledEventId = event('WorkflowTaskScheduled', {
      taskQueue: { name: 'replay' }, startToCloseTimeout: { seconds: 10 }, attempt: 1 });
    const startedEventId = event('WorkflowTaskStarted', { scheduledEventId, identity: 'replay', requestId: 'task' });
    completedTaskId = event('WorkflowTaskCompleted', { scheduledEventId, startedEventId, identity: 'replay' });
  }
  function activity(name: string, args: unknown[], result: unknown) {
    const scheduledEventId = event('ActivityTaskScheduled', {
      activityId: String(++sequence), activityType: { name }, taskQueue: { name: 'replay' },
      input: payloads(...args), startToCloseTimeout: { seconds: name === 'sendExactQueuedMessageActivity' && withPolling ? 180 : 300 },
      workflowTaskCompletedEventId: completedTaskId,
      retryPolicy: { initialInterval: { seconds: 1 }, backoffCoefficient: 2,
        maximumAttempts: name === 'sendExactQueuedMessageActivity' && withPolling ? 1 : 3 },
    });
    const startedEventId = event('ActivityTaskStarted', { scheduledEventId, identity: 'replay', requestId: 'activity', attempt: 1 });
    event('ActivityTaskCompleted', { scheduledEventId, startedEventId, identity: 'replay', result: payloads(result) });
    task();
  }
  const runId = '11111111-1111-4111-8111-111111111111';
  event('WorkflowExecutionStarted', {
    workflowType: { name: 'sendApprovedMessagesWorkflow' }, taskQueue: { name: 'replay' }, input: payloads(),
    workflowTaskTimeout: { seconds: 10 }, originalExecutionRunId: runId, firstExecutionRunId: runId, attempt: 1,
  });
  task();
  for (const id of ['send-approved-messages-batch-claims-v1', 'approved-message-response-format-v1',
    'outreach-configured-delivery-v1', 'send-approved-comment-exact-target-v1', 'send-approved-connection-exact-delivery-v1',
    ...(withPolling ? ['approved-audio-template-polling-v1'] : [])]) {
    event('MarkerRecorded', { markerName: 'core_patch', details: { 'patch-data': payloads({ id, deprecated: false }) },
      workflowTaskCompletedEventId: completedTaskId });
  }
  const message = { message_id: 'message', conversation_id: 'conversation', site_id: 'site', lead_id: 'lead',
    content: 'Hello', custom_data: { channel: 'whatsapp', connection_id: 'selected', response_format: 'audio' } };
  activity('resetStuckSendingMessagesActivity', [], { resetCount: 0 });
  activity('getApprovedMessagesActivity', [], [message]);
  activity('claimApprovedMessagesBatchActivity', [[{ message_id: 'message', conversation_id: 'conversation', site_id: 'site' }]], ['message']);
  const sendArgs = [{ site_id: 'site', message_id: 'message', conversation_id: 'conversation', channel: 'whatsapp',
    ...(withPolling ? { response_format: 'audio' } : {}) }];
  const pending = { success: true, status: 'template_pending', template_pending: true,
    delivery_format: 'template', requested_response_format: 'audio', message_id: 'message', template_id: 'template' };
  activity('sendExactQueuedMessageActivity', sendArgs, withPolling ? pending : { success: true, messageId: 'provider' });
  if (withPolling) {
    for (const [index, seconds] of [60, 1800, 3600, 21600, 28800, 32400].entries()) {
      const timerId = String(index + 1);
      const startedEventId = event('TimerStarted', { timerId, startToFireTimeout: { seconds },
        workflowTaskCompletedEventId: completedTaskId });
      event('TimerFired', { timerId, startedEventId });
      task();
      activity('sendExactQueuedMessageActivity', sendArgs, index < 5 ? pending : {
        success: true, status: 'sent', template_used: true, delivery_format: 'template', messageId: 'provider' });
    }
  }
  for (const name of ['updateMessageStatusToSentActivity', 'updateMessageTimestampActivity',
    'updateConversationStatusAfterFollowUpActivity', 'updateTaskStatusToCompletedActivity']) {
    activity(name, [{}], { success: true });
  }
  event('WorkflowExecutionCompleted', { workflowTaskCompletedEventId: completedTaskId,
    result: payloads({ processed: 1, success: 1, failed: 0, deferred: 0, ...(withPolling ? { pending: 0 } : {}) }) });
  return temporal.api.history.v1.History.fromObject({ events });
}

test('pre-polling and prior six-timer exact audio histories replay without recovery commands', async () => {
  Runtime.install({ logger: new DefaultLogger('ERROR') });
  const workflowBundle = await bundleWorkflowCode({
    workflowsPath: path.resolve(__dirname, '../src/temporal/workflows/sendApprovedMessagesWorkflow.ts'),
    logger: new DefaultLogger('ERROR'),
  });
  await Worker.runReplayHistory({ workflowBundle }, oldExactAudioHistory());
  await Worker.runReplayHistory({ workflowBundle }, oldExactAudioHistory(true));
}, 60_000);