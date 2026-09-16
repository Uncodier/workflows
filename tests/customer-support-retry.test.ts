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
