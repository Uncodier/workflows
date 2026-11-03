const mockDb = { schema: jest.fn(), from: jest.fn(), rpc: jest.fn() };
jest.mock('../src/lib/supabase/client', () => ({ supabaseServiceRole: mockDb }));
import { claimSyncedObjectsBatchActivity } from '../src/temporal/activities/syncedObjectActivities';
import { scopedCommentExternalId } from '../src/temporal/workflows/helpers/socialCommentScope';
import { postgrestTextIn } from '../src/lib/supabase/textFilters';

it('uses literal scoped identities when resetting expired leases and claiming the batch', async () => {
  const query: any = { then: (resolve: any) => Promise.resolve({ error: null }).then(resolve) };
  for (const method of ['update', 'eq', 'filter', 'lt']) query[method] = jest.fn().mockReturnValue(query);
  mockDb.schema.mockReturnValue(mockDb);
  mockDb.from.mockReturnValue(query);
  const externalId = scopedCommentExternalId({ siteId: 'site', postId: 'post', network: 'instagram', accountId: 'account' }, 'comment');
  mockDb.rpc.mockResolvedValue({ data: [{ external_id: externalId, claimed_token: 'token' }], error: null });
  await expect(claimSyncedObjectsBatchActivity([
    { siteId: 'site', objectType: 'social_comment', externalId },
  ])).resolves.toEqual([{ externalId, claimed: true, claimToken: 'token' }]);
  expect(query.filter).toHaveBeenCalledWith('external_id', 'in', postgrestTextIn([externalId]));
  expect(query.eq).toHaveBeenCalledWith('site_id', 'site');
  expect(mockDb.rpc).toHaveBeenCalledWith('claim_synced_objects_batch', expect.objectContaining({
    p_site_id: 'site', p_objects: [expect.objectContaining({ external_id: externalId })],
  }));
});