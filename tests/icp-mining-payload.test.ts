const mockFrom = jest.fn();
const mockConnected = jest.fn();
const mockSelect = jest.fn();
const mockEq = jest.fn();
const mockSingle = jest.fn();
jest.mock('../src/lib/supabase/client', () => ({ supabaseServiceRole: { from: mockFrom } }));
jest.mock('../src/temporal/services', () => ({ getSupabaseService: () => ({ getConnectionStatus: mockConnected }) }));
jest.mock('../src/temporal/services/apiService', () => ({ apiService: {} }));
import { getIcpMiningByIdActivity } from '../src/temporal/activities/finderActivities';
import { toIcpMiningClaimResult, toIcpMiningWorkflowDto } from '../src/temporal/utils/icpMiningPayload';

describe('ICP by-ID activity payload', () => {
  const expected = { id: 'icp', site_id: 'site', role_query_id: 'role', name: 'Target list', status: 'running',
    total_targets: 100, processed_targets: 23, found_matches: 4, current_page: 2, current_page_offset: 3,
    created_at: '2026-09-29T00:00:00.000Z' };
  beforeEach(() => {
    jest.clearAllMocks();
    mockConnected.mockResolvedValue(true);
    mockFrom.mockReturnValue({ select: mockSelect });
    mockSelect.mockReturnValue({ eq: mockEq });
    mockEq.mockReturnValue({ single: mockSingle });
  });

  it('selects only workflow fields and never transports megabytes of historical errors', async () => {
    const errors = [{ message: 'historical error '.repeat(600_000) }];
    const snapshot = { page: 2, candidates: [{ raw_result: 'snapshot'.repeat(150_000) }], hasMore: true };
    const persisted = Object.freeze({ ...expected, errors, last_error: errors[0].message,
      current_page_snapshot: snapshot, checkpoint_version: 8, icp_criteria: { unused: 'criteria' },
      future_audit_column: errors });
    mockSingle.mockResolvedValue({ data: persisted, error: null });
    expect(Buffer.byteLength(JSON.stringify(errors))).toBeGreaterThan(8_600_000);

    const result = await getIcpMiningByIdActivity('icp');
    expect(result).toEqual({ success: true, icp: expected });
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(2048);
    expect(mockFrom).toHaveBeenCalledWith('icp_mining');
    expect(mockEq).toHaveBeenCalledWith('id', 'icp');
    expect(mockSelect).toHaveBeenCalledTimes(1);
    expect(mockSelect.mock.calls[0][0].split(',').map((field: string) => field.trim())).toEqual(Object.keys(expected));
    expect(persisted.errors).toBe(errors);
    expect(persisted.current_page_snapshot).toBe(snapshot);
  });

  it('preserves database failures without retrying a wildcard query', async () => {
    mockSingle.mockResolvedValue({ data: null, error: { message: 'column current_page_offset does not exist' } });
    expect(await getIcpMiningByIdActivity('icp')).toEqual({ success: false, error: 'column current_page_offset does not exist' });
    expect(mockSelect).toHaveBeenCalledTimes(1);
    expect(mockSelect.mock.calls[0][0]).not.toContain('*');
  });

  it('does not fabricate a row when the database has none', async () => {
    mockSingle.mockResolvedValue({ data: null, error: null });
    expect(await getIcpMiningByIdActivity('missing')).toEqual({ success: true, icp: null });
  });

  it('preserves zero/null cursors and counters without inventing values for legacy rows', () => {
    const legacy = { ...expected, total_targets: null, processed_targets: 0, found_matches: 0,
      current_page: 0, current_page_offset: null };
    expect(toIcpMiningWorkflowDto(legacy)).toEqual(legacy);
    const { current_page_offset: _offset, ...withoutOffset } = legacy;
    expect(toIcpMiningWorkflowDto(withoutOffset)).toEqual(withoutOffset);
    const result = toIcpMiningClaimResult({ acquired: true, icp: { ...legacy, checkpoint_version: 0, current_page_snapshot: null } });
    expect(result).toEqual({ acquired: true, icp: { ...legacy, checkpoint_version: 0, current_page_snapshot: null } });
  });
});