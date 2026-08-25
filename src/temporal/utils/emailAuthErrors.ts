/**
 * Detect IMAP/SMTP auth failures that should not fail the parent workflow.
 */
export function isEmailAuthFailure(message: string | undefined | null): boolean {
  if (!message) {
    return false;
  }

  const normalized = message.toLowerCase();
  return (
    normalized.includes('email_fetch_error') ||
    normalized.includes('authentication failed') ||
    normalized.includes('invalid credentials') ||
    normalized.includes('imap access') ||
    normalized.includes('imap access problem')
  );
}
