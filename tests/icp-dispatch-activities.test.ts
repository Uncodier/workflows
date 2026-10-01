const mockStart = jest.fn();
const mockClose = jest.fn();
const mockRpc = jest.fn();
const store: Record<string, any[]> = {};
const reads: Array<{ table: string; select?: string; ranges: number[] }> = [];
let readError: string | undefined;
jest.mock('../src/lib/supabase/client', () => ({ supabaseServiceRole: {
  rpc: (...args: any[]) => mockRpc(...args),
  from: (table: string) => {
    const read = { table, select: '', ranges: [] as number[] }; reads.push(read);
    const query: any = {
      select: (value: string) => { read.select = value; return query; },
      eq: () => query, is: () => query, in: () => query, or: () => query, order: () => query,
      single: async () => ({ data: store[table]?.[0], error: readError === table ? { message: 'offline' } : null }),
      range: async (from: number, to: number) => { read.ranges.push(from); return {
        data: (store[table] || []).slice(from, to + 1), error: readError === table ? { message: 'offline' } : null,
      }; },
    }; return query;
  },
} }));
jest.mock('../src/temporal/client', () => ({ getTemporalClient: async () => ({ workflow: { start: mockStart }, connection: { close: mockClose } }) }));
import { beginIcpDispatchActivity, dispatchIcpMiningActivity, finishIcpDispatchActivity } from '../src/temporal/activities/icpDispatcherActivities';

const site = '00000000-0000-4000-8000-000000000001';
const list = '00000000-0000-4000-8000-000000000002';
beforeEach(() => {
  jest.resetAllMocks(); readError = undefined; reads.length = 0;
  Object.keys(store).forEach(key => delete store[key]);
  store.icp_dispatch_config = [{ id: true, enabled: true, max_concurrency: 3, slice_candidates: 10, daily_candidate_limit: 3000 }];
  store.sites = [{ id: site, user_id: 'user' }];
  store.settings = [{ site_id: site, activities: { icp_lead_generation: { target_leads: 150, all_lists: true } } }];
  store.icp_mining = [{ id: list, site_id: site, total_targets: 1188, processed_targets: 0, current_page_offset: 0, snapshot_page: 0, execution_active: false }];
  store.icp_dispatch_site_state = []; store.icp_dispatch_list_state = []; store.icp_dispatch_runs = [];
  mockRpc.mockImplementation(async (name, params) => ({ data: name === 'reserve_icp_dispatch' ? { acquired: true,
    reservation: { id: 'reservation', site_id: site, icp_mining_id: list, workflow_id: params.p_workflow_id,
      reserved_candidates: 10, reserved_matches: 10, research_enabled: false } } : { success: true }, error: null }));
});

it('reserves one site turn before starting it, not the full target each tick', async () => {
  expect(await dispatchIcpMiningActivity({ dispatchId: 'tick' })).toMatchObject({ started: 1, active: 0 });
  expect(mockRpc).toHaveBeenCalledWith('reserve_icp_dispatch', expect.objectContaining({ p_site_id: site, p_icp_id: list }));
  expect(mockStart).toHaveBeenCalledWith('icpMiningSliceWorkflow', expect.objectContaining({
    taskQueue: 'default', workflowIdReusePolicy: 'REJECT_DUPLICATE', args: [{ reservationId: 'reservation' }],
  }));
  expect(mockRpc.mock.invocationCallOrder[0]).toBeLessThan(mockStart.mock.invocationCallOrder[0]);
  expect(mockClose).toHaveBeenCalled();
});

it('does not query lists or start anything while admission is disabled', async () => {
  store.icp_dispatch_config[0].enabled = false;
  expect(await dispatchIcpMiningActivity({ dispatchId: 'tick' })).toMatchObject({ enabled: false, started: 0 });
  expect(reads.map(read => read.table)).toEqual(['icp_dispatch_config']);
});

it.each(['settings', 'icp_dispatch_runs', 'icp_mining'])('fails closed on incomplete %s reads', async table => {
  readError = table;
  await expect(dispatchIcpMiningActivity({ dispatchId: 'tick' })).rejects.toThrow('offline');
  expect(mockStart).not.toHaveBeenCalled();
});

