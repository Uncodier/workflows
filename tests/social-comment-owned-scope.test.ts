const mockActivities: Record<string, jest.Mock> = Object.fromEntries([
  'initializeSocialCommentScopeActivity', 'findLegacySocialCommentClaimsActivity',
  'fetchOutstandPostRepliesActivity', 'claimSyncedObjectsBatchActivity',
  'finishSyncedObjectClaimActivity', 'verifySocialCommentIngestionActivity',
  'recordSocialCommentSyncSuccessActivity',
].map(name => [name, jest.fn()]));
const mockStartChild = jest.fn();
jest.mock('@temporalio/workflow', () => ({
  ...jest.requireActual('@temporalio/workflow'), proxyActivities: () => mockActivities, startChild: mockStartChild,
}));
jest.mock('../src/temporal/workflows/ingestSocialCommentWorkflow', () => ({ ingestSocialCommentWorkflow: jest.fn() }));
import { pollOwnedSocialComments } from '../src/temporal/workflows/helpers/pollOwnedSocialComments';
import { commentScopeKey, commentsAfterBoundary, scopedCommentExternalId } from '../src/temporal/workflows/helpers/socialCommentScope';

const scope = { siteId: 'site', postId: 'post', network: 'x', accountId: 'account-1' };
const boundary = '2026-10-01T00:00:00.000Z';
const now = Date.parse('2026-10-02T00:00:00.000Z');
const account = { id: 'account-1', network: 'twitter', username: 'brand', platformPostId: 'platform-post' };
const post = { id: 'post', publishedAt: boundary, url: 'https://x.com/brand/status/1' };
const comment = { id: 'provider-id', platform_comment_id: 'platform-comment', text: 'Hello',
  author_id: 'author', parent_comment_id: 'parent', created_at: '2026-10-01T01:00:00.000Z' };

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  mockActivities.initializeSocialCommentScopeActivity.mockResolvedValue({ boundary });
  mockActivities.findLegacySocialCommentClaimsActivity.mockResolvedValue([]);
  mockActivities.fetchOutstandPostRepliesActivity.mockResolvedValue([comment]);
  mockActivities.claimSyncedObjectsBatchActivity.mockImplementation(async requests => requests.map((r: any) => ({
    externalId: r.externalId, claimed: true, claimToken: 'claim',
  })));
  mockStartChild.mockResolvedValue({ result: async () => ({ success: true }) });
});
afterEach(() => jest.restoreAllMocks());

it('iterates each account on one network; claims, workflow IDs and checkpoints cannot collide', async () => {
  const accounts = [account, { ...account, id: 'account-2', username: 'brand2', platformPostId: 'platform-post-2' }];
  await expect(pollOwnedSocialComments('site', post, accounts, 'content', now)).resolves.toEqual({ processed: 2, failed: 0 });
  for (let index = 0; index < accounts.length; index++) {
    const current = { ...scope, accountId: accounts[index].id };
    const externalId = scopedCommentExternalId(current, 'platform-comment');
    expect(mockActivities.fetchOutstandPostRepliesActivity).toHaveBeenNthCalledWith(index + 1, 'site', 'post', 'x', {
      accountId: accounts[index].id, username: accounts[index].username, durableIdentity: true,
    });
    expect(mockActivities.initializeSocialCommentScopeActivity).toHaveBeenNthCalledWith(index + 1, current, false);
    const child = mockStartChild.mock.calls[index][1];
    expect(child.args[0]).toMatchObject({ externalId, baseParams: { origin: 'x', origin_message_id: externalId },
      messageData: { require_approval: true, origin_message_id: externalId, custom_data: {
        source: 'comment', channel: 'x', network: 'x', publisher_account_id: accounts[index].id,
        outstand_post_id: 'post', platform_post_id: accounts[index].platformPostId,
        platform_comment_id: 'platform-comment', parent_comment_id: 'parent', author_id: 'author',
      } } });
    expect(mockActivities.verifySocialCommentIngestionActivity).toHaveBeenCalledWith('site', [externalId]);
    expect(mockActivities.recordSocialCommentSyncSuccessActivity).toHaveBeenCalledWith('site', commentScopeKey(current), 'x');
  }
  expect(mockStartChild.mock.calls[0][1].workflowId).not.toBe(mockStartChild.mock.calls[1][1].workflowId);
});

