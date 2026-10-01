const mockRpc = jest.fn();
const mockDescribe = jest.fn();
const mockClose = jest.fn();
const mockHandle = jest.fn(() => ({ describe: mockDescribe }));
jest.mock('../src/lib/supabase/client', () => ({ supabaseServiceRole: { rpc: mockRpc } }));
jest.mock('../src/temporal/client', () => ({ getTemporalClient: async () => ({
  workflow: { getHandle: mockHandle }, connection: { close: mockClose },
}) }));
import { claimIcpMiningExecutionActivity, checkpointIcpMiningExecutionActivity } from '../src/temporal/activities/icpMiningExecutionActivities';
import { processOwnedIcp } from '../src/temporal/workflows/icpMining/processOwned';

describe('ICP execution activities', () => {
  const params = { id: 'icp', site_id: 'site', run_id: 'new-run', workflow_id: 'workflow' };
  beforeEach(() => { jest.clearAllMocks(); mockRpc.mockReset(); });
  it('does not steal a running Temporal execution', async () => {
    mockRpc.mockResolvedValue({ data: { acquired: false, reason: 'busy', owner_run_id: 'old-run', owner_workflow_id: 'old-workflow' } });
    mockDescribe.mockResolvedValue({ status: { name: 'RUNNING' } });
    expect(await claimIcpMiningExecutionActivity(params)).toEqual({ acquired: false, reason: 'busy' });
    expect(mockHandle).toHaveBeenCalledWith('old-workflow', 'old-run');
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockClose).toHaveBeenCalled();
  });
  it('takes over only the exact verified terminal owner using a database compare-and-swap', async () => {
    mockRpc.mockResolvedValueOnce({ data: { acquired: false, reason: 'busy', owner_run_id: 'old-run', owner_workflow_id: 'old-workflow' } })
      .mockResolvedValueOnce({ data: { acquired: true, icp: { id: 'icp' } } });
    mockDescribe.mockResolvedValue({ status: { name: 'TIMED_OUT' } });
    expect((await claimIcpMiningExecutionActivity(params)).acquired).toBe(true);
    expect(mockRpc.mock.calls[1][1]).toMatchObject({ p_previous_run_id: 'old-run', p_run_id: 'new-run' });
  });
  it('fails closed on unavailable Temporal history', async () => {
    mockRpc.mockResolvedValue({ data: { acquired: false, reason: 'busy', owner_run_id: 'old-run', owner_workflow_id: 'old-workflow' } });
    mockDescribe.mockRejectedValue(new Error('history unavailable'));
    await expect(claimIcpMiningExecutionActivity(params)).rejects.toThrow('history unavailable');
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });
  it('sends an idempotent owner/version checkpoint and surfaces a stale-write rejection', async () => {
    mockRpc.mockResolvedValue({ error: { message: 'Stale mining checkpoint' } });
    await expect(checkpointIcpMiningExecutionActivity({ id: 'icp', site_id: 'site', run_id: 'run', version: 3,
      processed: 2, found: 1, page: 0, offset: 2, status: 'running', snapshot: null })).rejects.toThrow('Stale mining checkpoint');
    expect(mockRpc.mock.calls[0][1]).toMatchObject({ p_run_id: 'run', p_version: 3, p_processed: 2, p_found: 1, p_offset: 2 });
  });

  it.each(['new claim', 'same-run retry', 'terminal takeover'])('projects oversized acquired rows while preserving the owned checkpoint (%s)', async path => {
    const snapshot = { page: 2, hasMore: true, total: 100,
      candidates: [{ person: { id: 'p1', raw_result: { must_survive_resume: true } }, organization: { id: 'org' } }] };
    const expected = { id: 'icp', site_id: 'site', role_query_id: 'role', name: 'Target list', status: 'running',
      total_targets: 100, processed_targets: 23, found_matches: 4, current_page: 2, current_page_offset: 3,
      created_at: '2026-09-29T00:00:00.000Z', checkpoint_version: 8, current_page_snapshot: snapshot };
    const errors = [{ message: 'historical error '.repeat(600_000) }];
    const persisted = Object.freeze({ ...expected, errors, last_error: errors[0].message, icp_criteria: { unused: errors },
      execution_run_id: 'new-run', execution_workflow_id: 'workflow', execution_active: true, future_audit_column: errors });
    const reason = path === 'same-run retry' ? { reason: 'same_run' } : {};
    const rpcData = { acquired: true, ...reason, icp: persisted, future_audit_column: errors };
    expect(Buffer.byteLength(JSON.stringify(errors))).toBeGreaterThan(8_600_000);
    if (path === 'terminal takeover') {
      mockRpc.mockResolvedValueOnce({ data: { acquired: false, reason: 'busy', owner_run_id: 'old-run', owner_workflow_id: 'old-workflow' } });
      mockDescribe.mockResolvedValue({ status: { name: 'COMPLETED' } });
    }
    mockRpc.mockResolvedValueOnce({ data: rpcData });

    const result = await claimIcpMiningExecutionActivity(params);
    expect(result).toEqual({ acquired: true, ...reason, icp: expected });
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(2048);
    expect(persisted.errors).toBe(errors);
    expect(persisted.current_page_snapshot).toBe(snapshot);
    expect(mockRpc).toHaveBeenLastCalledWith('claim_icp_mining_execution', {
      p_id: 'icp', p_site_id: 'site', p_run_id: 'new-run', p_workflow_id: 'workflow',
      p_previous_run_id: path === 'terminal takeover' ? 'old-run' : null,
    });

    // Verify the compact DTO still seeds the real owned consumer with the
    // authoritative partial-page snapshot/version/counters after serialization.
    const executePageSearch = jest.fn().mockResolvedValue({ processed: 1, foundMatches: 1, errors: [], total: 100,
      checkpoint: { processed: 24, found: 5, version: 9, page: 2, offset: 4, snapshot } });
    const checkpoint = jest.fn().mockResolvedValue({ success: true });
    await processOwnedIcp({ icp: { id: 'icp' }, options: { site_id: 'site' }, workflowId: 'workflow', maxPages: 1,
      pageSize: 10, targetLeadsWithEmail: 1, actualUserId: 'user', execution: { runId: 'new-run', workflowId: 'workflow' },
      claim: jest.fn().mockResolvedValue(JSON.parse(JSON.stringify(result))), checkpoint,
      deps: { executePageSearch, logWorkflowExecutionActivity: jest.fn(), markIcpMiningStartedActivity: jest.fn(),
        markIcpMiningCompletedActivity: jest.fn(), updateIcpMiningProgressActivity: jest.fn() } });
    expect(executePageSearch).toHaveBeenCalledWith(expect.objectContaining({ role_query_id: 'role', icp_mining_id: 'icp',
      page: 2, start_index: 3, snapshot, execution: { run_id: 'new-run', version: 8, processed: 23, found: 4 } }));
    expect(checkpoint).toHaveBeenCalledWith(expect.objectContaining({ processed: 24, found: 5, version: 10, offset: 4, snapshot }));
  });

  it.each(['same_run', 'not_pending'])('omits unused full rows from non-acquired RPC results (%s)', async reason => {
    const errors = [{ message: 'historical error '.repeat(600_000) }];
    mockRpc.mockResolvedValue({ data: { acquired: false, reason, icp: { id: 'icp', errors }, errors } });
    expect(await claimIcpMiningExecutionActivity(params)).toEqual({ acquired: false, reason });
    expect(mockHandle).not.toHaveBeenCalled();
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });

  it('keeps a lost takeover race compact without exposing the new owner or row', async () => {
    mockRpc.mockResolvedValueOnce({ data: { acquired: false, reason: 'busy', owner_run_id: 'old-run', owner_workflow_id: 'old-workflow' } })
      .mockResolvedValueOnce({ data: { acquired: false, reason: 'busy', owner_run_id: 'other-run', owner_workflow_id: 'other-workflow',
        icp: { errors: [{ message: 'historical error '.repeat(600_000) }] } } });
    mockDescribe.mockResolvedValue({ status: { name: 'FAILED' } });
    expect(await claimIcpMiningExecutionActivity(params)).toEqual({ acquired: false, reason: 'busy' });
    expect(mockClose).toHaveBeenCalled();
  });

  it('fails closed if an acquired claim has no execution state', async () => {
    mockRpc.mockResolvedValue({ data: { acquired: true, icp: null } });
    await expect(claimIcpMiningExecutionActivity(params)).rejects.toThrow('Mining claim returned no execution state');
  });
});