it('pages lists rather than starving sites outside the PostgREST result limit', async () => {
  store.icp_mining = Array.from({ length: 510 }, (_, i) => ({ ...store.icp_mining[0], id: i === 509 ? list : `other-${i}`, site_id: i === 509 ? site : 'deleted-site' }));
  expect(await dispatchIcpMiningActivity({ dispatchId: 'tick' })).toMatchObject({ started: 1 });
  expect(reads.filter(read => read.table === 'icp_mining').flatMap(read => read.ranges)).toEqual([0, 500]);
  expect(reads.find(read => read.table === 'icp_mining')!.select).not.toContain('errors');
  expect(reads.find(read => read.table === 'icp_mining')!.select).toContain('snapshot_page:current_page_snapshot->page');
});

it('keeps an explicit empty list selection empty', async () => {
  store.settings[0].activities.icp_lead_generation = { target_leads: 150, all_lists: false, list_ids: [] };
  expect(await dispatchIcpMiningActivity({ dispatchId: 'tick' })).toMatchObject({ started: 0 });
  expect(mockRpc).not.toHaveBeenCalled();
});

it('excludes active legacy mining even on another list of the site', async () => {
  store.icp_mining.push({ ...store.icp_mining[0], id: 'other', execution_active: true });
  expect(await dispatchIcpMiningActivity({ dispatchId: 'tick' })).toMatchObject({ started: 0 });
});

it('counts daily results/reservations across all lists and stops at the target', async () => {
  store.icp_dispatch_runs = [{ id: 'previous', site_id: site, state: 'settled', budget_day: new Date().toISOString().slice(0, 10),
    reserved_candidates: 10, reserved_matches: 10, found: 150 }];
  expect(await dispatchIcpMiningActivity({ dispatchId: 'tick' })).toMatchObject({ started: 0 });
});

it('retries the exact reserved->start handoff after a lost acknowledgement without spending another reservation', async () => {
  store.icp_dispatch_runs = [{ id: 'reserved', site_id: site, workflow_id: 'original-id', state: 'reserved',
    budget_day: '2000-01-01', reserved_candidates: 10, reserved_matches: 10 }];
  mockStart.mockRejectedValue(Object.assign(new Error('already running'), { name: 'WorkflowExecutionAlreadyStartedError' }));
  expect(await dispatchIcpMiningActivity({ dispatchId: 'another-tick' })).toMatchObject({ active: 1, started: 0, skipped: 1 });
  expect(mockStart).toHaveBeenCalledWith('icpMiningSliceWorkflow', expect.objectContaining({ workflowId: 'original-id' }));
  expect(mockRpc).not.toHaveBeenCalled();
});

it('never drops or refunds a reservation on an ambiguous Temporal start failure', async () => {
  mockStart.mockRejectedValue(new Error('connection reset'));
  expect(await dispatchIcpMiningActivity({ dispatchId: 'tick' })).toMatchObject({ started: 0, errors: [expect.stringContaining('connection reset')] });
  expect(mockRpc.mock.calls.map(([name]) => name)).toEqual(['reserve_icp_dispatch']);
});

it('projects claim results without accumulated mining error history', async () => {
  mockRpc.mockResolvedValue({ data: { acquired: true, reservation: { id: 'r', site_id: site, icp_mining_id: list,
    workflow_id: 'workflow', reserved_candidates: 10, reserved_matches: 10, research_enabled: false, error: 'history' }, icp: { id: list, site_id: site,
    current_page_snapshot: { page: 0, candidates: [] }, checkpoint_version: 0, errors: ['secret history'] } }, error: null });
  const result = await beginIcpDispatchActivity({ id: 'r', runId: 'run', workflowId: 'workflow' });
  expect(result.icp).not.toHaveProperty('errors');
  expect(result.icp).toHaveProperty('current_page_snapshot');
  expect(result.reservation).not.toHaveProperty('error');
});

it('sends bounded error summaries when settling and fails on unacknowledged settlement', async () => {
  mockRpc.mockResolvedValue({ data: null, error: { message: 'offline' } });
  await expect(finishIcpDispatchActivity({ id: 'r', runId: 'run', errors: Array(30).fill('x'.repeat(2000)), retryAfterSeconds: 300 }))
    .rejects.toThrow('offline');
  expect(mockRpc.mock.calls[0][1].p_errors).toHaveLength(20);
  expect(mockRpc.mock.calls[0][1].p_errors[0]).toHaveLength(1000);
});