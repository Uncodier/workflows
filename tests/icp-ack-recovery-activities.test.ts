const mockRpc = jest.fn();
jest.mock('../src/lib/supabase/client', () => ({ supabaseServiceRole: { rpc: mockRpc } }));
jest.mock('../src/temporal/services/apiService', () => ({ apiService: {} }));
import { acknowledgeSelectedIcpPersonActivity, reconcileSelectedIcpPersonAckActivity,
  settleIcpDispatchPreflightActivity } from '../src/temporal/activities/icpSelectedPeopleActivities';

const receipt = { id: 'list', site_id: 'site', run_id: 'run', ordinal: '9007199254740993',
  person_id: '000123', version: 12, processed: 138, found: 115, lead_id: 'lead', outcome: 'matched' as const };
const expected = { version: 12, processed: 138, found: 115 };
const sqlArgs = { p_id: 'list', p_site_id: 'site', p_run_id: 'run', p_ordinal: receipt.ordinal,
  p_person_id: '000123', p_version: 12, p_processed: 138, p_found: 115, p_lead_id: 'lead', p_outcome: 'matched' };
beforeEach(() => jest.resetAllMocks());

it.each([acknowledgeSelectedIcpPersonActivity, reconcileSelectedIcpPersonAckActivity])(
  'uses one locked RPC with the exact person/receipt and post-ACK totals', async activity => {
    mockRpc.mockResolvedValue({ data: { ...expected, private_database_fields: ['not returned'] } });
    expect(await activity(receipt)).toEqual(expected);
    expect(mockRpc.mock.calls).toEqual([['reconcile_selected_icp_person_ack', sqlArgs]]);
  },
);

it.each(['no_match', 'needs_review'] as const)('resends an exact %s receipt with null lead', async outcome => {
  mockRpc.mockResolvedValue({ data: expected });
  await reconcileSelectedIcpPersonAckActivity({ ...receipt, outcome, lead_id: undefined });
  expect(mockRpc.mock.calls).toEqual([['reconcile_selected_icp_person_ack', { ...sqlArgs, p_lead_id: null, p_outcome: outcome }]]);
});

it('keeps the pre-patch ACK contract on old in-flight activities', async () => {
  mockRpc.mockResolvedValue({ data: expected });
  await acknowledgeSelectedIcpPersonActivity({ id: 'list', site_id: 'site', run_id: 'run', ordinal: receipt.ordinal,
    version: 12, outcome: 'matched', lead_id: 'lead' });
  expect(mockRpc.mock.calls).toEqual([['acknowledge_selected_icp_person', { p_id: 'list', p_site_id: 'site',
    p_run_id: 'run', p_ordinal: receipt.ordinal, p_version: 12, p_outcome: 'matched', p_lead_id: 'lead' }]]);
});

it.each(['P0001', '23514', '42501', '22P02', 'PGRST301'])('does not retry a definitive SQL denial (%s)', async code => {
  mockRpc.mockResolvedValue({ error: { code, message: 'denied' } });
  await expect(reconcileSelectedIcpPersonAckActivity(receipt)).rejects.toMatchObject({ nonRetryable: true });
});

it.each(['', '08006', '40001', '40P01', '55P03'])('keeps transport/serialization failure %s retryable', async code => {
  mockRpc.mockResolvedValue({ error: { code, message: 'not acknowledged' } });
  await expect(reconcileSelectedIcpPersonAckActivity(receipt)).rejects.not.toMatchObject({ nonRetryable: true });
});

it.each([null, { ...expected, version: 13 }, { ...expected, processed: 137 }, { ...expected, found: '115' }])(
  'refuses a malformed or advanced parent checkpoint, rather than finalizing with it: %j', async data => {
    mockRpc.mockResolvedValue({ data });
    await expect(reconcileSelectedIcpPersonAckActivity(receipt)).rejects.toMatchObject({ nonRetryable: true });
  },
);

const preflight = { id: 'reserved', runId: 'run', workflowId: 'slice', errors: ['denied'], retryAfterSeconds: 300 };
it('settles preflight through one fenced operation with the reservation/workflow/run identity', async () => {
  mockRpc.mockResolvedValue({ data: { success: true, next_eligible_at: '2026-11-19T15:05:00Z', extra: 'omit' } });
  expect(await settleIcpDispatchPreflightActivity(preflight)).toEqual({ next_eligible_at: '2026-11-19T15:05:00Z' });
  expect(mockRpc.mock.calls).toEqual([['settle_icp_dispatch_preflight', { p_id: 'reserved', p_run_id: 'run',
    p_workflow_id: 'slice', p_errors: ['denied'], p_retry_after_seconds: 300 }]]);
});

it.each([{ error: { message: 'unknown owner' } }, { data: { success: false } }, { data: {} }])(
  'never falls back to unowned release on an unconfirmed preflight receipt: %j', async response => {
    mockRpc.mockResolvedValue(response);
    await expect(settleIcpDispatchPreflightActivity(preflight)).rejects.toThrow('settlement unconfirmed');
    expect(mockRpc).toHaveBeenCalledTimes(1);
  },
);