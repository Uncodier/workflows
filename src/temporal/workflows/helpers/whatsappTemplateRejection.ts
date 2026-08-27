export const TEMPLATE_REJECTED_ERROR_TYPE = 'TEMPLATE_REJECTED';

/**
 * Extract `error_type` from an API 400 payload embedded in apiService error.message.
 * Example: `API call failed: 400 Bad Request. {"error_type":"TEMPLATE_REJECTED",...}`
 */
export function parseApiErrorTypeFromMessage(message: string): string | null {
  if (!message) return null;

  const quoted = message.match(/"error_type"\s*:\s*"([^"]+)"/);
  if (quoted?.[1]) return quoted[1];

  const jsonStart = message.indexOf('{');
  if (jsonStart === -1) return null;
  try {
    const parsed = JSON.parse(message.slice(jsonStart)) as { error_type?: unknown };
    return typeof parsed.error_type === 'string' ? parsed.error_type : null;
  } catch {
    return null;
  }
}

function messageLooksRejected(message: string): boolean {
  return (
    message.includes(TEMPLATE_REJECTED_ERROR_TYPE) ||
    parseApiErrorTypeFromMessage(message) === TEMPLATE_REJECTED_ERROR_TYPE
  );
}

/**
 * True when this error (or Temporal's ActivityFailure.cause chain) is a terminal
 * template rejection. Activities throw ApplicationFailure; workflows catch ActivityFailure
 * with that ApplicationFailure as `cause`.
 */
export function isTemplateRejectedFailure(error: unknown, depth = 0): boolean {
  if (error == null || depth > 6) return false;

  if (typeof error === 'string') {
    return messageLooksRejected(error);
  }

  if (typeof error !== 'object') return false;

  const typed = error as {
    type?: string;
    message?: string;
    cause?: unknown;
    failure?: { type?: string; cause?: unknown };
  };
  if (typed.type === TEMPLATE_REJECTED_ERROR_TYPE) return true;
  if (typed.failure?.type === TEMPLATE_REJECTED_ERROR_TYPE) return true;

  const message =
    error instanceof Error
      ? error.message
      : typeof typed.message === 'string'
        ? typed.message
        : '';
  if (message && messageLooksRejected(message)) return true;

  if (typed.cause != null && isTemplateRejectedFailure(typed.cause, depth + 1)) return true;
  if (typed.failure?.cause != null && isTemplateRejectedFailure(typed.failure.cause, depth + 1)) {
    return true;
  }
  return false;
}

/** Pending/received (and other retryable send errors) keep the 30m/1h/6h backoff. */
export function shouldRetrySendTemplate(error: unknown): boolean {
  return !isTemplateRejectedFailure(error);
}
