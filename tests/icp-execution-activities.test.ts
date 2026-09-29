const mockRpc = jest.fn();
const mockDescribe = jest.fn();
const mockClose = jest.fn();
const mockHandle = jest.fn(() => ({ describe: mockDescribe }));
jest.mock('../src/lib/supabase/client', () => ({ supabaseServiceRole: { rpc: mockRpc } }));
jest.mock('../src/temporal/client', () => ({ getTemporalClient: async () => ({
  workflow: { getHandle: mockHandle }, connection: { close: mockClose },
}) }));
import { claimIcpMiningExecutionActivity, checkpointIcpMiningExecutionActivity } from '../src/temporal/activities/icpMiningExecutionActivities';

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
});