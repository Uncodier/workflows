import { ApplicationFailure } from '@temporalio/common';
const mockPatched = jest.fn();
const mockWorkflowInfo = jest.fn();
jest.mock('@temporalio/workflow', () => ({
  ...jest.requireActual('@temporalio/workflow'),
  patched: mockPatched,
  workflowInfo: mockWorkflowInfo,
}));
import { createChannelApiFailure } from '../src/temporal/activities/channelActivities';
import { buildUnprocessableMessageCustomData } from '../src/temporal/activities/messageActivities';
import { validVisitorId } from '../src/temporal/activities/sendCustomerSupportMessageActivity';
import { performEarlyValidation } from '../src/temporal/workflows/leadFollowUp/validation';

describe('remaining failure handling', () => {
  beforeEach(() => {
    mockPatched.mockReturnValue(true);
    mockWorkflowInfo.mockReturnValue({ startTime: new Date('2026-09-28T00:00:00Z') });
  });

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

  it('fails closed for new executions when the provider cannot verify the email', async () => {
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

    await expect(performEarlyValidation({
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
    })).rejects.toMatchObject({
      type: 'CONTACT_VALIDATION_UNAVAILABLE',
      nonRetryable: true,
    });
    expect(mockPatched).toHaveBeenCalledWith('lead-follow-up-contact-validation-fail-closed-v1');
    expect(activities.saveCronStatusActivity).not.toHaveBeenCalled();
  });

  it('preserves the post-fix historical fail-open command sequence for replay', async () => {
    mockPatched.mockReturnValue(false);
    const activities = {
      validateContactInformation: jest.fn().mockResolvedValue({
        success: false, isValid: false, shouldProceed: true, validationType: 'email',
        error: 'Email verifier returned unknown status',
      }),
      saveCronStatusActivity: jest.fn(),
      logWorkflowExecutionActivity: jest.fn(),
    };
    const result = await performEarlyValidation({
      lead_id: 'lead-id', site_id: 'site-id',
      leadInfo: { email: 'lead@example.com', metadata: {} },
      options: { lead_id: 'lead-id', site_id: 'site-id' },
      site: { name: 'Site', url: 'https://example.com', user_id: 'user-id' },
      activities, startTime: Date.now(), workflowId: 'workflow-id',
    });
    expect(result.shouldReturn).toBe(false);
    expect(activities.saveCronStatusActivity).not.toHaveBeenCalled();
    expect(activities.logWorkflowExecutionActivity).not.toHaveBeenCalled();
  });

  it('replays the pre-fix FAILED activity sequence for old executions', async () => {
    mockPatched.mockReturnValue(false);
    mockWorkflowInfo.mockReturnValue({ startTime: new Date('2026-09-17T00:00:00Z') });
    const activities = {
      validateContactInformation: jest.fn().mockResolvedValue({
        success: false, isValid: false, shouldProceed: true, validationType: 'email',
        error: 'Email verifier returned unknown status',
      }),
      saveCronStatusActivity: jest.fn().mockResolvedValue(undefined),
      logWorkflowExecutionActivity: jest.fn().mockResolvedValue(undefined),
    };
    await expect(performEarlyValidation({
      lead_id: 'lead-id', site_id: 'site-id',
      leadInfo: { email: 'lead@example.com', metadata: {} },
      options: { lead_id: 'lead-id', site_id: 'site-id' },
      site: { name: 'Site', url: 'https://example.com', user_id: 'user-id' },
      activities, startTime: Date.now(), workflowId: 'workflow-id',
    })).rejects.toMatchObject({ type: 'CONTACT_VALIDATION_REJECTED' });
    expect(activities.saveCronStatusActivity).toHaveBeenCalledWith(expect.objectContaining({ status: 'FAILED' }));
    expect(activities.logWorkflowExecutionActivity).toHaveBeenCalledWith(expect.objectContaining({ status: 'FAILED' }));
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
