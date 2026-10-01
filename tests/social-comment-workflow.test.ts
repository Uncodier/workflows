const mockPatched = jest.fn(() => true);
const mockStartChild = jest.fn();
const mockActivities = {
  logWorkflowExecutionActivity: jest.fn(), fetchSitesWithSocialCommentsActivity: jest.fn(),
  fetchOutstandPostsActivity: jest.fn(), fetchOutstandAccountsActivity: jest.fn(),
  getSocialCommentSyncStatesActivity: jest.fn(), recordSocialCommentSyncSuccessActivity: jest.fn(),
  verifySocialCommentIngestionActivity: jest.fn(), upsertContentFromOutstandPostActivity: jest.fn(),
  fetchOutstandPostRepliesActivity: jest.fn(), claimSyncedObjectsBatchActivity: jest.fn(),
  finishSyncedObjectClaimActivity: jest.fn(),
};
jest.mock('@temporalio/workflow', () => ({
  ...jest.requireActual('@temporalio/workflow'), patched: mockPatched,
  proxyActivities: () => mockActivities, startChild: mockStartChild,
}));
jest.mock('../src/temporal/workflows/ingestSocialCommentWorkflow', () => ({ ingestSocialCommentWorkflow: jest.fn() }));

import { pollSocialCommentsWorkflow } from '../src/temporal/workflows/pollSocialCommentsWorkflow';

const now = Date.parse('2026-09-29T01:20:34Z');
const account = { id: 'account-1', network: 'instagram', isActive: true };
const site = { site_id: 'site-1', social_media: [account] };
const post = { id: 'post-1', publishedAt: '2026-09-04T18:57:32Z', createdAt: '2026-09-29T01:15:56Z',
  socialAccounts: [{ ...account, status: 'published', platformPostId: 'platform-post' }] };
const comment = { id: 'comment-1', text: 'A comment', author: 'example_person', author_id: 'author-1',
  author_name: 'Example Person', author_username: 'example_person', author_profile_url: 'https://www.instagram.com/example_person/' };

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(Date, 'now').mockReturnValue(now);
  jest.spyOn(console, 'error').mockImplementation(() => {});
  mockPatched.mockReturnValue(true);
  mockActivities.fetchSitesWithSocialCommentsActivity.mockResolvedValue([site]);
  mockActivities.fetchOutstandPostsActivity.mockResolvedValue([post]);
  mockActivities.fetchOutstandAccountsActivity.mockResolvedValue([]);
  mockActivities.getSocialCommentSyncStatesActivity.mockResolvedValue([]);
  mockActivities.upsertContentFromOutstandPostActivity.mockResolvedValue('content-1');
  mockActivities.fetchOutstandPostRepliesActivity.mockResolvedValue([comment]);
  mockActivities.claimSyncedObjectsBatchActivity.mockImplementation(async requests => requests.map((r: any) => ({ ...r, claimed: true, claimToken: 'claim-1' })));
  mockStartChild.mockResolvedValue({ result: () => Promise.resolve({ success: true }) });
});
afterEach(() => jest.restoreAllMocks());

it('imports the first comments off the midnight window and records success after ingestion', async () => {
  await expect(pollSocialCommentsWorkflow()).resolves.toEqual({ success: true, processedPosts: 1, processedComments: 1 });
  expect(mockActivities.fetchOutstandPostRepliesActivity).toHaveBeenCalledWith('site-1', 'post-1', 'instagram', { durableIdentity: true });
  expect(mockActivities.verifySocialCommentIngestionActivity).toHaveBeenCalledWith('site-1', ['outstand:instagram:comment-1']);
  expect(mockActivities.recordSocialCommentSyncSuccessActivity).toHaveBeenCalledWith('site-1', 'post-1', 'instagram');
  expect(mockActivities.recordSocialCommentSyncSuccessActivity.mock.invocationCallOrder[0]).toBeGreaterThan(mockActivities.verifySocialCommentIngestionActivity.mock.invocationCallOrder[0]);
  expect(mockStartChild.mock.calls[0][1].args[0].messageData).toMatchObject({
    name: 'Example Person', require_approval: true, custom_data: {
      author_id: 'author-1', author_name: 'Example Person', social_handle: 'example_person',
      profile_url: comment.author_profile_url, source: 'comment', outstand_post_id: 'post-1', content_id: 'content-1',
    },
  });
});

