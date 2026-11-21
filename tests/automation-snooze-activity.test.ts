const mockFrom = jest.fn();
const mockPost = jest.fn();
jest.mock('../src/lib/supabase/client', () => ({ supabaseServiceRole: { from: mockFrom } }));
jest.mock('../src/temporal/services/apiService', () => ({ apiService: { post: mockPost } }));
import { automationSkipReason, isSnoozedCustomerSupportResult } from '../src/temporal/utils/automationSnooze';
import { checkConversationAutomationActivity } from '../src/temporal/activities/automationSnoozeActivities';
import { sendCustomerSupportMessageActivity } from '../src/temporal/activities/sendCustomerSupportMessageActivity';
import { sendChannelMessageFromAgentActivity, placeVoiceCallFromAgentActivity } from '../src/temporal/activities/channelActivities';
import { sendEmailFromAgentActivity } from '../src/temporal/activities/emailActivities';
import { sendWhatsAppFromAgentActivity, sendTemplateActivity, sendWhatsAppResponseActivity } from '../src/temporal/activities/whatsappActivities';
import { sendExactQueuedMessageActivity } from '../src/temporal/activities/exactDeliveryActivities';
import { sendOutreachMessageActivity } from '../src/temporal/activities/outreachDeliveryActivities';

const now = Date.parse('2030-01-01T12:00:00Z');
const conversation = { id: 'conversation', automation_paused_until: '2030-01-01T16:00:00Z', last_human_reply_at: null };
const message = { id: 'message', conversation_id: 'conversation', role: 'assistant',
  created_at: '2030-01-01T11:00:00Z', updated_at: '2030-01-01T11:00:00Z', custom_data: { status: 'sending', keep: 'metadata' } };
const identity = { site_id: 'site', conversation_id: 'conversation', message_id: 'message' };
const skipped = { automation_paused: true, skipped: true, reason: 'agent_snoozed',
  automation_paused_until: conversation.automation_paused_until, conversation_id: 'conversation',
  messages: { user: { message_id: 'inbound' } } };

function query(data: any, error: any = null) {
  const q: any = { select: jest.fn(() => q), eq: jest.fn(() => q), update: jest.fn(() => q),
    maybeSingle: jest.fn(async () => ({ data, error })),
    then: (resolve: any) => Promise.resolve({ data, error }).then(resolve) };
  return q;
}
function rows(saved: any = message, convo: any = conversation) {
  const readMessage = query(saved), readConversation = query(convo), update = query([{ id: 'message' }]);
  mockFrom.mockReturnValueOnce(readMessage).mockReturnValueOnce(readConversation).mockReturnValueOnce(update);
  return { readMessage, readConversation, update };
}
beforeEach(() => { jest.clearAllMocks(); mockFrom.mockReset(); jest.spyOn(Date, 'now').mockReturnValue(now); });
afterEach(() => jest.restoreAllMocks());

