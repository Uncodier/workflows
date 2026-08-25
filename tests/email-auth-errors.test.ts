import { isEmailAuthFailure } from '../src/temporal/utils/emailAuthErrors';

describe('isEmailAuthFailure', () => {
  it('detects IMAP authentication failures from the email API', () => {
    const message =
      'Sent emails sync failed: API call failed: 500 Internal Server Error. {"success":false,"error":{"code":"EMAIL_FETCH_ERROR","message":"Sent email fetch error: Authentication failed: invalid credentials or IMAP access problem."}}';

    expect(isEmailAuthFailure(message)).toBe(true);
    expect(isEmailAuthFailure('EMAIL_FETCH_ERROR')).toBe(true);
  });

  it('does not treat unrelated failures as auth errors', () => {
    expect(isEmailAuthFailure('API call failed: 500 Internal Server Error')).toBe(false);
    expect(isEmailAuthFailure(undefined)).toBe(false);
    expect(isEmailAuthFailure('')).toBe(false);
  });
});
