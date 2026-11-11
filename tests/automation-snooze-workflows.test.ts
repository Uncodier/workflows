const mockActivities: Record<string, jest.Mock> = new Proxy({}, { get: (target: any, key: string) => target[key] ||= jest.fn() });
const mockStartChild = jest.fn();
const mockSleep = jest.fn();
const mockPatched = jest.fn(() => true);
jest.mock('@temporalio/workflow', () => ({
  ...jest.requireActual('@temporalio/workflow'), proxyActivities: () => mockActivities,
  patched: mockPatched, startChild: mockStartChild, sleep: mockSleep,
  upsertSearchAttributes: jest.fn(),
}));
jest.mock('../src/temporal/workflows/helpers/channelGuidanceVersion', () => ({ channelGuidanceEnabled: () => false }));
import { customerSupportMessageWorkflow } from '../src/temporal/workflows/customerSupportWorkflow';
import { emailCustomerSupportMessageWorkflow } from '../src/temporal/workflows/emailCustomerSupportWorkflow';
import { channelCustomerSupportMessageWorkflow } from '../src/temporal/workflows/channelCustomerSupportWorkflow';
import { sendEmailFromAgent } from '../src/temporal/workflows/sendEmailFromAgentWorkflow';
import { sendWhatsappFromAgent } from '../src/temporal/workflows/sendWhatsappFromAgentWorkflow';
import { sendChannelMessageFromAgentWorkflow } from '../src/temporal/workflows/sendChannelMessageFromAgentWorkflow';
import { sendApprovedMessagesWorkflow } from '../src/temporal/workflows/sendApprovedMessagesWorkflow';

const skip = { success: true, skipped: true, reason: 'agent_snoozed', automation_paused: true,
  automation_paused_until: '2030-01-01T16:00:00Z', conversation_id: 'conversation', delivered: false };
const data = { ...skip, messages: { user: { message_id: 'inbound' } } };
const email: any = { summary: 'Help', original_text: 'Help', site_id: 'site', user_id: 'user',
  contact_info: { email: 'lead@example.test', name: 'Lead' }, analysis_id: 'analysis', conversation_id: 'conversation' };
const outbound = { site_id: 'site', conversation_id: 'conversation', message_id: 'message', message: 'Reply',
  email: 'lead@example.test', subject: 'Reply', phone_number: 'recipient', channel: 'whatsapp', to: 'recipient' };
