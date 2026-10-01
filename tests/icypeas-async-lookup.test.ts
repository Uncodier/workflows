import { resolveIcyPeasEmail } from '../src/temporal/activities/icypeas/resolveEmail';

const options = { site_id: '9be0a6a2-5567-41bf-ad06-cb4014f0faf2', firstname: 'Ada', lastname: 'Example', domainOrCompany: 'acme.test' };
const response = (data: any) => ({ success: true, data });
const pending = (extra = {}) => response({ outcome: 'pending', status: 'IN_PROGRESS', searchId: 'search-1', retryAfterMs: 15_000, ...extra });
const found = (extra = {}) => response({ outcome: 'matched', status: 'FOUND', searchId: 'search-1',
  emails: [{ email: 'ada@acme.test', certainty: 'ultra_sure' }], ...extra });
function fixture() {
  let now = 0;
  return { request: jest.fn(), now: () => now, sleep: jest.fn(async (ms: number) => { now += ms; }) };
}

describe('durable IcyPeas activity polling', () => {
  it('keeps the queued ID and reads until FOUND rather than treating acceptance as no-match', async () => {
    const deps = fixture();
    deps.request.mockResolvedValueOnce(pending({ status: 'NONE' })).mockResolvedValueOnce(pending())
      .mockResolvedValueOnce(found());
    expect(await resolveIcyPeasEmail(options, deps)).toMatchObject({ success: true, outcome: 'matched', searchId: 'search-1',
      data: { email: 'ada@acme.test', status: 'FOUND', emails: [{ email: 'ada@acme.test', certainty: 'ultra_sure' }] } });
    expect(deps.sleep.mock.calls).toEqual([[15_000], [15_000]]);
    expect(deps.request.mock.calls.map(([body]) => body)).toEqual([options, options, options]);
  });

  it.each(['NOT_FOUND', 'DEBITED_NOT_FOUND'])('returns no_match only for the confirmed terminal status %s', async status => {
    const deps = fixture();
    deps.request.mockResolvedValue(response({ outcome: 'no_match', searchId: 'search-1', status }));
    expect(await resolveIcyPeasEmail(options, deps)).toEqual({ success: true, outcome: 'no_match', searchId: 'search-1' });
    expect(deps.sleep).not.toHaveBeenCalled();
  });

  it('respects provider cooldowns without treating a long wait as no-match', async () => {
    const deps = fixture();
    deps.request.mockResolvedValueOnce(pending({ retryAfterMs: 60_000 })).mockResolvedValueOnce(found());
    expect((await resolveIcyPeasEmail(options, deps)).success).toBe(true);
    expect(deps.sleep).toHaveBeenCalledWith(60_000);
    deps.request.mockResolvedValue(pending({ retryAfterMs: 300_000 }));
    expect(await resolveIcyPeasEmail(options, deps)).toMatchObject({ success: false, outcome: 'pending', searchId: 'search-1' });
  });

  it('bounds polling before the Temporal activity deadline and resumes on a subsequent invocation', async () => {
    const deps = fixture();
    deps.request.mockResolvedValue(pending());
    expect(await resolveIcyPeasEmail(options, deps)).toMatchObject({ success: false, outcome: 'pending', searchId: 'search-1' });
    expect(deps.now()).toBeLessThan(240_000);
    expect(deps.request).toHaveBeenCalledTimes(16);
    // Durable submission belongs to the API: repeated input resumes its saved search.
    deps.request.mockResolvedValue(found());
    expect(await resolveIcyPeasEmail(options, deps)).toMatchObject({ success: true, searchId: 'search-1' });
  });

  it.each([
    {}, { success: true, item: { _id: 'search-1', status: 'NONE' } },
    { outcome: 'no_match', status: 'NONE', searchId: 'search-1' },
    { outcome: 'no_match', status: 'NOT_FOUND' },
    { outcome: 'matched', status: 'FOUND', searchId: 'search-1', emails: [] },
    { outcome: 'matched', status: 'IN_PROGRESS', searchId: 'search-1', emails: [{ email: 'ada@acme.test' }] },
    { outcome: 'matched', status: 'FOUND', searchId: 'search-1', emails: [{ email: 'not email' }] },
    { outcome: 'matched', status: 'FOUND', searchId: 'search-1', emails: [{ email: 'ada@acme.test', certainty: 'undeliverable' }] },
    { outcome: 'mystery', status: 'FOUND', searchId: 'search-1' },
  ])('fails closed for malformed/incomplete resolver data: %j', async data => {
    const deps = fixture();
    deps.request.mockResolvedValue(response(data));
    expect(await resolveIcyPeasEmail(options, deps)).toMatchObject({ success: false, outcome: 'failed' });
    expect(deps.request).toHaveBeenCalledTimes(1);
  });

  it('rejects identity changes across polls', async () => {
    const deps = fixture();
    deps.request.mockResolvedValueOnce(pending()).mockResolvedValueOnce(found({ searchId: 'other' }));
    expect(await resolveIcyPeasEmail(options, deps)).toMatchObject({ success: false, searchId: 'search-1', error: expect.stringContaining('identity') });
  });

  it.each(['BAD_INPUT', 'INSUFFICIENT_FUNDS', 'ABORTED', 'SUBMISSION_UNKNOWN'])('surfaces %s without creating another search', async status => {
    const deps = fixture();
    deps.request.mockResolvedValue(response({ outcome: 'failed', status, error: status }));
    expect(await resolveIcyPeasEmail(options, deps)).toMatchObject({ success: false, error: status });
    expect(deps.request).toHaveBeenCalledTimes(1);
  });

  it('preserves the ID on a read error for diagnosis; never reports no-match', async () => {
    const deps = fixture();
    deps.request.mockResolvedValueOnce(pending()).mockResolvedValueOnce({ success: false, error: { message: '503 unavailable' } });
    expect(await resolveIcyPeasEmail(options, deps)).toMatchObject({ success: false, searchId: 'search-1', error: '503 unavailable' });
  });

  it.each([{ status: 429, retryAfterMs: 43_000 }, { status: 503 }, { code: 'NETWORK_ERROR' }, { code: 'TIMEOUT' }])(
    'retries the durable resolver (not the submit endpoint) after transport failure %j', async error => {
      const deps = fixture();
      deps.request.mockResolvedValueOnce(pending()).mockResolvedValueOnce({ success: false, error }).mockResolvedValueOnce(found());
      expect(await resolveIcyPeasEmail(options, deps)).toMatchObject({ success: true, searchId: 'search-1' });
      expect(deps.sleep.mock.calls).toEqual([[15_000], [error.retryAfterMs || 60_000]]);
    },
  );

  it('normalizes input and does not forward untrusted webhooks/custom IDs to the provider', async () => {
    const deps = fixture();
    deps.request.mockResolvedValue(found());
    await resolveIcyPeasEmail({ ...options, firstname: ' Ada ', customobject: { webhookUrl: 'https://untrusted.test' } }, deps);
    expect(deps.request).toHaveBeenCalledWith(options, 20_000);
  });

  it.each([{ site_id: undefined }, { site_id: 'not-uuid' }, { firstname: '', lastname: '' }, { domainOrCompany: '' }, { firstname: 123 }])(
    'rejects invalid or legacy unscoped lookups without spending: %j', async extra => {
      const deps = fixture();
      expect(await resolveIcyPeasEmail({ ...options, ...extra } as any, deps)).toMatchObject({ success: false });
      expect(deps.request).not.toHaveBeenCalled();
    },
  );

  it('propagates cancellation rather than starting more requests/fallbacks', async () => {
    const deps = fixture();
    const controller = new AbortController();
    deps.request.mockResolvedValue(pending());
    deps.sleep.mockImplementation(async () => { controller.abort(new Error('Cancelled')); });
    await expect(resolveIcyPeasEmail(options, { ...deps, signal: controller.signal })).rejects.toThrow('Cancelled');
    expect(deps.request).toHaveBeenCalledTimes(1);
  });
});