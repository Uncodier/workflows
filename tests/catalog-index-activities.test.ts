import { randomBytes, randomUUID } from 'node:crypto';

// Never load real config/dotenv. Exercise the real shared HTTP transport with synthetic auth.
jest.mock('../src/config/config', () => ({
  apiConfig: { baseUrl: 'https://catalog.example.test', apiKey: require('node:crypto').randomBytes(32).toString('hex') },
}));
import { apiConfig } from '../src/config/config';
import { backfillCatalogIndexActivity, processCatalogIndexActivity } from '../src/temporal/activities/catalogIndexActivities';

const originalFetch = global.fetch;
const fetchMock = jest.fn();
const validBatch = { success: true, processed: 7, failed: 0, stale: 1, remaining: true };
const site = randomUUID();
const cursor = '00000000-0000-4000-8000-000000000001';

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300, status, statusText: '', headers: new Headers(),
    json: async () => body, text: async () => JSON.stringify(body),
  } as Response;
}

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = fetchMock;
  fetchMock.mockResolvedValue(response(validBatch));
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { global.fetch = originalFetch; jest.restoreAllMocks(); jest.useRealTimers(); });

test('uses real x-api-key transport and a bounded POST; no vectors or extra payload returned', async () => {
  const sensitive = randomBytes(24).toString('hex');
  fetchMock.mockResolvedValue(response({ ...validBatch, vectors: Array(2000).fill(0.1), documents: [sensitive], metadata: { token: sensitive } }));
  const result = await processCatalogIndexActivity({ limit: 8 });
  expect(result).toEqual(validBatch);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, options] = fetchMock.mock.calls[0];
  expect(url).toBe('https://catalog.example.test/api/catalog/index/process');
  expect(options).toMatchObject({ method: 'POST', body: JSON.stringify({ limit: 8 }), headers: {
    'Content-Type': 'application/json', 'x-api-key': apiConfig.apiKey,
  } });
  expect(options.signal).toBeInstanceOf(AbortSignal);
  expect(JSON.stringify(result).length).toBeLessThan(110);
  const serialized = JSON.stringify([result, (console.log as jest.Mock).mock.calls, (console.error as jest.Mock).mock.calls]);
  expect(serialized).not.toContain(apiConfig.apiKey);
  expect(serialized).not.toContain(sensitive);
  expect(serialized).not.toContain('vectors');
});

test('defaults to limit8 and tolerates old API lacking stale counter', async () => {
  fetchMock.mockResolvedValue(response({ success: true, processed: 0, failed: 0, remaining: false }));
  await expect(processCatalogIndexActivity()).resolves.toEqual({ success: true, processed: 0, failed: 0, stale: 0, remaining: false });
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ limit: 8 });
});

test('sends only backfill scope/cursor/limit and returns compact normalized keyset result', async () => {
  const next = 'ABCDEFAB-0000-4000-8000-000000000002';
  fetchMock.mockResolvedValue(response({ success: true, processed: 100, next_cursor: next, has_more: true, vectors: Array(2000).fill(1) }));
  await expect(backfillCatalogIndexActivity({ site_id: site.toUpperCase(), after_id: cursor })).resolves.toEqual({
    success: true, processed: 100, next_cursor: next.toLowerCase(), has_more: true,
  });
  expect(fetchMock.mock.calls[0][0]).toBe('https://catalog.example.test/api/catalog/index/backfill');
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ site_id: site, after_id: cursor, limit: 100 });
});

test('allows an empty final page with a null cursor', async () => {
  const empty = { success: true, processed: 0, next_cursor: null, has_more: false };
  fetchMock.mockResolvedValue(response(empty));
  await expect(backfillCatalogIndexActivity()).resolves.toEqual(empty);
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ limit: 100 });
});

test.each([400, 401, 403, 404, 422])('does not retry permanent HTTP %s or leak error bodies', async status => {
  const sensitive = randomBytes(32).toString('hex');
  fetchMock.mockResolvedValue(response({ error: sensitive, vectors: [1, 2, 3] }, status));
  const error = await processCatalogIndexActivity().catch(value => value);
  expect(error).toMatchObject({ type: 'CATALOG_INDEX_REQUEST_REJECTED', nonRetryable: true });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const serialized = JSON.stringify([error, String(error), error.stack, (console.error as jest.Mock).mock.calls]);
  expect(serialized).not.toContain(sensitive);
  expect(serialized).not.toContain(apiConfig.apiKey);
  expect(serialized).not.toContain('vectors');
});

