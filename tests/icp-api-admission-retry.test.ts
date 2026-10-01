import { ApiService } from '../src/temporal/services/apiService';
import { admissionRetryAfterMs } from '../src/temporal/services/apiAdmissionRetry';
import { processOwnedIcp } from '../src/temporal/workflows/icpMining/processOwned';
import { processPageSafely } from '../src/temporal/workflows/icpMining/processPageSafely';

jest.mock('../src/config/config', () => ({ apiConfig: { baseUrl: 'https://api.test', apiKey: 'test-key' } }));

const endpoint = '/api/finder/person_contacts_lookup/personal_emails';
const body = (seconds: unknown = 43) => ({ success: false, error: { code: 'RATE_LIMITED', retry_after: seconds } });
const jsonResponse = (data: unknown, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json', ...headers },
});

describe('ICP pre-handler admission retries', () => {
  let service: ApiService;
  let fetchMock: jest.SpyInstance;
  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-10-01T16:30:00Z') });
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(Math, 'random').mockReturnValue(0);
    fetchMock = jest.spyOn(globalThis, 'fetch');
    service = new ApiService('https://api.test', 'worker-secret');
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('waits for the 43-second production cooldown then succeeds in the same activity', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(body(), 429, { 'Retry-After': '43' }))
      .mockResolvedValueOnce(jsonResponse({ emails: [{ email: 'valid@example.test' }] }));
    const result = service.post(endpoint, { site_id: 'site', person_id: 'person' });
    await jest.advanceTimersByTimeAsync(43_249);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(await result).toMatchObject({ success: true, data: { emails: [{ email: 'valid@example.test' }] } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].body).toBe(fetchMock.mock.calls[0][1].body);
    expect(fetchMock.mock.calls[1][1].headers['x-api-key']).toBe('worker-secret');
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each([
    '/api/finder/person_role_search',
    '/api/finder/person_contacts_lookup/details',
    '/api/finder/person_contacts_lookup/work_emails',
    '/api/finder/person_contacts_lookup/phone_numbers',
    '/api/agents/dataAnalyst/leadContactGeneration',
    '/api/integrations/icypeas/email-search/resolve',
  ])('covers the ICP operation %s', async path => {
    fetchMock.mockResolvedValueOnce(jsonResponse(body(1), 429))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: {} }));
    const result = service.post(path, {});
    await jest.advanceTimersByTimeAsync(1_250);
    expect(await result).toEqual({ success: true, data: {} });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('bounds repeated admission rejections to three retries, not an infinite run', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(body(1), 429));
    const result = service.post(endpoint, {});
    await jest.runAllTimersAsync();
    expect(await result).toMatchObject({ success: false, error: {
      status: 429, requestNotStarted: true, retryAfterMs: 1000,
    } });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not shorten a cooldown that exceeds the total request deadline', async () => {
    fetchMock.mockResolvedValue(jsonResponse(body(300), 429));
    expect(await service.post(endpoint, {})).toMatchObject({ success: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('counts cooldowns against a caller-supplied total timeout', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(body(1), 429));
    const result = service.request(endpoint, { method: 'POST', timeout: 3000 });
    await jest.runAllTimersAsync();
    expect(await result).toMatchObject({ success: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(Date.now()).toBe(new Date('2026-10-01T16:30:00Z').getTime() + 1250);
  });

  it.each([
    [402, { success: false, error: { code: 'INSUFFICIENT_CREDITS' } }],
    [429, { error: 'Provider unavailable', debug: { upstream: { status: 429 } } }],
    [429, { ...body(), debug: { upstream: { status: 429 } } }],
    [429, { success: false, error: { code: 'PROVIDER_RATE_LIMITED' } }],
    [500, body()],
    [503, { success: false, error: { code: 'RATE_LIMIT_UNAVAILABLE' } }],
  ])('does not repeat a potentially charged/ambiguous response (%s)', async (status, response) => {
    fetchMock.mockResolvedValue(jsonResponse(response, status as number, { 'Retry-After': '1' }));
    expect(await service.post(endpoint, {})).toMatchObject({ success: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not retry malformed 429 responses or network errors', async () => {
    fetchMock.mockResolvedValueOnce(new Response('invalid json', { status: 429 }))
      .mockRejectedValueOnce(new Error('socket closed'));
    expect(await service.post(endpoint, {})).toMatchObject({ success: false, error: { code: 'HTTP_429' } });
    expect(await service.post(endpoint, {})).toMatchObject({ success: false, error: { code: 'NETWORK_ERROR' } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('aborts a stalled response body within the total request budget without replaying it', async () => {
    fetchMock.mockImplementation(async (_url, options) => ({
      ok: true, status: 200, statusText: 'OK',
      json: () => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => {
        const error = new Error('Body timed out');
        error.name = 'AbortError';
        reject(error);
      })),
    }));
    const result = service.request(endpoint, { method: 'POST', timeout: 1000 });
    await jest.advanceTimersByTimeAsync(1000);
    expect(await result).toMatchObject({ success: false, error: { code: 'TIMEOUT' } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not retry GETs or DELETEs even on an allowlisted path', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(body(), 429));
    expect(await service.get(endpoint)).toMatchObject({ success: false });
    expect(await service.delete(endpoint)).toMatchObject({ success: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('cancels a cooldown without issuing another request', async () => {
    const controller = new AbortController();
    fetchMock.mockResolvedValueOnce(jsonResponse(body(), 429));
    const result = service.request(endpoint, { method: 'POST', signal: controller.signal });
    const cancelled = expect(result).rejects.toThrow('stop');
    await jest.advanceTimersByTimeAsync(1000);
    controller.abort(new Error('stop'));
    await cancelled;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each(['/api/agents/tools/sendEmail', '/api/workflow/start', `${endpoint}?operation=other`])(
    'does not broaden retries to other operations: %s', async path => {
      fetchMock.mockResolvedValue(jsonResponse(body(), 429));
      expect(await service.post(path, {})).toMatchObject({ success: false });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it('does not expose headers, request bodies or response contents in retry logs', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ...body(1), private: 'response-secret' }, 429))
      .mockResolvedValueOnce(jsonResponse({}));
    const result = service.post(endpoint, { private: 'body-secret' }, { Authorization: 'Bearer bearer-secret' });
    await jest.runAllTimersAsync();
    await result;
    const logs = JSON.stringify([...(console.log as jest.Mock).mock.calls,
      ...(console.warn as jest.Mock).mock.calls, ...(console.error as jest.Mock).mock.calls]);
    for (const secret of ['worker-secret', 'bearer-secret', 'body-secret', 'response-secret']) expect(logs).not.toContain(secret);
  });

  it('continues an owned ICP page without reprocessing earlier candidates after a 429', async () => {
    let row: any = { id: 'icp', site_id: 'site', role_query_id: 'role', total_targets: 2,
      processed_targets: 0, found_matches: 0, current_page: 0, current_page_offset: 0, checkpoint_version: 0 };
    const checkpoint = jest.fn(async (update: any) => {
      expect(update.version).toBe(row.checkpoint_version + 1);
      row = { ...row, processed_targets: update.processed, found_matches: update.found,
        current_page: update.page, current_page_offset: update.offset, current_page_snapshot: update.snapshot,
        checkpoint_version: update.version, status: update.status };
      return { success: true };
    });
    fetchMock.mockResolvedValueOnce(jsonResponse({ leadId: 'lead-1' }))
      .mockResolvedValueOnce(jsonResponse(body(), 429))
      .mockResolvedValueOnce(jsonResponse({ leadId: 'lead-2' }));
    const enrich = jest.fn(async (options: any) => {
      const result = await service.post(endpoint, { person_id: options.person_id, site_id: 'site' });
      return { success: result.success, leadId: result.data?.leadId, errors: result.error ? [result.error.message] : [] };
    });
    const search = jest.fn().mockResolvedValue({ success: true, total: 2, hasMore: false,
      data: { search_results: [{ person: { id: 1 } }, { person: { id: 2 } }] } });
    const dependencies: any = { checkpointIcpMiningExecutionActivity: checkpoint,
      getRoleQueryByIdActivity: jest.fn().mockResolvedValue({ success: true, roleQuery: { query: {} } }),
      callPersonRoleSearchActivity: search,
      getSegmentIdFromRoleQueryActivity: jest.fn().mockResolvedValue({ success: true }), enrich };
    const result = processOwnedIcp({ icp: row, options: { site_id: 'site' }, maxPages: 300,
      targetLeadsWithEmail: 2, execution: { runId: 'run', workflowId: 'workflow' },
      claim: async () => ({ acquired: true, icp: row }), checkpoint,
      deps: { executePageSearch: (options: any) => processPageSafely(options, dependencies) },
    } as any);
    await jest.advanceTimersByTimeAsync(43_249);
    expect(row).toMatchObject({ status: 'running', processed_targets: 1, current_page_offset: 1 });
    await jest.advanceTimersByTimeAsync(1);
    expect(await result).toMatchObject({ processed: 2, foundMatches: 2, errors: [] });
    expect(row).toMatchObject({ status: 'completed', processed_targets: 2, found_matches: 2, current_page_snapshot: null });
    expect(search).toHaveBeenCalledTimes(1);
    expect(enrich.mock.calls.map(([options]) => options.person_id)).toEqual(['1', '2']);
    expect(fetchMock.mock.calls.map(([, options]) => JSON.parse(options.body).person_id)).toEqual(['1', '2', '2']);
  });
});

describe('admission cooldown parsing', () => {
  const text = (value: unknown) => JSON.stringify({ success: false, error: { code: 'RATE_LIMITED', retry_after: value } });
  it('uses the later header/body hint including HTTP dates', () => {
    const now = Date.parse('2026-10-01T16:30:00Z');
    expect(admissionRetryAfterMs(429, text(43), 'Thu, 01 Oct 2026 16:31:00 GMT', now)).toBe(60_000);
    expect(admissionRetryAfterMs(429, text(43), '1', now)).toBe(43_000);
    expect(admissionRetryAfterMs(429, text(0), '0', now)).toBe(1000);
  });
  it.each([undefined, null, -1, 'bad', '9'.repeat(400)])('uses a safe fallback for invalid hints %s', value => {
    expect(admissionRetryAfterMs(429, text(value), 'invalid')).toBe(60_000);
  });
});