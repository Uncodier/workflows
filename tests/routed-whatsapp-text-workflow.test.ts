const mockActivities: Record<string, jest.Mock> = new Proxy({}, { get: (target: Record<string, jest.Mock>, key: string) => target[key] ??= jest.fn() });
const mockOptions = jest.fn();
jest.mock('@temporalio/workflow', () => ({ ...jest.requireActual('@temporalio/workflow'),
  proxyActivities: (options: any) => new Proxy({}, { get: (_, name: string) => (...args: unknown[]) => {
    mockOptions(name, options.retry.maximumAttempts); return mockActivities[name](...args);
  } }), patched: jest.fn(), sleep: jest.fn(), upsertSearchAttributes: jest.fn(), startChild: jest.fn(),
}));
import { CancelledFailure, patched, sleep, startChild } from '@temporalio/workflow';
import { sendWhatsappFromAgent } from '../src/temporal/workflows/sendWhatsappFromAgentWorkflow';
import { sendApprovedMessagesWorkflow } from '../src/temporal/workflows/sendApprovedMessagesWorkflow';

const ids = { site_id: 'site', conversation_id: 'conversation', message_id: 'saved' };
const manual = { ...ids, message: 'stale content', lead_id: 'lead', phone_number: 'stale recipient' };
const approved = { ...manual, fromApprovedWorkflow: true, approvedWorkflowCustomData: { context: 'approval' } };
const accepted = { status: 'accepted', success: true, message_id: 'saved', provider: 'zavu',
  provider_message_id: 'external', connection_id: 'connection' };
const pending = { status: 'template_pending', success: true, message_id: 'saved', provider: 'twilio',
  connection_id: 'connection-a', template_id: 'template-a' };
const routedName = 'sendRoutedWhatsAppTextActivity';
const routed = mockActivities[routedName];
const fetchSaved = mockActivities.fetchRecordByTableAndIdActivity;
const legacy = mockActivities.sendWhatsAppFromAgentActivity;
beforeEach(() => {
  jest.resetAllMocks();
  (patched as jest.Mock).mockReturnValue(true);
  fetchSaved.mockResolvedValue({ id: 'saved', conversation_id: 'conversation', content: 'refreshed' });
  routed.mockResolvedValue(accepted);
  legacy.mockResolvedValue({ success: true, messageId: 'old-receipt', recipient: 'legacy recipient' });
  mockActivities.updateMessageStatusToSentActivity.mockResolvedValue({ success: true });
});
function expectNoLegacyWrites() {
  for (const name of ['updateMessageStatusToSentActivity', 'updateMessageTimestampActivity', 'cleanupFailedFollowUpActivity',
    'deferOutreachMessageActivity', 'markTemplateReconciliationRequiredActivity', 'createTemplateActivity', 'sendTemplateActivity']) {
    expect(mockActivities[name]).not.toHaveBeenCalled();
  }
  expect(legacy).not.toHaveBeenCalled();
}

test.each([manual, approved, { ...manual, phone_number: undefined, message: '', response_format: 'text' as const }])(
  'routes saved plain text with or without a caller-supplied recipient', async params => {
    const result = await sendWhatsappFromAgent(params);
    expect(result).toMatchObject({ ...accepted, messageId: 'external' });
    expect(result).not.toHaveProperty('recipient');
    expect(routed.mock.calls).toEqual([[ids]]);
    expect(mockOptions).toHaveBeenCalledWith(routedName, 1);
    expect(sleep).not.toHaveBeenCalled();
    if ('fromApprovedWorkflow' in params) {
      expect(mockActivities.updateConversationStatusAfterFollowUpActivity).toHaveBeenCalledWith({ site_id: ids.site_id, lead_id: 'lead',
        conversation_id: ids.conversation_id, response_data: approved.approvedWorkflowCustomData,
        additional_data: { message_ids: [ids.message_id], conversation_ids: [ids.conversation_id] } });
      expect(mockActivities.updateTaskStatusToCompletedActivity).toHaveBeenCalledTimes(1);
    } else expect(mockActivities.updateTaskStatusToCompletedActivity).not.toHaveBeenCalled();
    expectNoLegacyWrites();
  });