test('accepts API terminal snooze without assistant content; does not retry', async () => {
  mockPost.mockResolvedValue({ success: true, data: skipped });
  expect(await sendCustomerSupportMessageActivity({ message: 'Help', site_id: 'site' }, {}))
    .toEqual({ success: true, data: skipped });
  expect(mockPost).toHaveBeenCalledTimes(1);
  expect(isSnoozedCustomerSupportResult({ ...skipped, reason: 'unrelated' })).toBe(false);
  expect(isSnoozedCustomerSupportResult({ ...skipped, messages: {} })).toBe(false);
});
test('missing assistant without explicit skip remains retryable', async () => {
  mockPost.mockResolvedValue({ success: true, data: { ...skipped, skipped: false } });
  await expect(sendCustomerSupportMessageActivity({ message: 'Help', site_id: 'site' }, {}))
    .rejects.toMatchObject({ type: 'CUSTOMER_SUPPORT_EMPTY_RESPONSE', nonRetryable: false });
});
test('previously suppressed inbound remains terminal after manual resume / zero-hour intervention', async () => {
  const resumed = { ...skipped, automation_paused_until: null };
  mockPost.mockResolvedValue({ success: true, data: resumed });
  expect(await sendCustomerSupportMessageActivity({ message: 'Help', site_id: 'site' }, {}))
    .toEqual({ success: true, data: resumed });
  expect(isSnoozedCustomerSupportResult({ ...skipped, automation_paused_until: 'invalid' })).toBe(false);
});
test.each(['team_member', 'user', 'system'])('only assistants are blocked: persisted %s is permitted', async role => {
  const { update, readConversation } = rows({ ...message, role });
  expect(await checkConversationAutomationActivity(identity)).toEqual({ success: true });
  expect(update.update).not.toHaveBeenCalled();
  expect(readConversation.eq).toHaveBeenCalledWith('site_id', 'site');
});
test('terminally marks saved assistant and preserves other metadata', async () => {
  const { update } = rows();
  expect(await checkConversationAutomationActivity(identity)).toMatchObject({ success: true, skipped: true, delivered: false, reason: 'agent_snoozed' });
  expect(update.update).toHaveBeenCalledWith(expect.objectContaining({ custom_data: expect.objectContaining({
    keep: 'metadata', status: 'skipped', automation_skipped: true, automation_skip_reason: 'agent_snoozed',
  }) }));
  expect(update.eq).toHaveBeenCalledWith('role', 'assistant');
  expect(update.eq).toHaveBeenCalledWith('custom_data', JSON.stringify(message.custom_data));
  expect(update.eq).toHaveBeenCalledWith('updated_at', message.updated_at);
});
test('stale generation stays blocked after pause expiry, including generation crossing human reply', async () => {
  rows({ ...message, created_at: '2030-01-01T11:30:00Z', custom_data: { automation_started_at: '2030-01-01T09:00:00Z' } },
    { ...conversation, automation_paused_until: null, last_human_reply_at: '2030-01-01T10:00:00Z' });
  expect(await checkConversationAutomationActivity(identity)).toMatchObject({ skipped: true, reason: 'stale_automatic_reply' });
  expect(automationSkipReason({ last_human_reply_at: '2030-01-01T11:00:00Z' }, message, now)).toBe('stale_automatic_reply');
  expect(automationSkipReason({ last_human_reply_at: '2030-01-01T10:00:00Z' }, message, now)).toBeUndefined();
});
test('terminal marker remains suppressed after expiry even without human timestamp', () => {
  expect(automationSkipReason({}, { ...message, custom_data: { automation_skipped: true } }, now)).toBe('agent_snoozed');
  expect(automationSkipReason({ automation_paused_until: new Date(now).toISOString() }, message, now)).toBeUndefined();
});
test('missing row, tenant scope failure and CAS conflict fail closed', async () => {
  rows(null);
  await expect(checkConversationAutomationActivity(identity)).rejects.toThrow('saved message');
  mockFrom.mockReset(); rows(message, null);
  await expect(checkConversationAutomationActivity(identity)).rejects.toThrow('conversation for site');
  mockFrom.mockReset(); mockFrom.mockReturnValueOnce(query(message)).mockReturnValueOnce(query(conversation)).mockReturnValueOnce(query([]));
  await expect(checkConversationAutomationActivity(identity)).rejects.toThrow('terminal suppression');
});
test('message/conversation mismatch is rejected', async () => {
  rows({ ...message, conversation_id: 'another' });
  await expect(checkConversationAutomationActivity(identity)).rejects.toThrow('mismatch');
});
test.each([
  () => sendChannelMessageFromAgentActivity({ ...identity, channel: 'whatsapp', to: 'recipient', message: 'Reply', response_format: 'audio' }),
  () => sendEmailFromAgentActivity({ ...identity, email: 'lead@example.test', subject: 'Reply', message: 'Reply' }),
  () => sendWhatsAppFromAgentActivity({ ...identity, phone_number: 'recipient', message: 'Reply' }),
  () => sendTemplateActivity({ ...identity, phone_number: 'recipient', template_id: 'template' }),
  () => sendExactQueuedMessageActivity({ ...identity, channel: 'whatsapp', response_format: 'audio' }),
  () => sendOutreachMessageActivity(identity),
  () => placeVoiceCallFromAgentActivity({ ...identity, to: 'recipient', message: 'Reply', lead_id: 'lead' }),
  () => sendWhatsAppResponseActivity({ ...identity, phone: 'recipient', message: 'Reply', user_id: 'user' }),
])('dispatch path %# skips before any HTTP side effect', async send => {
  rows();
  expect(await send()).toMatchObject({ success: true, skipped: true });
  expect(mockPost).not.toHaveBeenCalled();
});
test('saved team member send reaches provider despite active snooze', async () => {
  rows({ ...message, role: 'team_member' });
  mockPost.mockResolvedValue({ success: true, data: { messageId: 'provider' } });
  expect(await sendEmailFromAgentActivity({ ...identity, email: 'lead@example.test', subject: 'Reply', message: 'Reply' }))
    .toMatchObject({ success: true, messageId: 'provider' });
  expect(mockPost).toHaveBeenCalledTimes(1);
});

test.each(['attempting','accepted','failed'])('a later pause cannot turn an existing %s channel attempt into a skipped receipt',async state=>{
  const {update} = rows({...message,custom_data:{status:'reconciliation_required',pinned_text_delivery:{state}}});
  await expect(checkConversationAutomationActivity(identity)).rejects.toThrow('reconcile');
  expect(update.update).not.toHaveBeenCalled();
});
