import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockGuidance = jest.fn<(...args: any[]) => Promise<string[]>>();
const mockSend = jest.fn<(...args: any[]) => Promise<any>>();
const mockProcessEmail = jest.fn<(...args: any[]) => Promise<any>>();
const mockPatched = jest.fn<(id: string) => boolean>();
const mockStartChild = jest.fn<(...args: any[]) => Promise<any>>();
const mockGetSiteId = jest.fn<(...args: any[]) => Promise<any>>();
const mockValidateConfig = jest.fn<(...args: any[]) => Promise<any>>();
const mockLeadAttention = jest.fn<(...args: any[]) => Promise<any>>();
const mockNotify = jest.fn<(...args: any[]) => Promise<any>>();

jest.mock('@temporalio/workflow', () => ({
  ...jest.requireActual<typeof import('@temporalio/workflow')>('@temporalio/workflow'),
  proxyActivities: () => ({
    sendCustomerSupportMessageActivity: mockSend,
    processAnalysisDataActivity: mockProcessEmail,
    getSiteIdFromCommandOrConversationActivity: mockGetSiteId,
    validateWorkflowConfigActivity: mockValidateConfig,
    startLeadAttentionWorkflowActivity: mockLeadAttention,
    notifyTeamOnInboundActivity: mockNotify,
  }),
  patched: mockPatched,
  upsertSearchAttributes: jest.fn(),
  startChild: mockStartChild,
  ParentClosePolicy: { PARENT_CLOSE_POLICY_ABANDON: 1 },
}));
jest.mock('../src/temporal/workflows/helpers/runChannelGuidance', () => ({ runChannelGuidance: mockGuidance }));
jest.mock('../src/temporal/workflows/sendEmailFromAgentWorkflow', () => ({ sendEmailFromAgent: jest.fn() }));
jest.mock('../src/temporal/workflows/sendWhatsappFromAgentWorkflow', () => ({ sendWhatsappFromAgent: jest.fn() }));
jest.mock('../src/temporal/workflows/sendChannelMessageFromAgentWorkflow', () => ({ sendChannelMessageFromAgentWorkflow: jest.fn() }));
jest.mock('../src/temporal/workflows/agentSupervisorWorkflow', () => ({ agentSupervisorWorkflow: jest.fn() }));
jest.mock('../src/temporal/workflows/helpers/buildWhatsAppSendParams', () => ({ buildWhatsAppSendParams: () => undefined }));

import { customerSupportMessageWorkflow } from '../src/temporal/workflows/customerSupportWorkflow';
import { channelCustomerSupportMessageWorkflow } from '../src/temporal/workflows/channelCustomerSupportWorkflow';
import { emailCustomerSupportMessageWorkflow } from '../src/temporal/workflows/emailCustomerSupportWorkflow';
import { agentSupervisorWorkflow } from '../src/temporal/workflows/agentSupervisorWorkflow';

beforeEach(() => {
  jest.clearAllMocks();
  mockPatched.mockReturnValue(true);
  mockGuidance.mockResolvedValue(['verified-plan']);
  mockSend.mockResolvedValue({ success: true, data: { messages: { assistant: { content: 'Hi' } } } });
  mockProcessEmail.mockResolvedValue({ shouldProcess: true, reason: 'email requires response' });
  mockValidateConfig.mockResolvedValue({ shouldExecute: true });
  mockGetSiteId.mockResolvedValue({ success: true, site_id: 'resolved-site' });
  mockLeadAttention.mockResolvedValue({ success: true, workflowId: 'lead-attention-1' });
  mockNotify.mockResolvedValue({ success: true });
  mockStartChild.mockResolvedValue({ result: async () => ({ success: true }) });
});