test('only pending permits another POST; even a new pending template/connection polls the same local identity', async () => {
  routed.mockResolvedValueOnce(pending).mockResolvedValueOnce({ ...pending, provider: 'zavu', connection_id: 'other', template_id: 'template-b' });
  expect(await sendWhatsappFromAgent(approved)).toMatchObject(accepted);
  expect((sleep as jest.Mock).mock.calls).toEqual([['1 minute'], ['30 minutes']]);
  expect(routed.mock.calls).toEqual([[ids], [ids], [ids]]);
  expect(mockActivities.updateTaskStatusToCompletedActivity).toHaveBeenCalledTimes(1);
  expectNoLegacyWrites();
});
test.each([
  { status: 'failed', success: false, reason: 'definitive_rejection' },
  { status: 'skipped', success: true, skipped: true, reason: 'agent_snoozed' },
  { status: 'needs_reconciliation', success: false, reason: 'uncertain' },
])('$status, including after pending, returns the API outcome without cleanup or completion', async outcome => {
  routed.mockResolvedValueOnce(pending).mockResolvedValueOnce({ message_id: 'saved', ...outcome });
  const result = await sendWhatsappFromAgent(approved);
  expect(result).toMatchObject(outcome);
  if (outcome.status === 'skipped') expect(result.delivered).toBe(false);
  expect(result).not.toHaveProperty('messageId');
  expect(mockActivities.updateConversationStatusAfterFollowUpActivity).not.toHaveBeenCalled();
  expect(mockActivities.updateTaskStatusToCompletedActivity).not.toHaveBeenCalled();
  expect(routed.mock.calls).toEqual([[ids], [ids]]);
  expect(sleep).toHaveBeenCalledTimes(1);
  expectNoLegacyWrites();
});
test.each([false, true])('activity timeout (after pending: %s) needs reconciliation without another attempt', async afterPending => {
  if (afterPending) routed.mockResolvedValueOnce(pending);
  routed.mockRejectedValueOnce(new Error('Activity timed out'));
  expect(await sendWhatsappFromAgent(approved)).toMatchObject({ success: false, status: 'needs_reconciliation', message_id: 'saved',
    ...(afterPending && { connection_id: 'connection-a', template_id: 'template-a' }) });
  expect(routed).toHaveBeenCalledTimes(afterPending ? 2 : 1);
  expect(sleep).toHaveBeenCalledTimes(afterPending ? 1 : 0);
  expect(mockActivities.updateTaskStatusToCompletedActivity).not.toHaveBeenCalled();
  expectNoLegacyWrites();
});
test.each([{ ...accepted, message_id: 'other' }, { ...accepted, provider_message_id: 'unknown' },
  { ...pending, template_id: undefined }, { ...pending, status: 'legacy_unconfigured' }, { status: 'failed', success: true }])(
  'invalid activity result after pending never permits another send or follow-up %#', async malformed => {
    routed.mockResolvedValueOnce(pending).mockResolvedValueOnce(malformed);
    expect(await sendWhatsappFromAgent(approved)).toMatchObject({ ...pending, status: 'needs_reconciliation', success: false });
    expect(routed.mock.calls).toEqual([[ids], [ids]]);
    expect(mockActivities.updateTaskStatusToCompletedActivity).not.toHaveBeenCalled();
    expectNoLegacyWrites();
  });
test('bounded approval timeout reports the last receipt, without marking/deleting or blindly resending', async () => {
  routed.mockResolvedValue(pending);
  expect(await sendWhatsappFromAgent(approved)).toMatchObject({ ...pending, success: false, status: 'needs_reconciliation', reason: 'template_polling_exhausted' });
  expect(routed.mock.calls).toEqual(Array(27).fill([ids]));
  expect(sleep).toHaveBeenCalledTimes(26);
  expect(mockActivities.updateTaskStatusToCompletedActivity).not.toHaveBeenCalled();
  expectNoLegacyWrites();
});
test('post-acceptance bookkeeping failure does not turn provider acceptance into failure', async () => {
  mockActivities.updateTaskStatusToCompletedActivity.mockRejectedValue(new Error('DB unavailable'));
  expect(await sendWhatsappFromAgent(approved)).toMatchObject(accepted);
  expect(routed).toHaveBeenCalledTimes(1);
  expectNoLegacyWrites();
});
test('cancellation while pending propagates, with no further POST or cleanup', async () => {
  routed.mockResolvedValue(pending);
  const cancel = new CancelledFailure('cancelled');
  (sleep as jest.Mock).mockRejectedValueOnce(cancel);
  await expect(sendWhatsappFromAgent(approved)).rejects.toBe(cancel);
  expect(routed).toHaveBeenCalledTimes(1);
  expectNoLegacyWrites();
});

