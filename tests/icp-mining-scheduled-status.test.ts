import { createClient } from '@supabase/supabase-js';
import { batchUpsertCronStatus } from '../src/temporal/services/supabase-impl/cron';
import { saveIcpMiningScheduledStatus } from '../src/temporal/services/supabase-impl/icpMiningScheduledStatus';

const NOW = '2026-10-01T10:00:00.000Z';
const NEXT = '2026-10-01T12:00:00.000Z';
const LATER = '2026-10-02T12:00:00.000Z';
const LAST_RUN = '2026-09-30T12:05:00.000Z';
const VERSION = '2026-09-30T12:05:00.123456+00:00';
const ACTIVITY = 'idealClientProfileMiningWorkflow';
const update = { siteId: 'site', workflowId: 'icp-timer', scheduleId: 'icp-timer', nextRun: NEXT };

type Row = Record<string, unknown>;
type Request = { method: string; url: URL; headers: Headers; body?: Row | Row[] };

function previous(overrides: Row = {}): Row {
  return {
    id: 'cron-row', site_id: 'site', activity_name: ACTIVITY,
    workflow_id: 'old-child', schedule_id: 'old-timer', status: 'COMPLETED',
    last_run: LAST_RUN, next_run: null, updated_at: VERSION,
    created_at: '2026-09-01T00:00:00.000Z', error_message: null, retry_count: 0, progress: 100,
    ...overrides,
  };
}

/**
 * Run the real SDK against an in-memory PostgREST boundary. Predicates are applied
 * at commit time, not when the read snapshot is taken. Hooks deterministically
 * interleave the real runtime upsert and scheduler's conditional write.
 */
