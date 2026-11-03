const mockPost = jest.fn();
const mockRequest = jest.fn();
jest.mock('../src/temporal/services/apiService', () => ({ apiService: {
  post: (...args: any[]) => mockPost(...args),
  request: (...args: any[]) => mockRequest(...args),
} }));
import { ApplicationFailure } from '@temporalio/activity';
import { deliveryStatusActivity, sendEmailFromAgentActivity, syncSentEmailsActivity } from '../src/temporal/activities/emailActivities';

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

const sendParams = { email: 'owner@example.com', subject: 'Warning', message: 'Credits exhausted', site_id: 'site' };

describe.each(['response', 'throw'])('send API %s failures', mode => {
  it.each([
    ['Recipient is suppressed due to bounce', 'EMAIL_RECIPIENT_SUPPRESSED'],
    ['SMTP not configured', 'EMAIL_SMTP_NOT_CONFIGURED'],
    ['Invalid login: 535-5.7.8 Username and Password not accepted', 'EMAIL_AUTH_FAILED'],
  ])('does not rewrap permanent %s failures as retryable', async (message, type) => {
    if (mode === 'response') mockPost.mockResolvedValue({ success: false, error: { code: 'HTTP_500', message } });
    else mockPost.mockRejectedValue(new Error(message));
    const error = await sendEmailFromAgentActivity(sendParams).catch(error => error);
    expect(error).toBeInstanceOf(ApplicationFailure);
    expect(error).toMatchObject({ type, nonRetryable: true, message: expect.stringContaining(message) });
  });
});

it('preserves an already classified send failure', async () => {
  const failure = ApplicationFailure.nonRetryable('Recipient rejected', 'EMAIL_RECIPIENT_SUPPRESSED');
  mockPost.mockRejectedValue(failure);
  await expect(sendEmailFromAgentActivity(sendParams)).rejects.toBe(failure);
});

it.each(['HTTP 500', '429 rate limit', 'Request timeout', 'ECONNRESET'])('keeps sends retryable for %s', async message => {
  mockPost.mockResolvedValue({ success: false, error: { message } });
  const error = await sendEmailFromAgentActivity(sendParams).catch(error => error);
  expect(error).not.toBeInstanceOf(ApplicationFailure);
  expect(error.message).toContain(message);
});

describe.each([
  ['sent sync', syncSentEmailsActivity],
  ['delivery status', deliveryStatusActivity],
] as const)('%s', (_name, activity) => {
  it.each(['response', 'throw'])('returns an auth skip without retrying an HTTP500 %s', async mode => {
    const message = 'API call failed: 500 Internal Server Error. {"error":{"code":"EMAIL_FETCH_ERROR","message":"Authentication failed: invalid credentials or IMAP access problem."}}';
    if (mode === 'response') mockRequest.mockResolvedValue({ success: false, error: { code: 'HTTP_500', message } });
    else mockRequest.mockRejectedValue(new Error(message));
    await expect(activity({ site_id: 'site' })).resolves.toMatchObject({ success: false, error: expect.stringContaining(message) });
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it.each(['EMAIL_FETCH_ERROR', 'EMAIL_FETCH_ERROR: connection timeout', 'HTTP 500', '429 rate limit', 'ECONNRESET'])('throws to allow Temporal retries for %s', async message => {
    mockRequest.mockResolvedValue({ success: false, error: { code: 'EMAIL_FETCH_ERROR', message } });
    await expect(activity({ site_id: 'site' })).rejects.toThrow(message);
  });

  it('preserves a thrown transient error as a failure', async () => {
    mockRequest.mockRejectedValue(new Error('Connection timed out'));
    await expect(activity({ site_id: 'site' })).rejects.toThrow('Connection timed out');
  });

  it('preserves successful responses and extended timeout', async () => {
    mockRequest.mockResolvedValue({ success: true, data: { count: 3 } });
    await expect(activity({ site_id: 'site' })).resolves.toEqual({ success: true, data: { count: 3 } });
    expect(mockRequest).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ timeout: 900000, method: 'POST' }));
  });
});