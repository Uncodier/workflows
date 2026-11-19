const mockPost = jest.fn();
const rows: Record<string, any> = {};
const mockSelect = jest.fn();
const mockEq = jest.fn();
let readError: string | undefined;
jest.mock('../src/lib/supabase/client', () => ({ supabaseServiceRole: {
  from: (table: string) => ({
    select: (fields: string) => {
      mockSelect(fields);
      return { eq: (key: string, value: string) => {
        mockEq(key, value);
        return { maybeSingle: async () => ({
          data: rows[table] ?? null, error: readError === table ? { message: 'database unavailable' } : null,
        }) };
      } };
    },
  }),
} }));
jest.mock('../src/temporal/services/apiService', () => ({ apiService: { post: (...args: any[]) => mockPost(...args) } }));
import { checkIcpMiningCreditsActivity, warnIcpMiningCreditsActivity } from '../src/temporal/activities/icpMiningCreditActivities';
import { ApplicationFailure } from '@temporalio/activity';

beforeEach(() => {
  jest.clearAllMocks(); readError = undefined;
  rows.billing = { credits_available: 10, account_balance: 0 };
  rows.sites = { user_id: 'owner' };
  rows.profiles = { email: 'owner@example.com' };
  mockPost.mockResolvedValue({ success: true });
});

it('checks the persisted site balance and blocks zero credits', async () => {
  expect(await checkIcpMiningCreditsActivity('site')).toBe(true);
  rows.billing.credits_available = 0;
  expect(await checkIcpMiningCreditsActivity('site')).toBe(false);
});

it.each([[0, 2, true], [0.4, 0.6, true], [2, null, true], [0, null, false], [2, -3, false], [2, -2, false], [2, -1, true]])(
  'checks combined regular %s plus wallet %s', async (regular, wallet, admitted) => {
    rows.billing = { credits_available: regular, account_balance: wallet };
    expect(await checkIcpMiningCreditsActivity('site')).toBe(admitted);
    expect(mockSelect).toHaveBeenCalledWith(expect.stringContaining('account_balance'));
    expect(mockEq).toHaveBeenCalledWith('site_id', 'site');
    expect(mockPost).not.toHaveBeenCalled();
  },
);

it.each([NaN, Infinity, -Infinity, '2', true, undefined])('rejects invalid wallet or regular %p', async value => {
  rows.billing = { credits_available: 10, account_balance: value };
  await expect(checkIcpMiningCreditsActivity('site')).rejects.toThrow('ICP credits unavailable');
  rows.billing = { credits_available: value, account_balance: 10 };
  await expect(checkIcpMiningCreditsActivity('site')).rejects.toThrow('ICP credits unavailable');
});

it('excludes expired trial and plan buckets without excluding wallet funds', async () => {
  rows.billing = { credits_available: 7, account_balance: 0,
    trial_credits_available: 5, trial_started_at: '2000-01-01T00:00:00Z', trial_ends_at: '2000-01-16T00:00:00Z',
    plan_credits_available: 2, plan_credit_period_start: '2000-01-01T00:00:00Z', plan_credit_period_end: '2000-02-01T00:00:00Z' };
  expect(await checkIcpMiningCreditsActivity('site')).toBe(false);
  rows.billing.account_balance = 1;
  expect(await checkIcpMiningCreditsActivity('site')).toBe(true);
});

it('fails closed if the balance is missing or unreadable', async () => {
  rows.billing = null;
  await expect(checkIcpMiningCreditsActivity('site')).rejects.toThrow('ICP credits unavailable');
  readError = 'billing';
  await expect(checkIcpMiningCreditsActivity('site')).rejects.toThrow('database unavailable');
});

it('emails the site owner about the run, not any mined lead', async () => {
  await warnIcpMiningCreditsActivity({ siteId: 'site', workflowId: 'run' });
  expect(mockPost).toHaveBeenCalledTimes(1);
  expect(mockPost).toHaveBeenCalledWith('/api/agents/tools/sendEmail', expect.objectContaining({
    site_id: 'site', email: 'owner@example.com', subject: expect.stringContaining('ICP Mining'),
    message: expect.stringContaining('run'),
  }));
  expect(mockPost.mock.calls[0][1]).not.toHaveProperty('lead_id');
});

it('does not email anyone if the owner cannot be resolved', async () => {
  rows.profiles = null;
  await expect(warnIcpMiningCreditsActivity({ siteId: 'site', workflowId: 'run' })).rejects.toThrow('recipient unavailable');
  expect(mockPost).not.toHaveBeenCalled();
});

describe.each(['response', 'throw'])('warning API %s failures', mode => {
  it.each([
    ['AgentMail recipient is suppressed due to bounced recipient', 'EMAIL_RECIPIENT_SUPPRESSED'],
    ['SMTP not configured', 'EMAIL_SMTP_NOT_CONFIGURED'],
    ['Valid SMTP email not configured', 'EMAIL_SMTP_NOT_CONFIGURED'],
    ['Message Rejected: Recipient(s) blocked: user@example.com (suppressed by AgentMail: bounced)', 'EMAIL_RECIPIENT_SUPPRESSED'],
    ['Invalid login: 535-5.7.8 Username and Password not accepted. gsmtp', 'EMAIL_AUTH_FAILED'],
  ])('makes %s non-retryable without losing provider details', async (message, type) => {
    if (mode === 'response') mockPost.mockResolvedValue({ success: false, error: { code: 'HTTP_500', message } });
    else mockPost.mockRejectedValue(new Error(message));
    const error = await warnIcpMiningCreditsActivity({ siteId: 'site', workflowId: 'run' }).catch(error => error);
    expect(error).toBeInstanceOf(ApplicationFailure);
    expect(error).toMatchObject({ nonRetryable: true, type, message: expect.stringContaining(message) });
  });

  it.each(['HTTP 500 Internal Server Error', '429 rate limit exceeded', 'Request timeout', 'ECONNRESET'])('keeps %s retryable', async message => {
    if (mode === 'response') mockPost.mockResolvedValue({ success: false, error: { message } });
    else mockPost.mockRejectedValue(new Error(message));
    const error = await warnIcpMiningCreditsActivity({ siteId: 'site', workflowId: 'run' }).catch(error => error);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(ApplicationFailure);
    expect(error.message).toContain(message);
  });
});

it('keeps database failures retryable and does not invoke the email API', async () => {
  readError = 'profiles';
  const error = await warnIcpMiningCreditsActivity({ siteId: 'site', workflowId: 'run' }).catch(error => error);
  expect(error).not.toBeInstanceOf(ApplicationFailure);
  expect(error.message).toContain('database unavailable');
  expect(mockPost).not.toHaveBeenCalled();
});