describe('customer-support entry branches await channel guidance', () => {
  it('website request invokes guidance before the customer-support response', async () => {
    const data = { site_id: 'site-1', origin_message_id: 'message-1', message: 'Help' };
    await customerSupportMessageWorkflow(data, { origin: 'website_chat' });
    expect(mockGuidance).toHaveBeenCalledWith(data, { origin: 'website_chat', agentId: undefined, origin_message_id: 'message-1' });
    expect(mockSend).toHaveBeenCalledWith(
      { ...data, channel_guidance_run_plan_ids: ['verified-plan'] },
      expect.objectContaining({ origin: 'website_chat' }),
    );
    expect(mockGuidance.mock.invocationCallOrder[0]).toBeLessThan(mockSend.mock.invocationCallOrder[0]);
  });

  it('WhatsApp provider request passes the stable inbound provider ID to guidance', async () => {
    const data = { whatsappData: {
      siteId: 'site-1', messageId: 'provider-id', messageContent: 'Hello',
      phoneNumber: '+1234567890', userId: 'user-1',
    } };
    await customerSupportMessageWorkflow(data, { origin: 'whatsapp' });
    expect(mockGuidance).toHaveBeenCalledWith(data, expect.objectContaining({ origin: 'whatsapp' }));
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ channel_guidance_run_plan_ids: ['verified-plan'], origin_message_id: 'provider-id' }),
      expect.objectContaining({ origin: 'whatsapp' }),
    );
    expect(mockGetSiteId).not.toHaveBeenCalled();
    expect(mockValidateConfig).not.toHaveBeenCalled();
    expect(mockStartChild).not.toHaveBeenCalled();
  });

  it.each([false, true])('WhatsApp supervisor preserves its commands with guidance patch = %s', async enabled => {
    mockPatched.mockReturnValue(enabled);
    mockSend.mockResolvedValue({ success: true, data: {
      command_id: 'command-1', conversation_id: 'conversation-1', site_id: 'response-site',
    } });
    const data = { whatsappData: {
      siteId: 'input-site', messageId: 'provider-id', messageContent: 'Hello',
      phoneNumber: '+1234567890', userId: 'user-1',
    } };
    await expect(customerSupportMessageWorkflow(data, { origin: 'whatsapp' }))
      .resolves.toMatchObject({ success: true, data: { processed: true } });
    expect(mockValidateConfig).toHaveBeenCalledWith('response-site', 'supervise_conversations');
    expect(mockGetSiteId).not.toHaveBeenCalled();
    expect(mockStartChild).toHaveBeenCalledTimes(1);
    expect(mockStartChild).toHaveBeenCalledWith(agentSupervisorWorkflow, {
      args: [{ command_id: 'command-1', conversation_id: 'conversation-1' }],
      workflowId: expect.stringMatching(/^agent-supervisor-command-1-\d+$/),
      taskQueue: 'high', parentClosePolicy: 1,
    });
    expect(mockValidateConfig.mock.invocationCallOrder[0]).toBeLessThan(mockStartChild.mock.invocationCallOrder[0]);
    if (enabled) {
      expect(mockGuidance).toHaveBeenCalledTimes(1);
    } else {
      expect(mockGuidance).not.toHaveBeenCalled();
      expect(mockSend.mock.calls[0][0]).not.toHaveProperty('channel_guidance_run_plan_ids');
      expect(mockSend.mock.calls[0][0]).not.toHaveProperty('origin_message_id');
    }
  });

  it('does not start the WhatsApp supervisor when the activity is disabled', async () => {
    mockSend.mockResolvedValue({ success: true, data: { conversation_id: 'conversation-1' } });
    mockValidateConfig.mockResolvedValue({ shouldExecute: false, reason: 'disabled' });
    await customerSupportMessageWorkflow({ whatsappData: {
      siteId: 'input-site', messageId: 'provider-id', phoneNumber: '+1234567890',
    } }, { origin: 'whatsapp' });
    expect(mockValidateConfig).toHaveBeenCalledWith('input-site', 'supervise_conversations');
    expect(mockStartChild).not.toHaveBeenCalled();
  });

  it('resolves the WhatsApp supervisor site from the response identifiers if necessary', async () => {
    mockSend.mockResolvedValue({ success: true, data: { command_id: 'command-1' } });
    await customerSupportMessageWorkflow({ whatsappData: {
      messageId: 'provider-id', phoneNumber: '+1234567890',
    } }, { origin: 'whatsapp' });
    expect(mockGetSiteId).toHaveBeenCalledWith({ command_id: 'command-1', conversation_id: undefined });
    expect(mockValidateConfig).toHaveBeenCalledWith('resolved-site', 'supervise_conversations');
    expect(mockStartChild).toHaveBeenCalledTimes(1);
  });

  it('social and channel-delivery email both invoke guidance before sending', async () => {
    for (const origin of ['instagram', 'email']) {
      const data = { site_id: 'site-1', message: 'Hello', origin_message_id: `${origin}-id`, require_approval: true };
      await channelCustomerSupportMessageWorkflow(data, { origin });
      expect(mockGuidance).toHaveBeenLastCalledWith(data, { origin });
      expect(mockSend).toHaveBeenLastCalledWith(
        expect.objectContaining({ channel_guidance_run_plan_ids: ['verified-plan'], origin_message_id: `${origin}-id` }),
        { origin },
      );
    }
  });

  it('infers email origin when omitted in legacy email analysis', async () => {
    const data = {
      summary: 'Help', site_id: 'site-1', user_id: 'user-1', lead_notification: 'email',
      origin_message_id: 'email-2', contact_info: { name: 'Customer', email: '', phone: '', company: '' },
    };
    await emailCustomerSupportMessageWorkflow(data, {});
    expect(mockGuidance).toHaveBeenCalledWith(data, { origin: 'email' });
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ channel_guidance_run_plan_ids: ['verified-plan'] }),
      { origin: 'email' });
  });

  it('direct email branch processes first, then guides, then requests customer support', async () => {
    const data = {
      summary: 'Help', site_id: 'site-1', user_id: 'user-1', lead_notification: 'email',
      origin_message_id: 'email-provider-1', contact_info: { name: 'Customer', email: '', phone: '', company: '' },
    };
    await emailCustomerSupportMessageWorkflow(data, { origin: 'email' });
    expect(mockProcessEmail.mock.invocationCallOrder[0]).toBeLessThan(mockGuidance.mock.invocationCallOrder[0]);
    expect(mockGuidance.mock.invocationCallOrder[0]).toBeLessThan(mockSend.mock.invocationCallOrder[0]);
    expect(mockSend).toHaveBeenCalledWith(
      { ...data, channel_guidance_run_plan_ids: ['verified-plan'] }, { origin: 'email' },
    );
  });
});
