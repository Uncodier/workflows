const mockFrom = jest.fn();
const mockConnected = jest.fn();
jest.mock('../src/lib/supabase/client', () => ({ supabaseServiceRole: { from: mockFrom } }));
jest.mock('../src/temporal/services', () => ({ getSupabaseService: () => ({ getConnectionStatus: mockConnected }) }));
jest.mock('../src/temporal/services/apiService', () => ({ apiService: {} }));
import { getPendingIcpMiningActivity } from '../src/temporal/activities/finderActivities';

const id = (n: number) => `abcdef12-3456-7890-abcd-${String(n).padStart(12, '0')}`;
const row = (n: number, extra = {}) => ({ id: id(n), site_id: 'site', status: 'pending',
  created_at: new Date(Date.UTC(2026, 8, 1, 0, n)).toISOString(), ...extra });
const workflowFields = ['id', 'site_id', 'role_query_id', 'name', 'status', 'total_targets',
  'processed_targets', 'found_matches', 'current_page', 'current_page_offset', 'created_at'];

describe('selected ICP list queries', () => {
  let rows: ReturnType<typeof row>[];
  let queries: Array<Array<[string, ...any[]]>>;
  let failQuery: number;
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    mockConnected.mockResolvedValue(true);
    rows = Array.from({ length: 80 }, (_, n) => row(n));
    queries = [];
    failQuery = -1;
    // Evaluate the actual activity's filter/limit chain against many persisted rows.
    mockFrom.mockImplementation(() => {
      const ops: Array<[string, ...any[]]> = [];
      const index = queries.push(ops) - 1;
      const query: any = {};
      for (const method of ['select', 'eq', 'in', 'order', 'limit']) query[method] = (...args: any[]) => {
        ops.push([method, ...args]); return query;
      };
      query.then = (resolve: any, reject: any) => {
        if (index === failQuery) return Promise.resolve({ data: null, error: { message: 'database unavailable' } }).then(resolve, reject);
        let data = rows.slice();
        for (const [method, column, value] of ops) {
          if (method === 'eq') data = data.filter(item => (item as any)[column] === value);
          if (method === 'in') data = data.filter(item => value.includes((item as any)[column]));
        }
        data.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
        const limit = ops.find(([method]) => method === 'limit')?.[1];
        if (limit !== undefined) data = data.slice(0, limit);
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      };
      return query;
    });
  });
  afterEach(() => jest.restoreAllMocks());

  it('filters selected IDs before the limit so a newer selected list beyond the first 50 is available', async () => {
    const result = await getPendingIcpMiningActivity({ site_id: 'site', limit: 50, icp_mining_ids: [id(75)] });
    expect(result).toEqual({ success: true, items: [row(75)] });
    expect(queries).toHaveLength(1);
    const filterIndex = queries[0].findIndex(([method, field]) => method === 'in' && field === 'id');
    expect(filterIndex).toBeLessThan(queries[0].findIndex(([method]) => method === 'limit'));
  });
  it('only returns selected pending or running rows in the requested site', async () => {
    rows = [row(1), row(2, { status: 'running' }), row(3, { status: 'completed' }),
      row(4, { status: 'failed' }), row(5, { site_id: 'other-site' }), row(6)];
    const result = await getPendingIcpMiningActivity({ site_id: 'site', icp_mining_ids: [1, 2, 3, 4, 5].map(id) });
    expect(result.items?.map(item => item.id)).toEqual([id(1), id(2)]);
    expect(queries[0]).toContainEqual(['eq', 'site_id', 'site']);
    expect(queries[0]).toContainEqual(['in', 'status', ['running', 'pending']]);
  });
  it('does not query or substitute all lists when the explicit selection is empty', async () => {
    expect(await getPendingIcpMiningActivity({ site_id: 'site', icp_mining_ids: [] })).toEqual({ success: true, items: [] });
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockConnected).not.toHaveBeenCalled();
  });
  it('does not fall back when all selected IDs are deleted or no longer pending', async () => {
    rows.push(row(99, { status: 'completed' }));
    expect(await getPendingIcpMiningActivity({ site_id: 'site', icp_mining_ids: [id(99), id(100)] }))
      .toEqual({ success: true, items: [] });
    expect(queries).toHaveLength(1);
  });
  it('still includes newly created pending lists when no selection filter is supplied', async () => {
    rows = [row(1), row(2, { status: 'completed' }), row(3, { site_id: 'other-site' })];
    expect((await getPendingIcpMiningActivity({ site_id: 'site' })).items?.map(item => item.id)).toEqual([id(1)]);
    rows.push(row(4));
    expect((await getPendingIcpMiningActivity({ site_id: 'site' })).items?.map(item => item.id)).toEqual([id(1), id(4)]);
  });
  it('chunks large selections into bounded URLs while keeping the global query limit', async () => {
    rows = Array.from({ length: 250 }, (_, n) => row(n));
    const result = await getPendingIcpMiningActivity({ site_id: 'site', limit: 50,
      icp_mining_ids: rows.map(item => item.id).reverse() });
    expect(result.items?.map(item => item.id)).toEqual(rows.slice(0, 50).map(item => item.id));
    expect(queries).toHaveLength(3);
    for (const query of queries) {
      expect(query.find(([method, field]) => method === 'in' && field === 'id')?.[2].length).toBeLessThanOrEqual(100);
      expect(query.find(([method]) => method === 'select')?.[1].split(',').map((field: string) => field.trim())).toEqual(workflowFields);
    }
  });
  it.each([false, true])('keeps pending payloads compact despite huge audit history and snapshots (selected=%s)', async selected => {
    const expected = row(1, { role_query_id: 'role', name: 'Target list', total_targets: 100,
      processed_targets: 23, found_matches: 4, current_page: 2, current_page_offset: 3 });
    const errors = Array.from({ length: 860 }, () => ({ message: 'historical error '.repeat(700) }));
    const current_page_snapshot = { page: 2, candidates: [{ raw_result: 'snapshot'.repeat(150_000) }], hasMore: true };
    const persisted = { ...expected, errors, last_error: errors[0].message, current_page_snapshot,
      checkpoint_version: 5, execution_run_id: 'old-run', icp_criteria: { unused: 'criteria'.repeat(10_000) } };
    expect(Buffer.byteLength(JSON.stringify(errors))).toBeGreaterThan(8_600_000);
    rows = [persisted];

    // This mock deliberately returns full rows even after select: the activity's
    // DTO boundary must also guard against accidental future query/RPC widening.
    const result = await getPendingIcpMiningActivity({ site_id: 'site', ...(selected ? { icp_mining_ids: [id(1)] } : {}) });
    expect(result).toEqual({ success: true, items: [expected] });
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(2048);
    expect(queries[0].find(([method]) => method === 'select')?.[1].split(',').map((field: string) => field.trim())).toEqual(workflowFields);
    for (const query of queries) {
      expect(query.find(([method]) => method === 'select')?.[1]).not.toMatch(/\*|errors|last_error|icp_criteria|current_page_snapshot/);
    }
    expect(persisted.errors).toBe(errors);
    expect(persisted.errors).toHaveLength(860);
    expect(persisted.current_page_snapshot).toBe(current_page_snapshot);
  });
  it('fails closed on a later chunk error rather than processing partial or unselected results', async () => {
    failQuery = 1;
    expect(await getPendingIcpMiningActivity({ site_id: 'site', icp_mining_ids: Array.from({ length: 101 }, (_, n) => id(n)) }))
      .toEqual({ success: false, error: 'database unavailable' });
  });
  it('rejects selected lists without a site and malformed IDs before database access', async () => {
    expect((await getPendingIcpMiningActivity({ icp_mining_ids: [id(1)] })).success).toBe(false);
    expect((await getPendingIcpMiningActivity({ site_id: 'site', icp_mining_ids: ['not-an-id'] })).success).toBe(false);
    expect(mockFrom).not.toHaveBeenCalled();
  });
});