const pollToken = '00000000-0000-4000-8000-000000000050';
const verifiedPending = { ...pending, attempt_id: pollToken };
const readPoll = mockActivities.readRoutedWhatsAppTextActivity;
const stopPoll = mockActivities.stopRoutedWhatsAppPollActivity;
test('lost poll response recovers an accepted provider receipt through GET, never another send', async () => {
  routed.mockResolvedValueOnce(pending).mockRejectedValueOnce(new Error('lost response'));
  readPoll.mockResolvedValueOnce(accepted);
  expect(await sendWhatsappFromAgent(approved)).toMatchObject({ ...accepted, messageId: accepted.provider_message_id });
  expect(readPoll.mock.calls).toEqual([[ids]]); expect(routed).toHaveBeenCalledTimes(2);
  expect(stopPoll).not.toHaveBeenCalled(); expect(sleep).toHaveBeenCalledTimes(1);
});

test.each([false, true])('a scoped pending GET after HTTP failure permits only the next bounded timer (had previous: %s)', async hadPrevious => {
  if (hadPrevious) routed.mockResolvedValueOnce(pending);
  routed.mockRejectedValueOnce(new Error('lost response')).mockResolvedValueOnce(accepted);
  readPoll.mockResolvedValueOnce(verifiedPending);
  expect(await sendWhatsappFromAgent(approved)).toMatchObject(accepted);
  expect(readPoll).toHaveBeenCalledTimes(1); expect(stopPoll).not.toHaveBeenCalled();
  expect(sleep).toHaveBeenCalledTimes(hadPrevious ? 2 : 1);
  const calls = routed.mock.invocationCallOrder;
  expect((sleep as jest.Mock).mock.invocationCallOrder.at(-1)).toBeLessThan(calls.at(-1)!);
});

test('if GET is unavailable, CAS marks the previously observed pending receipt instead of leaving it queued', async () => {
  routed.mockResolvedValueOnce(verifiedPending).mockRejectedValueOnce(new Error('offline'));
  readPoll.mockRejectedValueOnce(new Error('read outage'));
  stopPoll.mockResolvedValueOnce({ status: 'needs_reconciliation', success: false, message_id: 'saved', reconciliation_persisted: true });
  expect(await sendWhatsappFromAgent(approved)).toMatchObject({ status: 'needs_reconciliation', reconciliation_persisted: true });
  expect(stopPoll.mock.calls).toEqual([[{ ...ids, provider: 'twilio', connection_id: 'connection-a', template_id: 'template-a', attempt_id: pollToken }]]);
  expect(routed).toHaveBeenCalledTimes(2); expect(sleep).toHaveBeenCalledTimes(1);
});

test('if the recovery store is also unavailable, the workflow reports that reconciliation was not persisted', async () => {
  routed.mockResolvedValueOnce(verifiedPending).mockRejectedValueOnce(new Error('offline'));
  readPoll.mockRejectedValueOnce(new Error('read outage')); stopPoll.mockRejectedValueOnce(new Error('write outage'));
  expect(await sendWhatsappFromAgent(approved)).toMatchObject({ status: 'needs_reconciliation', reconciliation_persisted: false });
  expect(stopPoll).toHaveBeenCalledTimes(1); expect(routed).toHaveBeenCalledTimes(2);
});

test('no polling after a read reports an in-flight or terminal receipt', async () => {
  routed.mockResolvedValueOnce(verifiedPending).mockRejectedValueOnce(new Error('offline'));
  readPoll.mockResolvedValueOnce({ status: 'needs_reconciliation', success: false, message_id: 'saved' });
  expect(await sendWhatsappFromAgent(manual)).toMatchObject({ status: 'needs_reconciliation' });
  expect(stopPoll).not.toHaveBeenCalled(); expect(routed).toHaveBeenCalledTimes(2);
});

