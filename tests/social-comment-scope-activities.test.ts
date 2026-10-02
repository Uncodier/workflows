const mockDatabase = { schema: jest.fn(), from: jest.fn() };
const mockStates = jest.fn();
const mockVerify = jest.fn();
jest.mock('../src/lib/supabase/client', () => ({ supabaseServiceRole: mockDatabase }));
jest.mock('../src/temporal/activities/socialCommentSyncActivities', () => ({
  getSocialCommentSyncStatesActivity: mockStates, verifySocialCommentIngestionActivity: mockVerify,
}));
import { findLegacySocialCommentClaimsActivity, initializeSocialCommentScopeActivity } from '../src/temporal/activities/socialCommentScopeActivities';
import { commentAccountBoundaryKey, commentScopeKey } from '../src/temporal/workflows/helpers/socialCommentScope';

const scope = { siteId: 'site', postId: 'post', network: 'x', accountId: 'account' };
const cutoff = '2026-10-01T00:00:00.000Z';
const legacyTime = '2026-09-30T00:00:00.000Z';
const row = (postId: string, lastSuccessAt = cutoff) => ({ postId, network: 'x', lastSuccessAt });
function query(data: any[] = [], error: any = null) {
  const q: any = { then: (resolve: any) => Promise.resolve({ data, error }).then(resolve) };
  for (const key of ['select', 'eq', 'in', 'range', 'order', 'upsert']) q[key] = jest.fn().mockReturnValue(q);
  mockDatabase.from.mockReturnValueOnce(q);
  return q;
}
beforeEach(() => {
  jest.resetAllMocks();
  mockDatabase.schema.mockReturnValue(mockDatabase);
});

it('persists an immutable account cutoff and separate post boundary without certifying success', async () => {
  jest.useFakeTimers().setSystemTime(new Date(cutoff));
  mockStates.mockResolvedValueOnce([]).mockResolvedValueOnce([row(commentAccountBoundaryKey(scope))])
    .mockResolvedValueOnce([row(commentScopeKey(scope, 'boundary'))]);
  const account = query(); const post = query();
  await expect(initializeSocialCommentScopeActivity(scope, false)).resolves.toEqual({ boundary: cutoff });
  expect(account.upsert).toHaveBeenCalledWith(expect.objectContaining({
    outstand_post_id: commentAccountBoundaryKey(scope), last_success_at: cutoff, site_id: 'site', network: 'x',
  }), { onConflict: 'site_id,outstand_post_id,network', ignoreDuplicates: true });
  expect(post.upsert).toHaveBeenCalledWith(expect.objectContaining({ outstand_post_id: commentScopeKey(scope, 'boundary') }), expect.anything());
  expect(mockDatabase.from).toHaveBeenCalledTimes(2);
  jest.useRealTimers();
});

it('inherits the original account cutoff for a new post discovered later', async () => {
  const later = { ...scope, postId: 'new-post' };
  mockStates.mockResolvedValueOnce([row(commentAccountBoundaryKey(scope))])
    .mockResolvedValueOnce([row(commentScopeKey(later, 'boundary'))]);
  const post = query();
  await expect(initializeSocialCommentScopeActivity(later, false)).resolves.toEqual({ boundary: cutoff });
  expect(post.upsert).toHaveBeenCalledWith(expect.objectContaining({ last_success_at: cutoff }), expect.anything());
  expect(commentAccountBoundaryKey(later)).toBe(commentAccountBoundaryKey(scope));
});

it('preserves legacy cutoff/cadence only for a single unambiguous account and never mutates legacy rows', async () => {
  mockStates.mockResolvedValueOnce([row('post', legacyTime), row(commentAccountBoundaryKey(scope))])
    .mockResolvedValueOnce([row(commentScopeKey(scope, 'boundary'), legacyTime)]);
  const post = query();
  await expect(initializeSocialCommentScopeActivity(scope, true)).resolves.toEqual({ boundary: legacyTime, lastSuccessAt: legacyTime });
  expect(post.upsert).toHaveBeenCalledWith(expect.objectContaining({
    outstand_post_id: commentScopeKey(scope, 'boundary'), last_success_at: legacyTime,
  }), expect.anything());
});

it('keeps the winning concurrent boundary and account-specific success on retry', async () => {
  mockStates.mockResolvedValueOnce([row('post', legacyTime), row(commentScopeKey(scope, 'boundary')), row(commentScopeKey(scope), cutoff)]);
  await expect(initializeSocialCommentScopeActivity(scope, true)).resolves.toEqual({ boundary: cutoff, lastSuccessAt: cutoff });
  expect(mockDatabase.from).not.toHaveBeenCalled();
});

it('fails closed when boundary insertion fails or persisted cutoff is missing', async () => {
  mockStates.mockResolvedValueOnce([]);
  query([], { message: 'database unavailable' });
  await expect(initializeSocialCommentScopeActivity(scope, false)).rejects.toThrow('database unavailable');
});

it('requires completed claims AND persisted messages before suppressing legacy IDs', async () => {
  const ledger = query([{ external_id: 'legacy', metadata: { outstand_post_id: 'post' } }]);
  const messages = query([]);
  await expect(findLegacySocialCommentClaimsActivity(scope, ['legacy'], true)).resolves.toEqual(['legacy']);
  expect(ledger.eq).toHaveBeenCalledWith('site_id', 'site');
  expect(messages.eq).toHaveBeenCalledWith('custom_data->>publisher_account_id', 'account');
  expect(mockVerify).toHaveBeenCalledWith('site', ['legacy']);
  mockVerify.mockRejectedValueOnce(new Error('Not completed'));
  query([{ external_id: 'legacy', metadata: { outstand_post_id: 'post' } }]); query([]);
  await expect(findLegacySocialCommentClaimsActivity(scope, ['legacy'], true)).rejects.toThrow('Not completed');
});

it('never suppresses a second-account comment using an unscoped legacy claim', async () => {
  const messages = query([]);
  await expect(findLegacySocialCommentClaimsActivity(scope, ['legacy'], false)).resolves.toEqual([]);
  expect(mockDatabase.from).toHaveBeenCalledTimes(1);
  expect(mockDatabase.from).toHaveBeenCalledWith('messages');
  expect(messages.eq).toHaveBeenCalledWith('custom_data->>outstand_post_id', 'post');
});