it('does not advance the checkpoint while the child is still running', async () => {
  let finish!: (value: { success: boolean }) => void;
  const pending = new Promise<{ success: boolean }>(resolve => { finish = resolve; });
  mockStartChild.mockResolvedValue({ result: () => pending });
  const running = pollSocialCommentsWorkflow();
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(mockStartChild).toHaveBeenCalledTimes(1);
  expect(mockActivities.recordSocialCommentSyncSuccessActivity).not.toHaveBeenCalled();
  finish({ success: true });
  await running;
  expect(mockActivities.recordSocialCommentSyncSuccessActivity).toHaveBeenCalledTimes(1);
});

it('does not acknowledge a child that failed to persist a comment', async () => {
  mockStartChild.mockResolvedValue({ result: () => Promise.reject(new Error('Not persisted')) });
  mockActivities.verifySocialCommentIngestionActivity.mockRejectedValue(new Error('Claim not completed'));
  await expect(pollSocialCommentsWorkflow()).rejects.toThrow('unsuccessful posts remain due');
  expect(mockActivities.recordSocialCommentSyncSuccessActivity).not.toHaveBeenCalled();
});

it('skips recently synchronized posts but catches up overdue posts at any hour', async () => {
  mockActivities.getSocialCommentSyncStatesActivity.mockResolvedValue([{ postId: 'post-1', network: 'instagram', lastSuccessAt: '2026-09-28T02:00:00Z' }]);
  await pollSocialCommentsWorkflow();
  expect(mockActivities.fetchOutstandPostRepliesActivity).not.toHaveBeenCalled();
  mockActivities.getSocialCommentSyncStatesActivity.mockResolvedValue([{ postId: 'post-1', network: 'instagram', lastSuccessAt: '2026-09-27T02:00:00Z' }]);
  await pollSocialCommentsWorkflow();
  expect(mockActivities.fetchOutstandPostRepliesActivity).toHaveBeenCalledTimes(1);
});

it('does an initial sync even when an imported post is over thirty days old', async () => {
  mockActivities.fetchOutstandPostsActivity.mockResolvedValue([{ ...post, publishedAt: '2026-06-01T00:00:00Z' }]);
  await pollSocialCommentsWorkflow();
  expect(mockActivities.fetchOutstandPostRepliesActivity).toHaveBeenCalledTimes(1);
});

it('records a genuinely empty response without starting a child', async () => {
  mockActivities.fetchOutstandPostRepliesActivity.mockResolvedValue([]);
  await pollSocialCommentsWorkflow();
  expect(mockStartChild).not.toHaveBeenCalled();
  expect(mockActivities.recordSocialCommentSyncSuccessActivity).toHaveBeenCalledTimes(1);
});

it('does not mark a provider failure as empty success and retries on the next run', async () => {
  mockActivities.fetchOutstandPostRepliesActivity.mockRejectedValueOnce(new Error('Degraded upstream'));
  await expect(pollSocialCommentsWorkflow()).rejects.toThrow('unsuccessful posts remain due');
  expect(mockActivities.recordSocialCommentSyncSuccessActivity).not.toHaveBeenCalled();
  await pollSocialCommentsWorkflow();
  expect(mockActivities.fetchOutstandPostRepliesActivity).toHaveBeenCalledTimes(2);
});

it('does not advance when starting a child fails', async () => {
  mockStartChild.mockRejectedValue(new Error('Start failed'));
  await expect(pollSocialCommentsWorkflow()).rejects.toThrow();
  expect(mockActivities.finishSyncedObjectClaimActivity).toHaveBeenCalledWith(expect.objectContaining({ status: 'error', claimToken: 'claim-1' }));
  expect(mockActivities.recordSocialCommentSyncSuccessActivity).not.toHaveBeenCalled();
});

it('verifies unclaimed comments instead of treating an in-flight claim as completed', async () => {
  mockActivities.claimSyncedObjectsBatchActivity.mockResolvedValue([{ claimed: false, externalId: 'outstand:instagram:comment-1' }]);
  mockActivities.verifySocialCommentIngestionActivity.mockRejectedValue(new Error('Still processing'));
  await expect(pollSocialCommentsWorkflow()).rejects.toThrow();
  expect(mockStartChild).not.toHaveBeenCalled();
  expect(mockActivities.recordSocialCommentSyncSuccessActivity).not.toHaveBeenCalled();
});