test('a slow request that outlives its HTTP timeout is observed via GET only until it finishes', async () => {
  routed.mockRejectedValueOnce(new Error('request timed out'));
  const inFlight = { message_id: ids.message_id, connection_id: 'A', provider: 'zavu', status: 'needs_reconciliation',
    success: false, attempt_id: pollToken, recovery_action: 'observe' };
  readPoll.mockResolvedValueOnce(inFlight).mockResolvedValueOnce(inFlight).mockResolvedValueOnce(accepted);
  expect(await sendWhatsappFromAgent(manual)).toMatchObject(accepted);
  expect(routed).toHaveBeenCalledTimes(1); expect(readPoll).toHaveBeenCalledTimes(3);
  expect(stopPoll).not.toHaveBeenCalled(); expect(sleep).toHaveBeenCalledTimes(2);
});

test('after a slow handler publishes a template, only a verified pending GET allows the next send poll', async () => {
  routed.mockRejectedValueOnce(new Error('request timed out')).mockResolvedValueOnce(accepted);
  readPoll.mockResolvedValueOnce({ message_id: ids.message_id, connection_id: 'connection-a', provider: 'twilio',
    status: 'needs_reconciliation', success: false, attempt_id: pollToken, recovery_action: 'observe' })
    .mockResolvedValueOnce(verifiedPending);
  expect(await sendWhatsappFromAgent(manual)).toMatchObject(accepted);
  expect(routed).toHaveBeenCalledTimes(2); expect(readPoll).toHaveBeenCalledTimes(2);
  expect(sleep).toHaveBeenCalledTimes(2); expect(stopPoll).not.toHaveBeenCalled();
});

test('at timer exhaustion, read then mark only the last pending attempt (never another send)', async () => {
  routed.mockResolvedValue(verifiedPending); readPoll.mockResolvedValue(verifiedPending);
  stopPoll.mockResolvedValue({ status: 'needs_reconciliation', message_id: 'saved', success: false, reconciliation_persisted: true });
  expect(await sendWhatsappFromAgent(manual)).toMatchObject({ status: 'needs_reconciliation', reconciliation_persisted: true });
  expect(routed).toHaveBeenCalledTimes(27); expect(sleep).toHaveBeenCalledTimes(26);
  expect(readPoll).toHaveBeenCalledTimes(1); expect(stopPoll).toHaveBeenCalledTimes(1);
});

test('pre-recovery histories retain the original no-read/no-marker error behavior', async () => {
  (patched as jest.Mock).mockImplementation(id => id !== 'whatsapp-routed-text-poll-recovery-v1');
  routed.mockResolvedValueOnce(verifiedPending).mockRejectedValueOnce(new Error('old timeout'));
  expect(await sendWhatsappFromAgent(manual)).toMatchObject({ status: 'needs_reconciliation' });
  expect(readPoll).not.toHaveBeenCalled(); expect(stopPoll).not.toHaveBeenCalled();
});

test.each([null, { id: 'other', content: 'Hello' }, { conversation_id: 'other', content: 'Hello' },
  { content: '' }, { content: 'Voice', custom_data: { response_format: 'audio' } },
  { content: 'Voice', custom_data: { audio_delivery: { state: 'sent' } } },
  { content: 'Media', custom_data: { message_type: 'image' } },
  { content: 'Media', custom_data: { native_media_delivery: { state: 'unknown' } } },
])('unverified saved plain text %# never dispatches or cleans up', async record => {
  fetchSaved.mockResolvedValue(record);
  await expect(sendWhatsappFromAgent(approved)).rejects.toMatchObject({ nonRetryable: true });
  expect(routed).not.toHaveBeenCalled();
  expectNoLegacyWrites();
});
test('unavailable refresh is not proof of plain text, and does not send stale caller content', async () => {
  fetchSaved.mockRejectedValue(new Error('fetch unavailable'));
  await expect(sendWhatsappFromAgent(approved)).rejects.toMatchObject({ nonRetryable: true });
  expect(routed).not.toHaveBeenCalled();
  expectNoLegacyWrites();
});
test.each([{ ...manual, message_id: 'unknown' }, { ...manual, conversation_id: '   ' }])(
  'invalid claimed saved IDs fail closed, not through a default sender', async input => {
    await expect(sendWhatsappFromAgent(input)).rejects.toMatchObject({ type: 'WHATSAPP_ROUTED_TEXT_INVALID_INPUT', nonRetryable: true });
    expect(routed).not.toHaveBeenCalled();
    expectNoLegacyWrites();
  });
