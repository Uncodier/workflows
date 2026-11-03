/**
 * Detect explicit IMAP/SMTP auth failures, not generic fetch/HTTP failures.
 * Temporal activity failures may carry the provider message in their cause.
 */
export function isEmailAuthFailure(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current = error;
  while (current && !seen.has(current)) {
    seen.add(current);
    const message = typeof current === 'string' ? current :
      typeof current === 'object' && 'message' in current && typeof current.message === 'string' ? current.message : '';
    if (hasAuthMessage(message)) return true;
    current = typeof current === 'object' && 'cause' in current ? current.cause : undefined;
  }
  return false;
}

function hasAuthMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('authentication failed') ||
    normalized.includes('invalid credentials') ||
    normalized.includes('invalid login') ||
    normalized.includes('username and password not accepted') ||
    normalized.includes('authenticationfailed') ||
    normalized.includes('imap access disabled') ||
    normalized.includes('imap access is disabled')
  );
}

/** Only known permanent send failures; timeouts, rate limits and generic 5xx retry. */
export function permanentEmailErrorType(message: string): string | undefined {
  if (isEmailAuthFailure(message)) return 'EMAIL_AUTH_FAILED';
  if (/\bsmtp(?:\s+(?:is|settings|configuration|email))?\s+not configured\b/i.test(message)) {
    return 'EMAIL_SMTP_NOT_CONFIGURED';
  }
  if (/\brecipients?\b[^\n]*\bsuppressed\b|\bsuppressed\b[^\n]*\brecipients?\b/i.test(message)) {
    return 'EMAIL_RECIPIENT_SUPPRESSED';
  }
  return undefined;
}
