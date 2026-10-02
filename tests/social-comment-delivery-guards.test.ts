const mockDatabase = { schema: jest.fn(), from: jest.fn() };
const mockCleanup = jest.fn();
jest.mock('../src/lib/supabase/client', () => ({ supabaseServiceRole: mockDatabase }));
jest.mock('../src/temporal/activities/leadActivities', () => ({ cleanupFailedFollowUpActivity: mockCleanup }));
jest.mock('../src/temporal/services/supabaseService', () => ({ getSupabaseService: () => ({ getConnectionStatus: async () => true }) }));
import { cleanupFailedFollowUpActivity } from '../src/temporal/activities/commentSafeCleanupActivity';
import { updateMessageStatusToSentActivity } from '../src/temporal/activities/updateMessageStatusActivity';

function query(data: any, error: any = null) {
  const q: any = { then: (resolve: any) => Promise.resolve({ data, error }).then(resolve) };
  for (const method of ['select', 'eq', 'limit', 'single', 'update']) q[method] = jest.fn().mockReturnValue(q);
  mockDatabase.from.mockReturnValueOnce(q);
  return q;
}
beforeEach(() => {
  jest.resetAllMocks(); mockDatabase.schema.mockReturnValue(mockDatabase);
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());
const request = { site_id: 'site', lead_id: 'lead', conversation_id: 'conversation', message_id: 'proposal', failure_reason: 'failed' };

it('protects comments from already queued destructive cleanup commands', async () => {
  const q = query([{ id: 'proposal' }]);
  await expect(cleanupFailedFollowUpActivity(request)).resolves.toMatchObject({ message_deleted: false });
  expect(q.eq).toHaveBeenCalledWith('conversations.site_id', 'site');
  expect(mockCleanup).not.toHaveBeenCalled();
});

it('preserves legacy non-comment cleanup behavior after a safe read', async () => {
  query([]); mockCleanup.mockResolvedValue({ success: true });
  await cleanupFailedFollowUpActivity(request);
  expect(mockCleanup).toHaveBeenCalledWith(request);
});

it.each([true, false])('does not overwrite API comment receipt/target for generic success=%s', async delivery_success => {
  const q = query({ id: 'proposal', conversation_id: 'conversation', custom_data: {
    source: 'comment', reply_to_message_id: 'inbound', comment_delivery_status: 'unknown', provider_message_id: 'receipt',
  } });
  await expect(updateMessageStatusToSentActivity({ ...request, delivery_success, delivery_channel: 'instagram' }))
    .resolves.toMatchObject({ success: true });
  expect(q.update).not.toHaveBeenCalled();
});