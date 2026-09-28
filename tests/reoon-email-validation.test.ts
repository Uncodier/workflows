import axios from 'axios';
import { validateEmail } from '../src/temporal/activities/validateEmailActivities';

jest.mock('axios');
const get = axios.get as jest.Mock;
const isAxiosError = axios.isAxiosError as jest.Mock;

describe('Reoon power-mode verification', () => {
  const originalKey = process.env.REOON_API_KEY;

  beforeEach(() => {
    process.env.REOON_API_KEY = 'sensitive-test-key';
    get.mockReset();
    // A rejected verification does not necessarily mean the account is empty.
    get.mockImplementation((url: string) => url.includes('check-account-balance')
      ? Promise.resolve({ data: { status: 'success', api_status: 'active', remaining_daily_credits: 5, remaining_instant_credits: 0 } })
      : Promise.reject(new Error('No verification response configured')));
    isAxiosError.mockImplementation(error => error?.isAxiosError === true);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalKey === undefined) delete process.env.REOON_API_KEY;
    else process.env.REOON_API_KEY = originalKey;
  });

  it.each([
    ['safe', true, 'valid'],
    ['role_account', true, 'valid'],
    ['invalid', false, 'invalid'],
    ['disabled', false, 'invalid'],
    ['disposable', false, 'disposable'],
    ['spamtrap', false, 'invalid'],
  ] as const)('maps documented status %s correctly', async (status, isValid, result) => {
    get.mockResolvedValue({ data: { status, is_deliverable: isValid } });
    const outcome = await validateEmail({ email: 'lead@example.com' });
    expect(outcome).toMatchObject({ success: true, data: { isValid, deliverable: isValid, result } });
    expect(get).toHaveBeenCalledWith(expect.stringContaining('/api/v1/verify'), expect.objectContaining({
      timeout: 90000,
      params: { email: 'lead@example.com', key: 'sensitive-test-key', mode: 'power' },
    }));
  });

  it.each(['unknown', 'catch_all', 'inbox_full'])('does not claim %s is verified or invalid', async status => {
    get.mockResolvedValue({ data: { status } });
    const outcome = await validateEmail({ email: 'lead@example.com' });
    expect(outcome.success).toBe(false);
    expect(outcome.data).toBeUndefined();
  });

  it('does not echo an unrecognized provider status or payload into logs', async () => {
    get.mockResolvedValue({ data: { status: 'secret-lead@example.com', key: 'sensitive-test-key' } });
    const outcome = await validateEmail({ email: 'lead@example.com' });
    expect(outcome).toMatchObject({ success: false, error: { code: 'UNKNOWN_STATUS' } });
    expect(JSON.stringify((console.log as jest.Mock).mock.calls)).not.toContain('secret-lead@example.com');
    expect(JSON.stringify((console.log as jest.Mock).mock.calls)).not.toContain('sensitive-test-key');
  });

  it('treats a missing or malformed response as unknown without leaking it', async () => {
    get.mockResolvedValue({ data: null });
    expect(await validateEmail({ email: 'lead@example.com' })).toMatchObject({
      success: false, error: { code: 'UNKNOWN_STATUS' },
    });
  });

  it('does not invalidate a lead when the provider gives contradictory status and deliverability', async () => {
    get.mockResolvedValue({ data: { status: 'safe', is_deliverable: false } });
    expect(await validateEmail({ email: 'lead@example.com' })).toMatchObject({
      success: false, error: { code: 'INCONCLUSIVE_STATUS' },
    });
  });

  it('requires an explicit is_deliverable=true for safe and role_account', async () => {
    for (const status of ['safe', 'role_account']) {
      get.mockResolvedValue({ data: { status } });
      expect(await validateEmail({ email: 'lead@example.com' })).toMatchObject({
        success: false, error: { code: 'INCONCLUSIVE_STATUS' },
      });
    }
  });

  it('does not leak the Axios request URL, key or email in logs or returned errors', async () => {
    const error = Object.assign(new Error('Request failed with status code 403'), {
      isAxiosError: true,
      code: 'ERR_BAD_REQUEST',
      config: { url: 'https://emailverifier.reoon.com/api/v1/verify?email=lead@example.com&key=sensitive-test-key' },
      response: { status: 403 },
    });
    get.mockImplementation((url: string) => url.includes('check-account-balance')
      ? Promise.resolve({ data: { status: 'success', api_status: 'active', remaining_daily_credits: 5, remaining_instant_credits: 0 } })
      : Promise.reject(error));
    const outcome = await validateEmail({ email: 'lead@example.com' });
    expect(outcome).toMatchObject({ success: false, error: { code: 'HTTP_403' } });
    const written = JSON.stringify([
      outcome,
      (console.log as jest.Mock).mock.calls,
      (console.error as jest.Mock).mock.calls,
    ]);
    expect(written).not.toContain('sensitive-test-key');
    expect(written).not.toContain('lead@example.com');
    expect(written).not.toContain('api/v1/verify?');
  });

  it('does not assume every 403 is caused by a lack of credits', async () => {
    get.mockImplementation((url: string) => url.includes('check-account-balance')
      ? Promise.resolve({ data: { status: 'success', api_status: 'active', remaining_daily_credits: 2, remaining_instant_credits: 0 } })
      : Promise.reject(Object.assign(new Error('Forbidden'), { isAxiosError: true, response: { status: 403 } })));
    expect(await validateEmail({ email: 'lead@example.com' })).toMatchObject({
      success: false, error: { code: 'HTTP_403' },
    });
  });

  it('checks the balance after a 403 and briefly avoids futile verification calls', async () => {
    process.env.REOON_API_KEY = 'no-credits-test-key';
    get.mockImplementation((url: string) => url.includes('check-account-balance')
      ? Promise.resolve({ data: { status: 'success', api_status: 'active', remaining_daily_credits: 0, remaining_instant_credits: 0 } })
      : Promise.reject(Object.assign(new Error('Forbidden'), { isAxiosError: true, response: { status: 403 } })));
    const first = await validateEmail({ email: 'lead@example.com' });
    const second = await validateEmail({ email: 'other@example.com' });
    expect(first).toMatchObject({ success: false, error: { code: 'NO_CREDITS' } });
    expect(second).toMatchObject({ success: false, error: { code: 'NO_CREDITS' } });
    expect(get).toHaveBeenCalledTimes(2); // One verification, one balance request.
    expect(JSON.stringify([first, second, (console.error as jest.Mock).mock.calls]))
      .not.toContain('no-credits-test-key');
  });

  it('distinguishes an Axios timeout without logging request details', async () => {
    get.mockRejectedValue(Object.assign(new Error('timeout of 90000ms exceeded'), {
      isAxiosError: true, code: 'ECONNABORTED',
      config: { params: { key: 'sensitive-test-key' } },
    }));
    expect(await validateEmail({ email: 'lead@example.com' })).toMatchObject({
      success: false, error: { code: 'API_TIMEOUT' },
    });
    expect(JSON.stringify((console.error as jest.Mock).mock.calls)).not.toContain('sensitive-test-key');
  });
});