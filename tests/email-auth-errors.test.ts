import { isEmailAuthFailure, permanentEmailErrorType } from '../src/temporal/utils/emailAuthErrors';

describe('isEmailAuthFailure', () => {
  it('detects IMAP authentication failures from the email API', () => {
    const message =
      'Sent emails sync failed: API call failed: 500 Internal Server Error. {"success":false,"error":{"code":"EMAIL_FETCH_ERROR","message":"Sent email fetch error: Authentication failed: invalid credentials or IMAP access problem."}}';

    expect(isEmailAuthFailure(message)).toBe(true);
    expect(isEmailAuthFailure('EMAIL_FETCH_ERROR')).toBe(false);
  });

  it('does not treat unrelated failures as auth errors', () => {
    expect(isEmailAuthFailure('API call failed: 500 Internal Server Error')).toBe(false);
    expect(isEmailAuthFailure(undefined)).toBe(false);
    expect(isEmailAuthFailure('')).toBe(false);
  });

  it.each([
    'Invalid login: 535-5.7.8 Username and Password not accepted. gsmtp',
    'IMAP AUTHENTICATIONFAILED',
    'IMAP access is disabled',
  ])('detects explicit provider auth evidence: %s', message => {
    expect(isEmailAuthFailure(message)).toBe(true);
  });

  it.each([
    'EMAIL_FETCH_ERROR: connection timed out',
    'EMAIL_FETCH_ERROR: rate limit exceeded',
    'IMAP access problem: ECONNRESET',
    'IMAP access temporarily unavailable',
    'API call failed: 429 Too Many Requests',
  ])('does not mask transient failures: %s', message => {
    expect(isEmailAuthFailure(message)).toBe(false);
    expect(permanentEmailErrorType(message)).toBeUndefined();
  });

  it('finds auth evidence in a Temporal cause and safely handles cycles', () => {
    const error = Object.assign(new Error('Activity task failed'), { cause: new Error('Invalid login: 535') });
    expect(isEmailAuthFailure(error)).toBe(true);
    error.cause = error;
    expect(isEmailAuthFailure(error)).toBe(false);
  });
});

it.each([
  ['AgentMail: recipient owner@example.com is suppressed due to bounced recipient', 'EMAIL_RECIPIENT_SUPPRESSED'],
  ['SMTP not configured for this site', 'EMAIL_SMTP_NOT_CONFIGURED'],
  ['SMTP is not configured', 'EMAIL_SMTP_NOT_CONFIGURED'],
  ['Invalid login: 535-5.7.8 Username and Password not accepted', 'EMAIL_AUTH_FAILED'],
])('classifies known permanent sends: %s', (message, type) => {
  expect(permanentEmailErrorType(message)).toBe(type);
});
