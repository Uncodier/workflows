import path from 'node:path';
import { defaultPayloadConverter } from '@temporalio/common';
import { temporal } from '@temporalio/proto';
import { bundleWorkflowCode, DefaultLogger, Runtime, Worker } from '@temporalio/worker';

const payloads = (...values: unknown[]) => ({ payloads: values.map(value => defaultPayloadConverter.toPayload(value)) });
const workflowType = 'enrichLeadWorkflow';
const site_id = '9be0a6a2-5567-41bf-ad06-cb4014f0faf2';

// Replay the actual enrichment workflow through the IcyPeas boundary, not a
// synthetic stand-in workflow. Activities do not run and no provider is called.
function history(durable: boolean, trustProviderEmails = false) {
  const events: Record<string, unknown>[] = [];
  let taskId = 0;
  let sequence = 0;
  const event = (type: string, attributes: Record<string, unknown>) => {
    events.push({ eventId: events.length + 1, eventTime: { seconds: 1790880000 + events.length },
      eventType: `EVENT_TYPE_${type.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase()}`,
      [`${type[0].toLowerCase()}${type.slice(1)}EventAttributes`]: attributes });
    return events.length;
  };
  const task = () => {
    const scheduledEventId = event('WorkflowTaskScheduled', { taskQueue: { name: 'replay' }, startToCloseTimeout: { seconds: 10 }, attempt: 1 });
    const startedEventId = event('WorkflowTaskStarted', { scheduledEventId, identity: 'replay', requestId: 'task' });
    taskId = event('WorkflowTaskCompleted', { scheduledEventId, startedEventId, identity: 'replay' });
  };
  const activity = (name: string, args: unknown[], result: unknown) => {
    const scheduledEventId = event('ActivityTaskScheduled', { activityId: String(++sequence), activityType: { name }, taskQueue: { name: 'replay' },
      input: payloads(...args), startToCloseTimeout: { seconds: 300 }, workflowTaskCompletedEventId: taskId,
      retryPolicy: { initialInterval: { seconds: 1 }, backoffCoefficient: 2, maximumAttempts: 3 } });
    const startedEventId = event('ActivityTaskStarted', { scheduledEventId, identity: 'replay', requestId: 'activity', attempt: 1 });
    event('ActivityTaskCompleted', { scheduledEventId, startedEventId, identity: 'replay', result: payloads(result) });
    task();
  };
  const runId = '11111111-1111-4111-8111-111111111111';
  const input = { site_id, person_id: '1', validated_contact_policy: true,
    source_search_result: { person: { id: 1 }, organization: { domain: 'acme.test', name: 'Acme' } } };
  event('WorkflowExecutionStarted', { workflowType: { name: workflowType }, taskQueue: { name: 'replay' }, input: payloads(input),
    workflowTaskTimeout: { seconds: 10 }, originalExecutionRunId: runId, firstExecutionRunId: runId, attempt: 1 });
  task();
  event('UpsertWorkflowSearchAttributes', { workflowTaskCompletedEventId: taskId,
    searchAttributes: { indexedFields: { site_id: defaultPayloadConverter.toPayload([site_id]) } } });
  activity('logWorkflowExecutionActivity', [{}], null);
  if (durable) event('MarkerRecorded', { markerName: 'core_patch',
    details: { 'patch-data': payloads({ id: 'icypeas-durable-email-search-v1', deprecated: false }) }, workflowTaskCompletedEventId: taskId });
  if (trustProviderEmails) event('MarkerRecorded', { markerName: 'core_patch',
    details: { 'patch-data': payloads({ id: 'icp-provider-email-trust-v1', deprecated: false }) }, workflowTaskCompletedEventId: taskId });
  const person = { id: 'person', external_person_id: 1, full_name: 'Ada Example', raw_result: {} };
  activity('prepareFinderPersonActivity', [input], { success: true, errors: [], person, role: { organization: { domain: 'acme.test', name: 'Acme' } } });
  activity('checkExistingLeadForPersonActivity', [{ person_id: 'person', site_id }], { success: true });
  activity('lookEmailOnIcyPeas', [{ domainOrCompany: 'acme.test', firstname: 'Ada', lastname: 'Example', ...(durable ? { site_id } : {}) }], {
    success: true, ...(durable ? { outcome: 'matched', searchId: 'durable-id' } : {}), data: { email: 'ada@acme.test' },
  });
  if (!trustProviderEmails) activity('validateContactInformation', [{ email: 'ada@acme.test', hasEmailMessage: true }], { success: true, isValid: true });
  activity('upsertPersonActivity', [{}], { success: true, person });
  activity('upsertLeadForPersonActivity', [{}], { success: true, leadId: 'lead' });
  activity('logWorkflowExecutionActivity', [{}], null);
  event('WorkflowExecutionCompleted', { workflowTaskCompletedEventId: taskId, result: payloads({ success: true, personId: 'person', leadId: 'lead' }) });
  return temporal.api.history.v1.History.fromObject({ events });
}

describe('IcyPeas tenant-context replay compatibility', () => {
  let workflowBundle: Awaited<ReturnType<typeof bundleWorkflowCode>>;
  beforeAll(async () => {
    Runtime.install({ logger: new DefaultLogger('ERROR') });
    workflowBundle = await bundleWorkflowCode({ workflowsPath: path.resolve(__dirname, '../src/temporal/workflows/enrichLeadWorkflow.ts'), logger: new DefaultLogger('ERROR') });
  });
  afterAll(async () => { await Runtime.instance().shutdown(); });
  it.each([false, true])('replays enrichment with durable IcyPeas patch = %s', async durable => {
    await Worker.runReplayHistory({ workflowBundle }, history(durable), 'icypeas-enrichment-replay');
  });
  it('replays the provider-trust policy without a Reoon activity', async () => {
    await Worker.runReplayHistory({ workflowBundle }, history(true, true), 'icp-provider-trust-replay');
  });
});