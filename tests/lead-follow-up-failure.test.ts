import { ApplicationFailure } from '@temporalio/common';
import {
  createLeadFollowUpApiFailure,
  isLeadFollowUpFailureNonRetryable,
  parseLeadFollowUpApiError,
} from '../src/temporal/activities/leadFollowUpFailure';
import { terminalWorkflowFailure } from '../src/temporal/workflows/helpers/terminalWorkflowFailure';

describe('lead follow-up failures', () => {
  it('keeps empty AI output retryable', () => {
    const parsed = parseLeadFollowUpApiError({
      code: 'HTTP_500',
      status: 500,
      message: 'API call failed: 500 Internal Server Error. {"success":false,"error":{"code":"NO_CONTENT_GENERATED","message":"The AI command did not generate any follow-up content with a valid channel.","details":{"command_status":"completed","has_results":false}}}',
    });

    expect(parsed).toMatchObject({
      code: 'NO_CONTENT_GENERATED',
      status: 500,
      message: 'The AI command did not generate any follow-up content with a valid channel.',
      details: {
        command_status: 'completed',
        has_results: false,
      },
    });
    expect(isLeadFollowUpFailureNonRetryable(parsed)).toBe(false);
  });

  it('keeps failed sales commands retryable', () => {
    const failure = createLeadFollowUpApiFailure({
      code: 'HTTP_500',
      status: 500,
      message: 'API call failed: 500 Internal Server Error. {"success":false,"error":{"code":"SALES_COMMAND_FAILED","message":"Sales command did not complete successfully and has no recoverable results"}}',
    });

    expect(failure).toMatchObject({
      type: 'SALES_COMMAND_FAILED',
      nonRetryable: false,
    });
  });

  it.each(['NO_VALID_CHANNELS', 'NO_VALID_CHANNELS_FOR_LEAD'])(
    'does not retry permanent channel failure %s',
    (code) => {
      const failure = createLeadFollowUpApiFailure({
        code: 'HTTP_400',
        status: 400,
        message: `API call failed: 400 Bad Request. {"success":false,"error":{"code":"${code}","message":"No usable channel"}}`,
      });

      expect(failure).toMatchObject({
        type: code,
        nonRetryable: true,
      });
    }
  );

  it('converts ordinary workflow errors into terminal failures', () => {
    const failure = terminalWorkflowFailure(
      new Error('unexpected workflow error'),
      'Lead follow-up workflow failed',
      'LEAD_FOLLOW_UP_WORKFLOW_FAILED'
    );

    expect(failure).toBeInstanceOf(ApplicationFailure);
    expect(failure).toMatchObject({
      type: 'LEAD_FOLLOW_UP_WORKFLOW_FAILED',
      nonRetryable: true,
      message: 'Lead follow-up workflow failed: unexpected workflow error',
    });
  });

  it('preserves Temporal failures and their retry metadata', () => {
    const original = ApplicationFailure.retryable(
      'Temporary upstream error',
      'NO_CONTENT_GENERATED'
    );

    expect(
      terminalWorkflowFailure(
        original,
        'Lead follow-up workflow failed',
        'LEAD_FOLLOW_UP_WORKFLOW_FAILED'
      )
    ).toBe(original);
  });
});
