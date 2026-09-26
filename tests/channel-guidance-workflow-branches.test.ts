import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockGuidance = jest.fn<(...args: any[]) => Promise<string[]>>();
const mockSend = jest.fn<(...args: any[]) => Promise<any>>();
const mockProcessEmail = jest.fn<(...args: any[]) => Promise<any>>();

jest.mock('@temporalio/workflow', () => ({
  proxyActivities: () => ({
    sendCustomerSupportMessageActivity: mockSend,
    processAnalysisDataActivity: mockProcessEmail,
  }),
  upsertSearchAttributes: jest.fn(),
  startChild: jest.fn(),
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

beforeEach(() => {
  jest.clearAllMocks();
  mockGuidance.mockResolvedValue(['verified-plan']);
  mockSend.mockResolvedValue({ success: true, data: { messages: { assistant: { content: 'Hi' } } } });
  mockProcessEmail.mockResolvedValue({ shouldProcess: true, reason: 'email requires response' });
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
