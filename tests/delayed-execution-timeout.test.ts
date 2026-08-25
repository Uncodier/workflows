import { computeDelayedWorkflowRunTimeout } from '../src/temporal/utils/delayedExecutionTimeout';

describe('computeDelayedWorkflowRunTimeout', () => {
  it('keeps a 48h floor for short delays', () => {
    expect(computeDelayedWorkflowRunTimeout(2 * 60 * 60 * 1000)).toBe('48h');
  });

  it('covers weekend-to-Monday timers beyond 48h', () => {
    const seventyTwoHours = 72 * 60 * 60 * 1000;
    expect(computeDelayedWorkflowRunTimeout(seventyTwoHours)).toBe('74h');
  });

  it('clamps very long delays to 7 days', () => {
    const tenDays = 10 * 24 * 60 * 60 * 1000;
    expect(computeDelayedWorkflowRunTimeout(tenDays)).toBe('168h');
  });
});