test('media found only on refresh stays on original native single-attempt dispatch', async () => {
  const media = { message_type: 'image', media_url: 'https://offline.invalid/image' };
  fetchSaved.mockResolvedValue({ content: '', custom_data: media });
  await sendWhatsappFromAgent(manual);
  expect(legacy).toHaveBeenCalledWith(expect.objectContaining({ ...media, message: '', phone_number: manual.phone_number }));
  expect(mockOptions).toHaveBeenCalledWith('sendWhatsAppFromAgentActivity', 1);
  expect(routed).not.toHaveBeenCalled();
});
test('explicit audio goes to the existing one-attempt sender, never the text router', async () => {
  await sendWhatsappFromAgent({ ...manual, response_format: 'audio' });
  expect(legacy).toHaveBeenCalledWith(expect.objectContaining({ response_format: 'audio' }));
  expect(mockOptions).toHaveBeenCalledWith('sendWhatsAppFromAgentActivity', 1);
  expect(routed).not.toHaveBeenCalled();
});
test.each([{ ...manual, message_id: undefined }, { ...manual, conversation_id: undefined }])(
  'without both durable IDs preserves the original dispatch/retry policy', async params => {
    await sendWhatsappFromAgent(params);
    expect(mockOptions).toHaveBeenCalledWith('sendWhatsAppFromAgentActivity', 3);
    expect(routed).not.toHaveBeenCalled();
  });
test('replay without the patch keeps the old refresh, send, status and follow-up commands', async () => {
  (patched as jest.Mock).mockImplementation(id => id !== 'whatsapp-saved-text-router-v1');
  await sendWhatsappFromAgent(approved);
  expect(mockOptions.mock.calls).toEqual([
    ['fetchRecordByTableAndIdActivity', 3], ['sendWhatsAppFromAgentActivity', 3],
    ['updateMessageStatusToSentActivity', 3], ['updateMessageTimestampActivity', 3],
    ['updateConversationStatusAfterFollowUpActivity', 3], ['updateTaskStatusToCompletedActivity', 3],
  ]);
  expect(legacy).toHaveBeenCalledWith(expect.objectContaining({ message: 'refreshed', message_id: 'saved', phone_number: 'stale recipient' }));
  expect(routed).not.toHaveBeenCalled();
});

function queueApprovedPlainText() {
  mockActivities.getApprovedMessagesActivity.mockResolvedValue([{ ...ids, content: 'Hello', custom_data: { channel: 'whatsapp' },
    lead_phone: null, lead_id: 'lead' }]);
  mockActivities.resetStuckSendingMessagesActivity.mockResolvedValue({ resetCount: 0 });
  mockActivities.claimApprovedMessagesBatchActivity.mockResolvedValue(['saved']);
  mockActivities.checkConversationAutomationActivity.mockResolvedValue({ success: true });
}
test('approval can launch a saved plain-text child without a caller phone; API chooses the recipient', async () => {
  queueApprovedPlainText();
  await sendApprovedMessagesWorkflow();
  expect(startChild).toHaveBeenCalledTimes(1);
  const [input] = (startChild as jest.Mock).mock.calls[0][1].args;
  expect(input).toMatchObject({ ...ids, fromApprovedWorkflow: true });
  expect(input.phone_number).toBeUndefined();
  expect(mockActivities.checkConversationAutomationActivity).not.toHaveBeenCalled(); // API owns terminal suppression.
  expectNoLegacyWrites();
});
test('approval does not invalidate the contact on ambiguous routed child start', async () => {
  queueApprovedPlainText();
  (startChild as jest.Mock).mockRejectedValue(new Error('child start not confirmed'));
  expect(await sendApprovedMessagesWorkflow()).toMatchObject({ success: 0, failed: 1 });
  expectNoLegacyWrites();
});