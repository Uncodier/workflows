import { ApplicationFailure } from '@temporalio/workflow';

export function hasApplicationFailureType(
  error: unknown,
  expectedType: string
): boolean {
  const visited = new Set<unknown>();
  let current = error;

  while (current && typeof current === 'object' && !visited.has(current)) {
    visited.add(current);
    if (
      current instanceof ApplicationFailure
      && current.type === expectedType
    ) {
      return true;
    }
    current = 'cause' in current ? current.cause : undefined;
  }

  return false;
}