it('continues other networks after a failed post and exposes partial failure', async () => {
  mockActivities.fetchOutstandPostsActivity.mockResolvedValue([post, { ...post, id: 'post-2' }]);
  mockActivities.fetchOutstandPostRepliesActivity.mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValueOnce([]);
  await expect(pollSocialCommentsWorkflow()).rejects.toThrow();
  expect(mockActivities.recordSocialCommentSyncSuccessActivity).toHaveBeenCalledTimes(1);
  expect(mockActivities.recordSocialCommentSyncSuccessActivity).toHaveBeenCalledWith('site-1', 'post-2', 'instagram');
});

it('does not cross site ownership boundaries', async () => {
  mockActivities.fetchSitesWithSocialCommentsActivity.mockResolvedValue([site, { ...site, site_id: 'site-2' }]);
  await pollSocialCommentsWorkflow();
  expect(mockActivities.fetchOutstandPostRepliesActivity).not.toHaveBeenCalled();
});

it('passes the owned publisher separately and ingests readable string authors', async () => {
  mockActivities.fetchOutstandPostsActivity.mockResolvedValue([{
    ...post, socialAccounts: [{ ...post.socialAccounts[0], username: 'brand' }],
  }]);
  mockActivities.fetchOutstandPostRepliesActivity.mockResolvedValue([{ id: 'comment-1', text: 'Example', author: 'johndoe' }]);
  await pollSocialCommentsWorkflow();
  expect(mockActivities.fetchOutstandPostRepliesActivity).toHaveBeenCalledWith('site-1', 'post-1', 'instagram', { username: 'brand', durableIdentity: true });
  expect(mockStartChild.mock.calls[0][1].args[0].messageData).toMatchObject({
    name: 'johndoe', custom_data: {
      author_name: 'johndoe', author_username: 'johndoe', social_handle: 'johndoe',
      publisher_username: 'brand', publisher_account_id: 'account-1', author_identity_status: 'available',
    },
  });
});

it('preserves pre-identity-patch payloads and the three-argument activity call', async () => {
  mockPatched.mockImplementation(id => id !== 'poll-social-comments-author-identity-v2');
  mockActivities.fetchOutstandPostRepliesActivity.mockResolvedValue([{ id: 'comment-1', text: 'Example', author: 'johndoe' }]);
  await pollSocialCommentsWorkflow();
  expect(mockActivities.fetchOutstandPostRepliesActivity.mock.calls[0]).toEqual(['site-1', 'post-1', 'instagram']);
  const data = mockStartChild.mock.calls[0][1].args[0].messageData;
  expect(data.name).toBe('Social User');
  expect(data.custom_data).not.toHaveProperty('author_identity_status');
});

it('passes LinkedIn author references, not resolved profiles, to the child workflow', async () => {
  const linkedinAccount = { ...account, network: 'linkedin' };
  mockActivities.fetchSitesWithSocialCommentsActivity.mockResolvedValue([{ ...site, social_media: [linkedinAccount] }]);
  mockActivities.fetchOutstandPostsActivity.mockResolvedValue([{
    ...post, socialAccounts: [{ ...linkedinAccount, status: 'published', username: 'brand' }],
  }]);
  mockActivities.fetchOutstandPostRepliesActivity.mockResolvedValue([{
    id: 'comment-1', text: 'Example', author_id: 'urn:li:person:123',
    author_name: 'Resolved Person', author_username: 'resolved-person',
    author_profile_url: 'https://www.linkedin.com/in/resolved-person',
  }]);
  await pollSocialCommentsWorkflow();
  const data = mockStartChild.mock.calls[0][1].args[0].messageData;
  expect(data.custom_data).toMatchObject({
    author_id: 'urn:li:person:123', author_username: '', social_handle: '',
    author_name: '', profile_url: '', author_identity_status: 'resolve_on_read',
  });
  expect(JSON.stringify(data)).not.toMatch(/Resolved Person|resolved-person/);
});