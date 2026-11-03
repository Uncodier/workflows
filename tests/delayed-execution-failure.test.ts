const mockExecuteChild = jest.fn();
jest.mock('@temporalio/workflow', () => ({
  ...jest.requireActual('@temporalio/workflow'),
  executeChild: (...args: unknown[]) => mockExecuteChild(...args),
  sleep: jest.fn().mockResolvedValue(undefined),
  workflowInfo: () => ({ workflowId: 'timer-site-2026-11-03' }),
}));
import { ApplicationFailure, CancelledFailure } from '@temporalio/workflow';
import { delayedExecutionWorkflow } from '../src/temporal/workflows/delayedExecutionWorkflow';

const input = { delayMs: 0, targetWorkflow: 'analyzeSiteWorkflow', targetArgs: [] };
beforeEach(() => jest.clearAllMocks());

it('preserves a terminal child failure instead of repeatedly failing workflow tasks', async () => {
  const error = ApplicationFailure.nonRetryable('Site is archived', 'SITE_ARCHIVED');
  mockExecuteChild.mockRejectedValue(error);
  await expect(delayedExecutionWorkflow(input)).rejects.toBe(error);
});

it('preserves cancellation', async () => {
  const error = new CancelledFailure('Canceled');
  mockExecuteChild.mockRejectedValue(error);
  await expect(delayedExecutionWorkflow(input)).rejects.toBe(error);
});

it('converts unexpected errors into terminal failures', async () => {
  mockExecuteChild.mockRejectedValue(new Error('Invalid target'));
  await expect(delayedExecutionWorkflow(input)).rejects.toMatchObject({
    type: 'DELAYED_EXECUTION_FAILED', nonRetryable: true,
  });
});

it('retains duplicate-execution handling', async () => {
  mockExecuteChild.mockRejectedValue(new Error('Workflow execution already started'));
  await expect(delayedExecutionWorkflow(input)).resolves.toMatchObject({
    success: true, targetResult: { skipped: true },
  });
});