function fixture(initial: Row[] = []) {
  const db = {
    rows: structuredClone(initial),
    requests: [] as Request[],
    beforeWrite: undefined as ((request: Request) => void | Promise<void>) | undefined,
    afterRead: undefined as (() => void | Promise<void>) | undefined,
    fail: undefined as string | undefined,
  };
  let version = 0;
  const matches = (row: Row, url: URL) => [...url.searchParams.entries()].every(([column, filter]) => {
    if (column === 'select' || column === 'on_conflict') return true;
    if (filter === 'is.null') return row[column] === null;
    if (!filter.startsWith('eq.')) throw new Error(`Unexpected filter: ${filter}`);
    return row[column] !== null && String(row[column]) === filter.slice(3);
  });
  const changedAt = () => `2026-10-01T10:00:00.${String(++version).padStart(6, '0')}+00:00`;
  const fetchMock = jest.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
    const request: Request = {
      method: options?.method || 'GET', url: new URL(String(input)),
      headers: new Headers(options?.headers),
      body: options?.body ? JSON.parse(String(options.body)) : undefined,
    };
    expect(request.url.origin).toBe('https://supabase.invalid');
    expect(request.url.pathname).toBe('/rest/v1/cron_status');
    db.requests.push(request);
    if (db.fail === request.method) {
      return new Response(JSON.stringify({ message: 'mock database unavailable', code: 'XX000' }), { status: 500 });
    }
    if (request.method === 'GET') {
      const columns = request.url.searchParams.get('select')!.split(',');
      const snapshot = db.rows.filter(row => matches(row, request.url))
        .map(row => Object.fromEntries(columns.map(column => [column, row[column]])));
      const hook = db.afterRead;
      db.afterRead = undefined;
      await hook?.();
      return new Response(JSON.stringify(snapshot), { status: 200 });
    }

    const hook = db.beforeWrite;
    db.beforeWrite = undefined;
    await hook?.(request);
    if (request.method === 'PATCH') {
      db.rows = db.rows.map(row => matches(row, request.url)
        ? { ...row, ...request.body, updated_at: changedAt() } : row);
    } else if (request.method === 'POST') {
      expect(request.url.searchParams.get('on_conflict')).toBe('site_id,activity_name');
      const records = Array.isArray(request.body) ? request.body : [request.body!];
      for (const record of records) {
        const index = db.rows.findIndex(row => row.site_id === record.site_id && row.activity_name === record.activity_name);
        if (index === -1) {
          db.rows.push({ id: `inserted-${db.rows.length}`, last_run: null, next_run: null, ...record });
        } else if (!request.headers.get('prefer')?.includes('resolution=ignore-duplicates')) {
          db.rows[index] = { ...db.rows[index], ...record, updated_at: changedAt() };
        }
      }
    } else {
      throw new Error(`Unexpected method: ${request.method}`);
    }
    return new Response(null, { status: 204 });
  });
  const client = createClient('https://supabase.invalid', 'mock-service-key', {
    global: { fetch: fetchMock },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return { db, client, writes: () => db.requests.filter(request => request.method !== 'GET') };
}

beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(Date.parse(NOW));
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  // Any accidental network call outside the fixture fails rather than going live.
  jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Live HTTP is forbidden in this test'));
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('safe ICP scheduled status publication', () => {
  it('inserts only ICP scheduling fields, ignoring unique-key conflicts', async () => {
    const f = fixture();
    await saveIcpMiningScheduledStatus(f.client, update);
    expect(f.db.rows).toEqual([expect.objectContaining({
      site_id: update.siteId, activity_name: ACTIVITY, workflow_id: update.workflowId,
      schedule_id: update.scheduleId, status: 'SCHEDULED', next_run: NEXT, last_run: null,
    })]);
    expect(f.writes()).toHaveLength(1);
    expect(f.writes()[0].headers.get('prefer')).toContain('resolution=ignore-duplicates');
    expect(f.writes()[0].body).toEqual({ site_id: 'site', activity_name: ACTIVITY,
      workflow_id: 'icp-timer', schedule_id: 'icp-timer', status: 'SCHEDULED', next_run: NEXT, updated_at: NOW });
  });

  it.each(['RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'running', 'completed', 'pending'])(
    'retains same-timer %s when the child published before the scheduler read', async status => {
      const f = fixture();
      await batchUpsertCronStatus(f.client, [{ ...previous(), schedule_id: update.scheduleId,
        workflow_id: 'real-child-id', status }]);
      const snapshot = structuredClone(f.db.rows);
      f.db.requests.length = 0;
      await saveIcpMiningScheduledStatus(f.client, update);
      expect(f.db.rows).toEqual(snapshot);
      expect(f.writes()).toHaveLength(0);
    },
  );

  it.each(['RUNNING', 'running'])('retains %s even for a different timer', async status => {
    const row = previous({ status });
    const f = fixture([row]);
    await saveIcpMiningScheduledStatus(f.client, update);
    expect(f.db.rows).toEqual([row]);
    expect(f.writes()).toHaveLength(0);
  });

  it.each(['2026-10-01T11:00:00.000Z', NEXT])('retains an existing nearer/equal future timer: %s', async nextRun => {
    const row = previous({ status: 'scheduled', next_run: nextRun });
    const f = fixture([row]);
    await saveIcpMiningScheduledStatus(f.client, update);
    expect(f.db.rows).toEqual([row]);
    expect(f.writes()).toHaveLength(0);
  });

  it.each([
    { status: 'COMPLETED', next_run: null },
    { status: 'FAILED', next_run: null },
    { status: 'SCHEDULED', next_run: LATER },
    { status: 'SCHEDULED', next_run: NOW },
    { status: 'SCHEDULED', next_run: null },
  ])('publishes a safe future timer over $status/$next_run without erasing history', async overrides => {
    const row = previous({ ...overrides, error_message: 'previous diagnostic', retry_count: 2 });
    const f = fixture([row]);
    await saveIcpMiningScheduledStatus(f.client, update);
    expect(f.db.rows).toEqual([{ ...row, workflow_id: update.workflowId, schedule_id: update.scheduleId,
      status: 'SCHEDULED', next_run: NEXT, updated_at: expect.any(String) }]);
    expect(f.writes()[0].body).not.toHaveProperty('last_run');
    expect(f.writes()[0].body).not.toHaveProperty('error_message');
    expect(f.writes()[0].method).toBe('PATCH');
  });

  it('uses exact raw DB timestamp/casing and scopes all CAS filters', async () => {
    const f = fixture([previous({ status: 'completed', next_run: LAST_RUN })]);
    await saveIcpMiningScheduledStatus(f.client, update);
    expect(Object.fromEntries(f.writes()[0].url.searchParams)).toEqual({
      id: 'eq.cron-row', site_id: 'eq.site', activity_name: `eq.${ACTIVITY}`,
      status: 'eq.completed', schedule_id: 'eq.old-timer', next_run: `eq.${LAST_RUN}`,
      updated_at: `eq.${VERSION}`,
    });
  });

  it('matches nullable legacy version/schedule/next_run fields using IS NULL', async () => {
    const f = fixture([previous({ updated_at: null, schedule_id: null })]);
    await saveIcpMiningScheduledStatus(f.client, update);
    expect(f.db.rows[0].status).toBe('SCHEDULED');
    expect(Object.fromEntries(f.writes()[0].url.searchParams)).toMatchObject({
      updated_at: 'is.null', schedule_id: 'is.null', next_run: 'is.null',
    });
  });

  it('is idempotent and keeps unrelated sites/activities untouched', async () => {
    const others = [previous({ id: 'other-site', site_id: 'other-site' }),
      previous({ id: 'other-activity', activity_name: 'syncEmailsWorkflow' })];
    const f = fixture([...others, previous()]);
    await saveIcpMiningScheduledStatus(f.client, update);
    const snapshot = structuredClone(f.db.rows);
    await saveIcpMiningScheduledStatus(f.client, update);
    expect(f.db.rows).toEqual(snapshot);
    expect(f.db.rows.slice(0, 2)).toEqual(others);
    expect(f.writes()).toHaveLength(1);
  });
});

describe('ICP scheduling/runtime interleavings', () => {
  it.each(['RUNNING', 'COMPLETED', 'FAILED'])(
    'does not overwrite a child that writes %s between the read and conditional update', async status => {
      const f = fixture([previous({ status: 'SCHEDULED', next_run: LATER })]);
      let winner: Row[] = [];
      f.db.beforeWrite = async request => {
        expect(request.method).toBe('PATCH');
        await batchUpsertCronStatus(f.client, [{ ...previous(), workflow_id: 'real-child',
          schedule_id: update.scheduleId, status, last_run: NOW, next_run: null }]);
        winner = structuredClone(f.db.rows);
      };
      await saveIcpMiningScheduledStatus(f.client, update);
      expect(f.db.rows).toEqual(winner);
      expect(f.db.rows[0]).toMatchObject({ status, workflow_id: 'real-child', last_run: NOW });
      expect(f.db.requests.filter(request => request.method === 'GET')).toHaveLength(1);
      expect(f.writes().map(request => request.method)).toEqual(['PATCH', 'POST']);
    },
  );

  it.each(['RUNNING', 'COMPLETED', 'FAILED', 'SCHEDULED'])(
    'ignores a concurrent row insert with %s after reading no row', async status => {
      const f = fixture();
      let winner: Row[] = [];
      f.db.beforeWrite = async request => {
        expect(request.method).toBe('POST');
        await batchUpsertCronStatus(f.client, [{ ...previous(), schedule_id: update.scheduleId,
          workflow_id: 'winning-child', status, last_run: NOW, next_run: '2026-10-01T11:00:00.000Z' }]);
        winner = structuredClone(f.db.rows);
      };
      await saveIcpMiningScheduledStatus(f.client, update);
      expect(f.db.rows).toEqual(winner);
      expect(f.db.rows).toHaveLength(1);
      expect(f.writes()).toHaveLength(2);
      expect(f.writes()[0].headers.get('prefer')).toContain('resolution=ignore-duplicates');
    },
  );

  it.each([
    { updated_at: '2026-10-01T10:00:00.000001+00:00' },
    { status: 'RUNNING' },
    { schedule_id: 'other-winning-timer' },
    { next_run: '2026-10-01T11:00:00.000Z' },
    { id: 'replacement-row' },
  ])('loses the CAS when any single observed token changes: %j', async changed => {
    const row = previous();
    const f = fixture([row]);
    f.db.beforeWrite = () => { Object.assign(f.db.rows[0], changed); };
    await saveIcpMiningScheduledStatus(f.client, update);
    expect(f.db.rows).toEqual([{ ...row, ...changed }]);
    expect(f.writes().map(request => request.method)).toEqual(['PATCH']);
  });

  it('protects a runtime write that replaces a null legacy version', async () => {
    const f = fixture([previous({ updated_at: null, schedule_id: null })]);
    f.db.beforeWrite = () => { f.db.rows[0].updated_at = NOW; };
    await saveIcpMiningScheduledStatus(f.client, update);
    expect(f.db.rows[0]).toMatchObject({ status: 'COMPLETED', updated_at: NOW, schedule_id: null });
  });

  it('does not recreate a row deleted between read and update', async () => {
    const f = fixture([previous()]);
    f.db.beforeWrite = () => { f.db.rows = []; };
    await saveIcpMiningScheduledStatus(f.client, update);
    expect(f.db.rows).toEqual([]);
    expect(f.writes().map(request => request.method)).toEqual(['PATCH']);
  });

  it('retains the nearest timer when two future publications interleave', async () => {
    const f = fixture([previous()]);
    f.db.beforeWrite = async () => {
      await saveIcpMiningScheduledStatus(f.client, update);
    };
    await saveIcpMiningScheduledStatus(f.client, {
      ...update, workflowId: 'coverage-timer', scheduleId: 'coverage-timer', nextRun: LATER,
    });
    expect(f.db.rows[0]).toMatchObject({ workflow_id: update.workflowId, schedule_id: update.scheduleId,
      status: 'SCHEDULED', next_run: NEXT, last_run: LAST_RUN });
    expect(f.writes().map(request => request.method)).toEqual(['PATCH', 'PATCH']);
  });

  it('allows the runtime to advance an inserted SCHEDULED row normally', async () => {
    const f = fixture();
    await saveIcpMiningScheduledStatus(f.client, update);
    await batchUpsertCronStatus(f.client, [{ site_id: 'site', activity_name: ACTIVITY,
      workflow_id: 'actual-child', schedule_id: update.scheduleId, status: 'COMPLETED', last_run: NOW }]);
    await saveIcpMiningScheduledStatus(f.client, update);
    expect(f.db.rows[0]).toMatchObject({ status: 'COMPLETED', last_run: NOW, workflow_id: 'actual-child' });
    expect(f.writes()).toHaveLength(2);
  });
});

describe('ICP scheduling safe skips and errors', () => {
  it.each([NOW, LAST_RUN])('skips an already due target %s without a cron query', async nextRun => {
    const f = fixture();
    await saveIcpMiningScheduledStatus(f.client, { ...update, nextRun });
    expect(f.db.requests).toHaveLength(0);
  });

  it.each([{ rows: [] }, { rows: [previous()] }])('skips when the target becomes due during the read', async ({ rows }) => {
    const f = fixture(rows);
    f.db.afterRead = () => { jest.mocked(Date.now).mockReturnValue(Date.parse(NEXT)); };
    await saveIcpMiningScheduledStatus(f.client, update);
    expect(f.db.rows).toEqual(rows);
    expect(f.writes()).toHaveLength(0);
  });

  it('does not publish manual execution status', async () => {
    const f = fixture();
    await saveIcpMiningScheduledStatus(f.client, { ...update, scheduleId: 'manual-execution' });
    expect(f.db.requests).toHaveLength(0);
  });

  it('rejects invalid nextRun before touching cron status', async () => {
    const f = fixture();
    await expect(saveIcpMiningScheduledStatus(f.client, { ...update, nextRun: 'invalid' }))
      .rejects.toThrow('Invalid ICP scheduled nextRun');
    expect(f.db.requests).toHaveLength(0);
  });

  it.each([
    { method: 'GET', rows: [] },
    { method: 'POST', rows: [] },
    { method: 'PATCH', rows: [previous()] },
  ])('propagates $method errors without a fallback write', async ({ method, rows }) => {
    const f = fixture(rows);
    f.db.fail = method;
    await expect(saveIcpMiningScheduledStatus(f.client, update)).rejects.toThrow('mock database unavailable');
    expect(f.db.rows).toEqual(rows);
    expect(f.writes()).toHaveLength(method === 'GET' ? 0 : 1);
  });

  it('fails closed if the unique row invariant is broken', async () => {
    const rows = [previous(), previous({ id: 'duplicate' })];
    const f = fixture(rows);
    await expect(saveIcpMiningScheduledStatus(f.client, update)).rejects.toThrow('Failed to read ICP scheduled cron status');
    expect(f.writes()).toHaveLength(0);
    expect(f.db.rows).toEqual(rows);
  });
});