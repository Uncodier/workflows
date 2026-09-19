import { ApplicationFailure, TemporalFailure } from '@temporalio/workflow';

/**
 * Converts ordinary workflow errors into terminal application failures.
 *
 * Temporal failures (including exhausted ActivityFailure instances) are
 * preserved so their original type, cause, and retry state remain visible.
 */
export function terminalWorkflowFailure(
  error: unknown,
  prefix: string,
  type: string
): TemporalFailure {
  if (error instanceof TemporalFailure) return error;

  const message = error instanceof Error ? error.message : String(error);
  return ApplicationFailure.create({
    message: `${prefix}: ${message}`,
    type,
    nonRetryable: true,
    cause: error instanceof Error ? error : undefined,
  });
}
