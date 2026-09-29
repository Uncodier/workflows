const mockActivities: Record<string, jest.Mock> = {
  resetStuckSendingMessagesActivity: jest.fn(), getApprovedMessagesActivity: jest.fn(),
  claimApprovedMessagesBatchActivity: jest.fn(), sendOutreachMessageActivity: jest.fn(),
  deferOutreachMessageActivity: jest.fn(), sendEmailFromAgentActivity: jest.fn(),
  updateMessageStatusToSentActivity: jest.fn(), updateMessageTimestampActivity: jest.fn(),
  updateConversationStatusAfterFollowUpActivity: jest.fn(), updateTaskStatusToCompletedActivity: jest.fn(),
  cleanupFailedFollowUpActivity: jest.fn(),
};
jest.mock('@temporalio/workflow', () => ({
  proxyActivities: () => mockActivities, patched: () => true,
  startChild: jest.fn(), ParentClosePolicy: {},
}));
jest.mock('../src/temporal/workflows/sendWhatsappFromAgentWorkflow', () => ({ sendWhatsappFromAgent: jest.fn() }));
jest.mock('../src/temporal/workflows/sendChannelMessageFromAgentWorkflow', () => ({ sendChannelMessageFromAgentWorkflow: jest.fn() }));
jest.mock('../src/temporal/workflows/sendVoiceCallFromAgentWorkflow', () => ({ sendVoiceCallFromAgentWorkflow: jest.fn() }));
import { sendApprovedMessagesWorkflow } from '../src/temporal/workflows/sendApprovedMessagesWorkflow';

describe('approved outreach dispatch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockActivities.resetStuckSendingMessagesActivity.mockResolvedValue({ resetCount: 0 });
    mockActivities.claimApprovedMessagesBatchActivity.mockResolvedValue(['message']);
    mockActivities.getApprovedMessagesActivity.mockResolvedValue([{
      message_id: 'message', conversation_id: 'conversation', site_id: 'site', lead_id: 'lead',
      lead_email: 'lead@example.com', lead_phone: '+15555550123', content: 'Hello there',
      custom_data: { channel: 'email', outreach_activity: 'leads_initial_cold_outreach' },
    }]);
  });

  it('uses the configured sender instead of the legacy default email sender', async () => {
    mockActivities.sendOutreachMessageActivity.mockResolvedValue({ success: true, messageId: 'sent-id' });
    await expect(sendApprovedMessagesWorkflow()).resolves.toMatchObject({ success: 1, failed: 0, deferred: 0 });
    expect(mockActivities.sendEmailFromAgentActivity).not.toHaveBeenCalled();
    expect(mockActivities.sendOutreachMessageActivity).toHaveBeenCalledWith({ site_id: 'site', message_id: 'message' });
    expect(mockActivities.updateMessageStatusToSentActivity).toHaveBeenCalledWith(expect.objectContaining({ delivery_success: true }));
  });

  it('releases a capped message for later without failing or invalidating its lead', async () => {
    mockActivities.sendOutreachMessageActivity.mockResolvedValue({ success: false, deferred: true, reason: 'Daily cap reached' });
    await expect(sendApprovedMessagesWorkflow()).resolves.toMatchObject({ success: 0, failed: 0, deferred: 1 });
    expect(mockActivities.deferOutreachMessageActivity).toHaveBeenCalledWith(expect.objectContaining({ message_id: 'message', reason: 'Daily cap reached' }));
    expect(mockActivities.cleanupFailedFollowUpActivity).not.toHaveBeenCalled();
    expect(mockActivities.updateMessageStatusToSentActivity).not.toHaveBeenCalled();
  });

  it('routes historical automatic followups through the same policy instead of bypassing it', async () => {
    mockActivities.getApprovedMessagesActivity.mockResolvedValue([{
      message_id: 'message', conversation_id: 'conversation', site_id: 'site', lead_id: 'lead',
      content: 'Checking in', custom_data: { channel: 'whatsapp', follow_up_type: 'lead_nurture' },
    }]);
    mockActivities.sendOutreachMessageActivity.mockResolvedValue({ success: true });
    await expect(sendApprovedMessagesWorkflow()).resolves.toMatchObject({ success: 1 });
    expect(mockActivities.updateMessageStatusToSentActivity).toHaveBeenCalledWith(expect.objectContaining({ delivery_channel: 'whatsapp' }));
  });

  it.each(['sms', 'telegram', 'voice', 'custom_agent'])('dispatches managed %s via the shared account and budget guard', async channel => {
    mockActivities.getApprovedMessagesActivity.mockResolvedValue([{
      message_id: 'message', conversation_id: 'conversation', site_id: 'site', lead_id: 'lead',
      content: 'Hello there', custom_data: { channel, outreach_activity: 'leads_follow_up' },
    }]);
    mockActivities.sendOutreachMessageActivity.mockResolvedValue({ success: true, recipient: 'verified-channel-recipient', messageId: 'provider-id' });
    await expect(sendApprovedMessagesWorkflow()).resolves.toMatchObject({ success: 1 });
    if (channel === 'voice') {
      expect(mockActivities.updateMessageStatusToSentActivity).not.toHaveBeenCalled();
      expect(mockActivities.updateMessageTimestampActivity).not.toHaveBeenCalled();
    } else {
      expect(mockActivities.updateMessageStatusToSentActivity).toHaveBeenCalledWith(expect.objectContaining({
        delivery_channel: channel, delivery_details: expect.objectContaining({ recipient: 'verified-channel-recipient' }),
      }));
    }
    expect(mockActivities.sendEmailFromAgentActivity).not.toHaveBeenCalled();
  });
});