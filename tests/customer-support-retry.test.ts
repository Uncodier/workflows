import { ApplicationFailure } from '@temporalio/common';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('../src/temporal/services/apiService', () => ({
  apiService: {
    post: jest.fn(),
  },
}));

import { apiService } from '../src/temporal/services/apiService';
import {
  isUsableCustomerSupportResponse,
  sendCustomerSupportMessageActivity,
} from '../src/temporal/activities/sendCustomerSupportMessageActivity';
import { RETRY_POLICIES } from '../src/temporal/config/timeouts';
import { disabledCustomerSupportResult } from '../src/temporal/workflows/helpers/disabledCustomerSupport';

const mockPost = apiService.post as jest.MockedFunction<typeof apiService.post>;

const inboundMessage = {
  message: 'I need help',
  site_id: 'site-123',
  user_id: 'user-123',
  origin_message_id: 'message-123',
};

describe('customer support retries', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('forwards Zavu attachment metadata unchanged to the support API', async () => {
    const custom_data = { source: 'zavu_inbound_message', attachments: [
      { url: 'https://files.example.test/document.pdf', type: 'document', name: 'document.pdf' },
      { url: 'https://files.example.test/note.ogg', type: 'audio', mimeType: 'audio/ogg' },
    ] };
    mockPost.mockResolvedValue({ success: true, data: { messages: { assistant: { content: 'Document received' } } } });
    await sendCustomerSupportMessageActivity({ ...inboundMessage, custom_data }, { origin: 'whatsapp' });
    expect(mockPost).toHaveBeenCalledWith('/api/agents/customerSupport/message',
      expect.objectContaining({ origin: 'whatsapp', custom_data }));
  });

  it('accepts a non-empty assistant response', () => {
    expect(
      isUsableCustomerSupportResponse({
        messages: { assistant: { content: 'How can I help?' } },
      })
    ).toBe(true);
  });

  it.each([
    undefined,
    {},
    { messages: { assistant: { content: '   ' } } },
    { messages: { assistant: { content: 'No response generated' } } },
    { message: 'This top-level status is not an assistant response' },
    { message: 'NO RESPONSE GENERATED.' },
  ])('rejects unusable assistant output %#', (data) => {
    expect(isUsableCustomerSupportResponse(data)).toBe(false);
  });

  it('throws a retryable failure when the API returns the placeholder', async () => {
    mockPost.mockResolvedValue({
      success: true,
      data: {
        messages: { assistant: { content: 'No response generated' } },
      },
    });

    await expect(
      sendCustomerSupportMessageActivity(inboundMessage, {
        origin: 'website_chat',
        origin_message_id: 'message-123',
      })
    ).rejects.toMatchObject({
      type: 'CUSTOMER_SUPPORT_EMPTY_RESPONSE',
      nonRetryable: false,
    });

    expect(mockPost).toHaveBeenCalledWith(
      '/api/agents/customerSupport/message',
      expect.objectContaining({ origin_message_id: 'message-123' })
    );
  });

  it('marks server failures as retryable', async () => {
    mockPost.mockResolvedValue({
      success: false,
      error: {
        code: 'HTTP_503',
        message: 'Service unavailable',
        status: 503,
      },
    });

    await expect(
      sendCustomerSupportMessageActivity(inboundMessage, { origin: 'website_chat' })
    ).rejects.toMatchObject({
      type: 'CUSTOMER_SUPPORT_API_FAILURE',
      nonRetryable: false,
    });
  });

  it('accepts a persisted inbound message when the agent is disabled without an assistant response', async () => {
    const data = {
      agent_disabled: true,
      response_skipped: true,
      conversation_id: 'conversation-123',
      messages: { user: { message_id: 'user-message-123', content: 'I need help' } },
    };
    mockPost.mockResolvedValue({ success: true, data });

    await expect(sendCustomerSupportMessageActivity(inboundMessage, { origin: 'website_chat' }))
      .resolves.toEqual({ success: true, data });
    expect(disabledCustomerSupportResult(data)).toMatchObject({
      success: true,
      data: { processed: true, emailSent: false, whatsappSent: false, channelMessageSent: false },
    });
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it.each([
    { agent_disabled: true },
    { agent_disabled: true, response_skipped: true },
    { agent_disabled: true, response_skipped: true, conversation_id: 'conversation-123' },
  ])('does not hide an unpersisted empty response %#', async (data) => {
    mockPost.mockResolvedValue({ success: true, data });
    await expect(sendCustomerSupportMessageActivity(inboundMessage, { origin: 'website_chat' }))
      .rejects.toMatchObject({ type: 'CUSTOMER_SUPPORT_EMPTY_RESPONSE' });
  });

  it('marks permanent client failures as non-retryable', async () => {
    mockPost.mockResolvedValue({
      success: false,
      error: {
        code: 'HTTP_400',
        message: 'Invalid request',
        status: 400,
      },
    });

    try {
      await sendCustomerSupportMessageActivity(inboundMessage, { origin: 'website_chat' });
      throw new Error('Expected the activity to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(ApplicationFailure);
      expect(error).toMatchObject({
        type: 'CUSTOMER_SUPPORT_REQUEST_REJECTED',
        nonRetryable: true,
      });
    }
  });

  it('configures one initial attempt and three retries with Temporal duration fields', () => {
    expect(RETRY_POLICIES.CUSTOMER_SUPPORT).toMatchObject({
      maximumAttempts: 4,
      initialInterval: '5 seconds',
      maximumInterval: '1 minute',
      backoffCoefficient: 2,
    });
    expect(RETRY_POLICIES.CUSTOMER_SUPPORT).not.toHaveProperty('initialIntervalMs');
  });
});
