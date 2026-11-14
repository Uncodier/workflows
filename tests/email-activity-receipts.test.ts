jest.mock('../src/temporal/activities/automationSnoozeActivities', () => ({
  checkConversationAutomationActivity: jest.fn(async () => ({ success: true })),
}));
jest.mock('../src/temporal/services/apiService', () => ({ apiService: { post: jest.fn() } }));
import { apiService } from '../src/temporal/services/apiService';
import { checkConversationAutomationActivity } from '../src/temporal/activities/automationSnoozeActivities';
import { sendEmailFromAgentActivity } from '../src/temporal/activities/emailActivities';

const post = apiService.post as jest.Mock;
const guard = checkConversationAutomationActivity as jest.Mock;
const params = { site_id: 'site', email: 'recipient@example.test', subject: 'File', message: '',
  message_id: 'saved-message', message_type: 'document' as const,
  media_url: 'https://assets.example.test/a.pdf', mime_type: 'application/pdf' };
beforeEach(() => { jest.clearAllMocks(); guard.mockResolvedValue({ success: true }); });

it.each([
  { messageId: 'legacy-receipt' },
  { success: true, status: 'sent', external_message_id: 'agentmail-receipt', email_id: 'agentmail-receipt' },
  { success: true, status: 'sent', email_id: '<smtp-receipt@example.test>' },
  { success: true, status: 'sent', envelope_id: 'envelope-receipt' },
])('normalizes real provider receipt shapes: %j', async data => {
  post.mockResolvedValue({ success: true, data });
  const receipt = Object.values(data).find(value => typeof value === 'string' && value !== 'sent');
  await expect(sendEmailFromAgentActivity(params)).resolves.toMatchObject({ success: true, messageId: receipt, external_message_id: receipt });
  expect(post).toHaveBeenCalledWith('/api/agents/tools/sendEmail', expect.objectContaining(params));
});

it.each([
  {}, { success: true }, { success: true, message_id: 'saved-message' },
  { success: true, email_id: '  ' }, { success: true, messageId: 'unknown' },
  { success: false, email_id: 'unaccepted-receipt' },
])('rejects missing or unaccepted media receipts nonretryably: %j', async data => {
  post.mockResolvedValue({ success: true, data });
  await expect(sendEmailFromAgentActivity(params)).rejects.toMatchObject({ nonRetryable: true, type: 'MEDIA_DELIVERY_FAILED_OR_UNKNOWN' });
  expect(post).toHaveBeenCalledTimes(1);
});

it('respects provider skip without requiring a receipt or implying delivery', async () => {
  post.mockResolvedValue({ success: true, data: { success: false, skipped: true, reason: 'agent_snoozed', email_id: 'not-a-delivery' } });
  await expect(sendEmailFromAgentActivity(params)).resolves.toMatchObject({ skipped: true, delivered: false, reason: 'agent_snoozed', messageId: '', external_message_id: undefined });
});
it('respects pre-send automation skip without contacting the provider', async () => {
  guard.mockResolvedValue({ success: true, skipped: true, delivered: false, reason: 'agent_snoozed' });
  await expect(sendEmailFromAgentActivity(params)).resolves.toMatchObject({ skipped: true, delivered: false, messageId: '' });
  expect(post).not.toHaveBeenCalled();
});
