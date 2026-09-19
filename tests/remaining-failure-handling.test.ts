import { ApplicationFailure } from '@temporalio/common';
import { createChannelApiFailure } from '../src/temporal/activities/channelActivities';
import { buildUnprocessableMessageCustomData } from '../src/temporal/activities/messageActivities';
import { validVisitorId } from '../src/temporal/activities/sendCustomerSupportMessageActivity';
import { performEarlyValidation } from '../src/temporal/workflows/leadFollowUp/validation';

describe('remaining failure handling', () => {
  it('keeps channel server failures retryable', () => {
    const failure = createChannelApiFailure('linkedin', {
      code: 'HTTP_500',
      message: 'Outstand unavailable',
      status: 500,
    });

    expect(failure).toMatchObject({
      type: 'CHANNEL_API_FAILURE',
      nonRetryable: false,
    });
  });

  it('does not retry rejected channel requests', () => {
    const failure = createChannelApiFailure('linkedin', {
      code: 'HTTP_400',
      message: 'Invalid post',
      status: 400,
    });

    expect(failure).toMatchObject({
      type: 'CHANNEL_REQUEST_REJECTED',
      nonRetryable: true,
    });
  });

  it('only forwards UUID visitor identifiers', () => {
    expect(validVisitorId('social-linkedin-user-123')).toBeUndefined();
    expect(validVisitorId(' 550e8400-e29b-41d4-a716-446655440000 ')).toBe(
      '550e8400-e29b-41d4-a716-446655440000'
    );
  });

  it('moves unprocessable approved messages to a terminal failed state', () => {
    expect(
      buildUnprocessableMessageCustomData(
        { status: 'accepted', existing: true },
        'Conversation missing-id not found'
      )
    ).toMatchObject({
      status: 'failed',
      command_status: 'failed',
      existing: true,
      error_message: 'Conversation missing-id not found',
      delivery: {
        success: false,
        details: { error: 'Conversation missing-id not found' },
      },
    });
  });

  it('continues when contact validation explicitly allows fail-open behavior', async () => {
    const activities = {
      validateContactInformation: jest.fn().mockResolvedValue({
        success: false,
        isValid: false,
        shouldProceed: true,
        validationType: 'email',
        error: 'Email verifier returned unknown status',
        reason: 'Validation service failed, proceeding with send',
      }),
      validateCommunicationChannelsActivity: jest.fn(),
      invalidateEmailOnlyActivity: jest.fn(),
      saveCronStatusActivity: jest.fn(),
      logWorkflowExecutionActivity: jest.fn(),
    };

    const result = await performEarlyValidation({
      lead_id: 'lead-id',
      site_id: 'site-id',
      leadInfo: {
        email: 'lead@example.com',
        phone: '+15555550100',
        metadata: {},
      },
      options: {
        lead_id: 'lead-id',
        site_id: 'site-id',
      },
      site: {
        name: 'Example site',
        url: 'https://example.com',
        user_id: 'user-id',
      },
      activities,
      startTime: Date.now(),
      workflowId: 'workflow-id',
    });

    expect(result).toMatchObject({
      shouldReturn: false,
      emailInvalidatedInEarlyValidation: false,
      errors: [
        'Contact validation unavailable: Email verifier returned unknown status',
      ],
    });
    expect(activities.saveCronStatusActivity).not.toHaveBeenCalled();
  });

  it('creates a terminal validation failure when fail-open is disabled', async () => {
    const activities = {
      validateContactInformation: jest.fn().mockResolvedValue({
        success: false,
        isValid: false,
        shouldProceed: false,
        validationType: 'email',
        error: 'Validation rejected',
        reason: 'Validation rejected',
      }),
      validateCommunicationChannelsActivity: jest.fn(),
      invalidateEmailOnlyActivity: jest.fn(),
      saveCronStatusActivity: jest.fn().mockResolvedValue(undefined),
      logWorkflowExecutionActivity: jest.fn().mockResolvedValue(undefined),
    };

    await expect(
      performEarlyValidation({
        lead_id: 'lead-id',
        site_id: 'site-id',
        leadInfo: {
          email: 'lead@example.com',
          phone: '+15555550100',
          metadata: {},
        },
        options: {
          lead_id: 'lead-id',
          site_id: 'site-id',
        },
        site: {
          name: 'Example site',
          url: 'https://example.com',
          user_id: 'user-id',
        },
        activities,
        startTime: Date.now(),
        workflowId: 'workflow-id',
      })
    ).rejects.toMatchObject({
      type: 'CONTACT_VALIDATION_REJECTED',
      nonRetryable: true,
    } satisfies Partial<ApplicationFailure>);
  });

  it('preserves contact rejection when failure-reporting activities fail', async () => {
    const activities = {
      validateContactInformation: jest.fn().mockResolvedValue({
        success: false,
        isValid: false,
        shouldProceed: false,
        validationType: 'email',
        error: 'Original validation rejection',
        reason: 'Original validation rejection',
      }),
      validateCommunicationChannelsActivity: jest.fn(),
      invalidateEmailOnlyActivity: jest.fn(),
      saveCronStatusActivity: jest.fn().mockRejectedValue(new Error('Status write failed')),
      logWorkflowExecutionActivity: jest.fn().mockRejectedValue(new Error('Log write failed')),
    };

    await expect(
      performEarlyValidation({
        lead_id: 'lead-id',
        site_id: 'site-id',
        leadInfo: {
          email: 'lead@example.com',
          phone: '+15555550100',
          metadata: {},
        },
        options: {
          lead_id: 'lead-id',
          site_id: 'site-id',
        },
        site: {
          name: 'Example site',
          url: 'https://example.com',
          user_id: 'user-id',
        },
        activities,
        startTime: Date.now(),
        workflowId: 'workflow-id',
      })
    ).rejects.toMatchObject({
      type: 'CONTACT_VALIDATION_REJECTED',
      message: expect.stringContaining('Original validation rejection'),
      nonRetryable: true,
    } satisfies Partial<ApplicationFailure>);

    expect(activities.logWorkflowExecutionActivity).toHaveBeenCalled();
  });
});
