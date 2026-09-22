import { ApplicationFailure } from '@temporalio/workflow';
import { hasApplicationFailureType } from '../src/temporal/workflows/helpers/applicationFailureType';

describe('hasApplicationFailureType', () => {
  it('finds an ApplicationFailure wrapped as an activity cause', () => {
    const applicationFailure = ApplicationFailure.nonRetryable(
      'Placement response was ambiguous',
      'VOICE_CALL_PLACEMENT_UNKNOWN'
    );
    const activityFailure = new Error('Activity failed') as Error & {
      cause?: unknown;
    };
    activityFailure.cause = applicationFailure;

    expect(hasApplicationFailureType(
      activityFailure,
      'VOICE_CALL_PLACEMENT_UNKNOWN'
    )).toBe(true);
  });

  it('rejects unrelated nested failure types', () => {
    const activityFailure = new Error('Activity failed') as Error & {
      cause?: unknown;
    };
    activityFailure.cause = ApplicationFailure.nonRetryable(
      'Rejected',
      'VOICE_CALL_REQUEST_REJECTED'
    );

    expect(hasApplicationFailureType(
      activityFailure,
      'VOICE_CALL_PLACEMENT_UNKNOWN'
    )).toBe(false);
  });
});