beforeEach(() => {
  jest.resetAllMocks(); mockPatched.mockReturnValue(true);
  mockActivities.sendCustomerSupportMessageActivity.mockResolvedValue({ success: true, data });
  mockActivities.processAnalysisDataActivity.mockResolvedValue({ shouldProcess: true, processedData: email });
  mockActivities.validateWorkflowConfigActivity.mockResolvedValue({ shouldProceed: true, isValid: true });
  mockActivities.fetchRecordByTableAndIdActivity.mockResolvedValue({ content: 'Reply' });
});
test.each([
  () => customerSupportMessageWorkflow({ message: 'Help', site_id: 'site' }, { origin: 'website_chat' }),
  () => customerSupportMessageWorkflow({ whatsappData: { message: 'Help', siteId: 'site', phoneNumber: 'recipient', userId: 'user' } }, { origin: 'whatsapp' }),
  () => emailCustomerSupportMessageWorkflow(email, { origin: 'email' }),
  () => channelCustomerSupportMessageWorkflow({ message: 'Help', site_id: 'site', phone: 'recipient' }, { origin: 'telegram' }),
])('support branch %# returns successful terminal skipped without sends, supervisor or failure logs', async run => {
  expect(await run()).toMatchObject({ success: true, data: { skipped: true, reason: 'agent_snoozed',
    emailSent: false, whatsappSent: false, channelMessageSent: false } });
  expect(mockStartChild).not.toHaveBeenCalled();
  expect(mockActivities.startLeadAttentionWorkflowActivity).not.toHaveBeenCalled();
  expect(mockActivities.updateTaskStatusToCompletedActivity).not.toHaveBeenCalled();
  expect(mockActivities.logWorkflowExecutionActivity).not.toHaveBeenCalled();
});
test.each(['email', 'whatsapp', 'channel'])('%s skipped send never writes sent status or sleeps', async kind => {
  mockActivities.sendEmailFromAgentActivity.mockResolvedValue(skip);
  mockActivities.sendWhatsAppFromAgentActivity.mockResolvedValue(skip);
  mockActivities.sendChannelMessageFromAgentActivity.mockResolvedValue(skip);
  const result = kind === 'email' ? await sendEmailFromAgent(outbound)
    : kind === 'whatsapp' ? await sendWhatsappFromAgent(outbound)
      : await sendChannelMessageFromAgentWorkflow({ ...outbound, response_format: 'audio' });
  expect(result).toMatchObject({ success: true, skipped: true, delivered: false });
  expect(mockActivities.updateMessageStatusToSentActivity).not.toHaveBeenCalled();
  expect(mockActivities.createTemplateActivity).not.toHaveBeenCalled();
  expect(mockSleep).not.toHaveBeenCalled();
});
test('template pending poll sees new snooze and terminates without receipt validation or another timer', async () => {
  mockActivities.sendChannelMessageFromAgentActivity.mockResolvedValueOnce({ success: true, status: 'template_pending',
    template_pending: true, delivery_format: 'template', requested_response_format: 'audio',
    message_id: 'message', template_id: 'template' }).mockResolvedValueOnce(skip);
  expect(await sendChannelMessageFromAgentWorkflow({ ...outbound, response_format: 'audio' })).toMatchObject({ skipped: true });
  expect(mockSleep).toHaveBeenCalledTimes(1);
  expect(mockActivities.sendChannelMessageFromAgentActivity).toHaveBeenCalledTimes(2);
  expect(mockActivities.markTemplateReconciliationRequiredActivity).not.toHaveBeenCalled();
});
test('legacy WhatsApp template send snooze does not retry or mark sent', async () => {
  mockActivities.sendWhatsAppFromAgentActivity.mockResolvedValue({ success: true, messageId: 'message', template_required: true });
  mockActivities.createTemplateActivity.mockResolvedValue({ success: true, template_id: 'template' });
  mockActivities.sendTemplateActivity.mockResolvedValue(skip);
  expect(await sendWhatsappFromAgent(outbound)).toMatchObject({ skipped: true });
  expect(mockActivities.sendTemplateActivity).toHaveBeenCalledTimes(1);
  expect(mockSleep).toHaveBeenCalledTimes(1); // Existing initial template wait, never wait for snooze expiry.
  expect(mockActivities.updateMessageStatusToSentActivity).not.toHaveBeenCalled();
});
test('approved preflight skips without dispatch, defer, retry or sent side-effects', async () => {
  mockActivities.resetStuckSendingMessagesActivity.mockResolvedValue({ resetCount: 0 });
  mockActivities.getApprovedMessagesActivity.mockResolvedValue([{ ...outbound, content: 'Reply', lead_email: outbound.email, custom_data: { channel: 'email' } }]);
  mockActivities.claimApprovedMessagesBatchActivity.mockResolvedValue(['message']);
  mockActivities.checkConversationAutomationActivity.mockResolvedValue(skip);
  expect(await sendApprovedMessagesWorkflow()).toMatchObject({ success: 0, failed: 0, skipped: 1 });
  expect(mockActivities.sendEmailFromAgentActivity).not.toHaveBeenCalled();
  expect(mockActivities.deferOutreachMessageActivity).not.toHaveBeenCalled();
  expect(mockActivities.cleanupFailedFollowUpActivity).not.toHaveBeenCalled();
  expect(mockActivities.updateMessageStatusToSentActivity).not.toHaveBeenCalled();
  expect(mockStartChild).not.toHaveBeenCalled();
});
test('new WhatsApp histories preserve saved identity even without explicit response format', async () => {
  mockActivities.sendWhatsAppFromAgentActivity.mockResolvedValue(skip);
  await sendWhatsappFromAgent(outbound);
  expect(mockActivities.sendWhatsAppFromAgentActivity).toHaveBeenCalledWith(expect.objectContaining({ message_id: 'message' }));
});