test.each([408, 409, 425, 429, 500, 503])('leaves HTTP %s retry to Temporal, without local retries', async status => {
  fetchMock.mockResolvedValue(response({ success: false }, status));
  await expect(processCatalogIndexActivity()).rejects.toMatchObject({ type: 'CATALOG_INDEX_REQUEST_FAILED', nonRetryable: false });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test('strips transport failures, authenticated URLs and credentials from history/logs', async () => {
  const username = randomBytes(12).toString('hex');
  const password = randomBytes(24).toString('hex');
  const token = randomBytes(24).toString('hex');
  const url = new URL('https://errors.example.test/path');
  url.username = username;
  url.password = password;
  url.searchParams.set('token', token);
  fetchMock.mockRejectedValue(new Error(`request failed ${url.href} ${apiConfig.apiKey}`));
  const error = await processCatalogIndexActivity().catch(value => value);
  expect(error).toMatchObject({ type: 'CATALOG_INDEX_REQUEST_FAILED', nonRetryable: false });
  const serialized = JSON.stringify([error, String(error), error.stack, (console.log as jest.Mock).mock.calls, (console.error as jest.Mock).mock.calls]);
  for (const value of [username, password, token, apiConfig.apiKey]) expect(serialized).not.toContain(value);
});

test('aborts HTTP at 210 seconds, leaving headroom before Temporal 240 second timeout', async () => {
  jest.useFakeTimers();
  fetchMock.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  }));
  const result = processCatalogIndexActivity();
  const assertion = expect(result).rejects.toMatchObject({ type: 'CATALOG_INDEX_REQUEST_FAILED', nonRetryable: false });
  await jest.advanceTimersByTimeAsync(209_999);
  expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(false);
  await jest.advanceTimersByTimeAsync(1);
  await assertion;
  expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  expect(jest.getTimerCount()).toBe(0);
});

test.each([
  {}, { success: true }, { ...validBatch, processed: -1 }, { ...validBatch, failed: 0.5 },
  { ...validBatch, stale: 9 }, { ...validBatch, remaining: 'false' }, { ...validBatch, error: {} },
])('rejects malformed success payloads rather than assuming the queue is empty: %j', async body => {
  fetchMock.mockResolvedValue(response(body));
  await expect(processCatalogIndexActivity()).rejects.toMatchObject({ type: 'CATALOG_INDEX_INVALID_RESPONSE', nonRetryable: true });
});

test('checks the inner success flag, including the transport success/data envelope', async () => {
  fetchMock.mockResolvedValue(response({ success: false, error: 'failed operation' }));
  await expect(processCatalogIndexActivity()).rejects.toMatchObject({ type: 'CATALOG_INDEX_REQUEST_FAILED' });
  fetchMock.mockResolvedValue(response({ success: true, data: { success: false } }));
  await expect(processCatalogIndexActivity()).rejects.toMatchObject({ type: 'CATALOG_INDEX_REQUEST_FAILED' });
});

test.each([
  { processed: 100, next_cursor: null, has_more: true },
  { processed: 100, next_cursor: cursor, has_more: true },
  { processed: 100, next_cursor: 'not-a-uuid', has_more: true },
  { processed: 100, next_cursor: '00000000-0000-4000-8000-000000000000', has_more: true },
])('rejects invalid/non-advancing backfill cursors: %j', async body => {
  fetchMock.mockResolvedValue(response({ success: true, ...body }));
  await expect(backfillCatalogIndexActivity({ after_id: cursor })).rejects.toMatchObject({ type: 'CATALOG_INDEX_INVALID_RESPONSE', nonRetryable: true });
});

test.each([0, -1, 21, 1.5, NaN, Infinity])('rejects invalid process limit %s before HTTP', async limit => {
  await expect(processCatalogIndexActivity({ limit })).rejects.toMatchObject({ type: 'CATALOG_INDEX_INVALID_INPUT', nonRetryable: true });
  expect(fetchMock).not.toHaveBeenCalled();
});

test('allows a forward cursor on an idempotent page with zero newly enqueued records', async () => {
  const next = '00000000-0000-4000-8000-000000000009';
  fetchMock.mockResolvedValue(response({ success: true, processed: 0, next_cursor: next, has_more: true }));
  await expect(backfillCatalogIndexActivity({ after_id: cursor })).resolves.toMatchObject({
    processed: 0, next_cursor: next, has_more: true,
  });
});

test('validates backfill bounds/UUIDs before HTTP and accepts explicit maximum200', async () => {
  await expect(backfillCatalogIndexActivity({ limit: 201 })).rejects.toMatchObject({ type: 'CATALOG_INDEX_INVALID_INPUT' });
  await expect(backfillCatalogIndexActivity({ site_id: 'invalid' })).rejects.toMatchObject({ type: 'CATALOG_INDEX_INVALID_INPUT' });
  await expect(backfillCatalogIndexActivity({ after_id: 'invalid' })).rejects.toMatchObject({ type: 'CATALOG_INDEX_INVALID_INPUT' });
  expect(fetchMock).not.toHaveBeenCalled();
  fetchMock.mockResolvedValue(response({ success: true, processed: 200, next_cursor: cursor, has_more: true }));
  await expect(backfillCatalogIndexActivity({ limit: 200 })).resolves.toMatchObject({ processed: 200 });
});

test('retains bounded lexical refresh progress without copying arbitrary provider fields', async () => {
  fetchMock.mockResolvedValue(response({ ...validBatch, processed: 0, refreshed: 100, arbitrary: ['private'] }));
  await expect(processCatalogIndexActivity()).resolves.toMatchObject({ processed: 0, refreshed: 100 });
  fetchMock.mockResolvedValue(response({ ...validBatch, refreshed: 101 }));
  await expect(processCatalogIndexActivity()).rejects.toMatchObject({ type: 'CATALOG_INDEX_INVALID_RESPONSE' });
});