it('uses site, network, account and post namespaces without delimiter/sanitization collisions', () => {
  const id = scopedCommentExternalId(scope, 'c:1');
  for (const other of [
    { ...scope, siteId: 'other' }, { ...scope, network: 'instagram' },
    { ...scope, accountId: 'other' }, { ...scope, postId: 'other' },
  ]) expect(scopedCommentExternalId(other, 'c:1')).not.toBe(id);
  expect(scopedCommentExternalId(scope, 'c_1')).not.toBe(id);
  expect(scopedCommentExternalId({ ...scope, network: 'twitter' }, 'c:1')).toBe(id);
});

it('does not replay pre-cutoff comments but includes new-post comments before discovery', async () => {
  mockActivities.fetchOutstandPostRepliesActivity.mockResolvedValue([
    { ...comment, id: 'old', platform_comment_id: 'old', created_at: '2026-09-30T23:59:59.999Z' }, comment,
  ]);
  await pollOwnedSocialComments('site', { ...post, publishedAt: '2026-10-01T00:30:00Z' }, [account], 'content', now);
  expect(mockStartChild).toHaveBeenCalledTimes(1);
  expect(mockStartChild.mock.calls[0][1].args[0].messageData.custom_data.platform_comment_id).toBe('platform-comment');
  expect(commentsAfterBoundary([{ ...comment, created_at: boundary }], boundary)).toHaveLength(1);
});

it('does not recreate legacy proposals and preserves the explicit single-account fallback', async () => {
  mockActivities.findLegacySocialCommentClaimsActivity.mockResolvedValue(['outstand:x:platform-comment']);
  await expect(pollOwnedSocialComments('site', post, [account], 'content', now)).resolves.toEqual({ processed: 0, failed: 0 });
  expect(mockActivities.initializeSocialCommentScopeActivity).toHaveBeenCalledWith(scope, true);
  expect(mockActivities.findLegacySocialCommentClaimsActivity).toHaveBeenCalledWith(scope, ['outstand:x:platform-comment'], true);
  expect(mockStartChild).not.toHaveBeenCalled();
});

it('never replaces an absent commenter with the publishing account', async () => {
  mockActivities.fetchOutstandPostRepliesActivity.mockResolvedValue([{ ...comment, author_id: undefined, accountUsername: 'brand' }]);
  await pollOwnedSocialComments('site', post, [account], 'content', now);
  const data = mockStartChild.mock.calls[0][1].args[0].messageData.custom_data;
  expect(data).not.toHaveProperty('author_id');
  expect(data.social_handle).toBe('');
  expect(data.publisher_account_id).toBe('account-1');
});

it.each([undefined, 'invalid'])('surfaces missing/invalid creation time %s without advancing success', async created_at => {
  mockActivities.fetchOutstandPostRepliesActivity.mockResolvedValue([{ ...comment, created_at }]);
  await expect(pollOwnedSocialComments('site', post, [account], 'content', now)).resolves.toEqual({ processed: 0, failed: 1 });
  expect(mockStartChild).not.toHaveBeenCalled();
  expect(mockActivities.recordSocialCommentSyncSuccessActivity).not.toHaveBeenCalled();
});

it('does not guess an account ID or stop another valid account after failure', async () => {
  await expect(pollOwnedSocialComments('site', post, [{ ...account, id: undefined }, account], 'content', now))
    .resolves.toEqual({ processed: 1, failed: 1 });
  expect(mockActivities.fetchOutstandPostRepliesActivity).toHaveBeenCalledTimes(1);
});

it.each(['legacy', 'ingestion', 'verification'])('does not advance checkpoints on %s failure', async stage => {
  if (stage === 'legacy') mockActivities.findLegacySocialCommentClaimsActivity.mockRejectedValue(new Error('Not completed'));
  if (stage === 'ingestion') mockStartChild.mockResolvedValue({ result: async () => ({ success: false }) });
  if (stage === 'verification') mockActivities.verifySocialCommentIngestionActivity.mockRejectedValue(new Error('Missing'));
  await expect(pollOwnedSocialComments('site', post, [account], 'content', now)).resolves.toMatchObject({ failed: 1 });
  expect(mockActivities.recordSocialCommentSyncSuccessActivity).not.toHaveBeenCalled();
});

it('records a real empty read after verification, but skips reads within account cadence', async () => {
  mockActivities.fetchOutstandPostRepliesActivity.mockResolvedValue([]);
  await pollOwnedSocialComments('site', post, [account], 'content', now);
  expect(mockActivities.recordSocialCommentSyncSuccessActivity).toHaveBeenCalledTimes(1);
  mockActivities.initializeSocialCommentScopeActivity.mockResolvedValue({ boundary, lastSuccessAt: new Date(now).toISOString() });
  await pollOwnedSocialComments('site', post, [account], 'content', now);
  expect(mockActivities.fetchOutstandPostRepliesActivity).toHaveBeenCalledTimes(1);
});