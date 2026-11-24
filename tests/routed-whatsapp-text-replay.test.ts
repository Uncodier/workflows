import path from 'node:path';
import { bundleWorkflowCode, DefaultLogger, Runtime, Worker } from '@temporalio/worker';
import { epoch, History, senderRun, supportRun, timedOut } from './fixtures/channel-replay/history';

afterAll(async () => { await Runtime.instance().shutdown(); });

// Actual Core replay of invented, finite legacy and patched approval-child
// histories. The workflow bundle has no activities, credentials or transport.
function history(routed: boolean) {
  const ids = { site_id: 'site', conversation_id: 'conversation', message_id: 'saved' };
  const args = { ...ids, message: 'Hello', phone_number: 'old-recipient', lead_id: 'lead', fromApprovedWorkflow: true };
  const h = new History('sendWhatsappFromAgent', senderRun, [args],
    { workflowId: 'approved-offline', runId: supportRun, initiatedId: 10 });
  h.patch('send-whatsapp-outbound-media-v1');
  if (routed) h.patch('whatsapp-saved-text-router-v1');
  h.upsert({ site_id: ['site'], lead_id: ['lead'] });
  h.activity('fetchRecordByTableAndIdActivity', [{ table: 'messages', id: 'saved' }],
    { id: 'saved', conversation_id: 'conversation', content: 'Hello' }, 120, 3, 10);
  const accepted = { message_id: 'saved', status: 'accepted', success: true, connection_id: 'c', provider_message_id: 'external' };
  const legacy = { success: true, messageId: 'external', recipient: 'old-recipient', timestamp: new Date(epoch + 20).toISOString() };
  if (routed) h.activity('sendRoutedWhatsAppTextActivity', [ids], accepted, 120, 1, 10);
  else {
    h.patch('conversation-automation-snooze-v1');
    h.activity('sendWhatsAppFromAgentActivity', [{ ...ids, message: 'Hello', phone_number: 'old-recipient', lead_id: 'lead' }], legacy, 120, 3, 10);
    h.activity('updateMessageStatusToSentActivity', [{}], { success: true }, 120, 3, 10);
    h.activity('updateMessageTimestampActivity', [{}], { success: true }, 120, 3, 10);
  }
  h.activity('updateConversationStatusAfterFollowUpActivity', [{}], { success: true }, 120, 3, 10);
  h.activity('updateTaskStatusToCompletedActivity', [{}], { success: true }, 120, 3, 10);
  return h.close({ result: routed ? { ...accepted, messageId: 'external', executionTime: '40ms', timestamp: new Date(epoch + 40).toISOString() }
    : { ...legacy, executionTime: '20ms' } });
}

function recoveredHistory() {
  const ids = { site_id: 'site', conversation_id: 'conversation', message_id: 'saved' };
  const args = { ...ids, message: 'Hello', phone_number: 'old-recipient' };
  const h = new History('sendWhatsappFromAgent', senderRun, [args],
    { workflowId: 'approved-offline', runId: supportRun, initiatedId: 10 });
  h.patch('send-whatsapp-outbound-media-v1'); h.patch('whatsapp-saved-text-router-v1');
  h.upsert({ site_id: ['site'] });
  h.activity('fetchRecordByTableAndIdActivity', [{ table: 'messages', id: 'saved' }],
    { id: 'saved', conversation_id: 'conversation', content: 'Hello' }, 120, 3, 10);
  h.patch('whatsapp-routed-text-poll-recovery-v1');
  h.activity('sendRoutedWhatsAppTextActivity', [ids], timedOut, 120, 1, 0);
  const accepted = { status: 'accepted', success: true, message_id: 'saved', connection_id: 'A', provider: 'zavu', provider_message_id: 'external' };
  h.activity('readRoutedWhatsAppTextActivity', [ids], accepted, 30, 4, 10);
  return h.close({ result: { ...accepted, messageId: 'external', executionTime: '120020ms', timestamp: new Date(epoch + 120020).toISOString() } });
}

test('pre-router and routed saved-text approval children replay their own dispatch and post-send commands', async () => {
  const logger = new DefaultLogger('ERROR');
  Runtime.install({ logger });
  const workflowBundle = await bundleWorkflowCode({ logger,
    workflowsPath: path.resolve(__dirname, '../src/temporal/workflows/sendWhatsappFromAgentWorkflow.ts') });
  await Worker.runReplayHistory({ workflowBundle }, history(false));
  await Worker.runReplayHistory({ workflowBundle }, history(true));
  await Worker.runReplayHistory({ workflowBundle }, recoveredHistory());
});