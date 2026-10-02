const mockPatched = jest.fn();
const mockStartChild = jest.fn();
const mockActivities = {
  fetchSitesWithSocialCommentsActivity: jest.fn(),
  fetchOutstandPostsActivity: jest.fn(),
  fetchOutstandPostRepliesActivity: jest.fn(),
  upsertContentFromOutstandPostActivity: jest.fn(),
  logWorkflowExecutionActivity: jest.fn(),
  fetchOutstandAccountsActivity: jest.fn(),
  importOutstandPostsActivity: jest.fn(),
  checkIfImportTriggeredActivity: jest.fn(),
  markImportTriggeredActivity: jest.fn(),
  fetchOutstandImportJobsActivity: jest.fn(),
  startInitialOutstandImportActivity: jest.fn(),
  recordInitialOutstandImportActivity: jest.fn(),
  claimSyncedObjectActivity: jest.fn(),
  claimSyncedObjectsBatchActivity: jest.fn(),
  finishSyncedObjectClaimActivity: jest.fn(),
};

jest.mock('@temporalio/workflow', () => ({
  ...jest.requireActual('@temporalio/workflow'),
  proxyActivities: () => mockActivities,
  patched: mockPatched,
  startChild: mockStartChild,
}));
// These tests inspect the parent's commands, not the child's implementation.
jest.mock('../src/temporal/workflows/ingestSocialCommentWorkflow', () => ({
  ingestSocialCommentWorkflow: jest.fn(),
}));

import { pollSocialCommentsWorkflow } from '../src/temporal/workflows/pollSocialCommentsWorkflow';

const durableSyncPatch = 'poll-social-comments-durable-sync-v1';
const ownershipPatch = 'poll-social-comments-strict-site-ownership-v1';
const tiktokPatch = 'poll-social-comments-tiktok-posts-v1';
const importJobPatch = 'poll-social-comments-import-job-status-v1';
const automaticImportPatch = 'poll-social-comments-auto-initial-import-v1';
const account = { id: 'account-1', network: 'linkedin', isActive: true };
const site = { site_id: 'site-1', social_media: [account] };
const now = Date.UTC(2026, 8, 26, 12);

function useOwnershipPatch(enabled: boolean) {
  mockPatched.mockImplementation((id: string) => id === ownershipPatch ? enabled :
    id === tiktokPatch || id === importJobPatch || id === automaticImportPatch || id === durableSyncPatch ? false : true);
}

function commandNames(): string[] {
  return Object.entries(mockActivities).flatMap(([name, activity]) =>
    activity.mock.invocationCallOrder.map(order => ({ name, order }))
  ).sort((a, b) => a.order - b.order).map(command => command.name);
}

function withAmbiguousPost() {
  mockActivities.fetchSitesWithSocialCommentsActivity.mockResolvedValue([
    site, { ...site, site_id: 'site-2' },
  ]);
  mockActivities.fetchOutstandPostsActivity.mockResolvedValue([{
    id: 'post-1', publishedAt: new Date(now).toISOString(),
    socialAccounts: [{ ...account, status: 'published', platformPostId: 'platform-post-1' }],
  }]);
  mockActivities.fetchOutstandPostRepliesActivity.mockResolvedValue([{
    id: 'comment-1', text: 'A comment', network: 'linkedin',
    author: { id: 'author-1', name: 'Author' },
  }]);
}

describe('pollSocialCommentsWorkflow ownership patch branches', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(Date, 'now').mockReturnValue(now);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    useOwnershipPatch(true);
    mockActivities.fetchSitesWithSocialCommentsActivity.mockResolvedValue([site]);
    mockActivities.fetchOutstandPostsActivity.mockResolvedValue([]);
    mockActivities.fetchOutstandAccountsActivity.mockResolvedValue([account]);
    mockActivities.fetchOutstandImportJobsActivity.mockResolvedValue([]);
    mockActivities.startInitialOutstandImportActivity.mockResolvedValue(true);
    mockActivities.recordInitialOutstandImportActivity.mockResolvedValue(true);
    mockActivities.checkIfImportTriggeredActivity.mockResolvedValue(false);
    mockActivities.fetchOutstandPostRepliesActivity.mockResolvedValue([]);
    mockActivities.upsertContentFromOutstandPostActivity.mockResolvedValue('content-1');
    mockActivities.claimSyncedObjectsBatchActivity.mockImplementation(async requests =>
      requests.map((request: { externalId: string }) => ({
        externalId: request.externalId, claimed: true, claimToken: 'claim-1',
      }))
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('records a distinct ownership patch before producing activity commands', async () => {
    await pollSocialCommentsWorkflow();
    expect(mockPatched.mock.calls.map(([id]) => id)).toEqual([
      'poll-social-comments-age-filter-v1',
      'poll-social-comments-bucket-cadence-v2',
      'poll-social-comments-batch-claims-v1',
      'poll-social-comments-safe-identifiers-v1',
      ownershipPatch,
      tiktokPatch,
      importJobPatch,
      automaticImportPatch,
      durableSyncPatch,
      'poll-social-comments-author-identity-v2',
      'poll-social-comments-owned-account-scope-v2',
    ]);
    expect(mockPatched.mock.invocationCallOrder[4]).toBeLessThan(
      mockActivities.logWorkflowExecutionActivity.mock.invocationCallOrder[0]
    );
  });

  it.each([false, true])('keeps the string ID contract with ownership patch = %s', async enabled => {
    useOwnershipPatch(enabled);
    await pollSocialCommentsWorkflow();
    expect(mockActivities.importOutstandPostsActivity).toHaveBeenCalledTimes(1);
    expect(mockActivities.importOutstandPostsActivity).toHaveBeenCalledWith('site-1', account.id);
    expect(mockActivities.markImportTriggeredActivity).toHaveBeenCalledWith('site-1');
  });

  it('preserves the legacy import sequence for histories without the patch marker', async () => {
    useOwnershipPatch(false);
    mockActivities.fetchOutstandAccountsActivity.mockResolvedValue([
      { id: 'foreign-account', network: 'facebook' }, account, { network: 'linkedin' },
    ]);
    await pollSocialCommentsWorkflow();
    expect(commandNames()).toEqual([
      'logWorkflowExecutionActivity', 'fetchSitesWithSocialCommentsActivity',
      'fetchOutstandPostsActivity', 'checkIfImportTriggeredActivity',
      'fetchOutstandAccountsActivity', 'importOutstandPostsActivity',
      'importOutstandPostsActivity', 'markImportTriggeredActivity',
      'logWorkflowExecutionActivity',
    ]);
    expect(mockActivities.importOutstandPostsActivity.mock.calls).toEqual([
      ['site-1', 'foreign-account'], ['site-1', account.id],
    ]);
  });

  it('filters foreign imports only in the new branch', async () => {
    mockActivities.fetchOutstandAccountsActivity.mockResolvedValue([
      { id: 'foreign-account', network: 'facebook' }, account,
    ]);
    await pollSocialCommentsWorkflow();
    expect(mockActivities.importOutstandPostsActivity).toHaveBeenCalledTimes(1);
    expect(mockActivities.importOutstandPostsActivity).toHaveBeenCalledWith('site-1', account.id);
  });

  it('does not import or mark completion when no account is owned', async () => {
    mockActivities.fetchOutstandAccountsActivity.mockResolvedValue([{ id: 'foreign-account', network: 'linkedin' }]);
    await pollSocialCommentsWorkflow();
    expect(mockActivities.importOutstandPostsActivity).not.toHaveBeenCalled();
    expect(mockActivities.markImportTriggeredActivity).not.toHaveBeenCalled();
  });

  it('rejects an import when two sites claim the same active account', async () => {
    mockActivities.fetchSitesWithSocialCommentsActivity.mockResolvedValue([site, { ...site, site_id: 'site-2' }]);
    await pollSocialCommentsWorkflow();
    expect(mockActivities.importOutstandPostsActivity).not.toHaveBeenCalled();
    expect(mockActivities.markImportTriggeredActivity).not.toHaveBeenCalled();
  });

  it.each([false, true])('does not mark a failed import complete with ownership patch = %s', async enabled => {
    useOwnershipPatch(enabled);
    mockActivities.importOutstandPostsActivity.mockRejectedValue(new Error('Ownership was revoked'));
    await pollSocialCommentsWorkflow();
    expect(mockActivities.markImportTriggeredActivity).not.toHaveBeenCalled();
  });

  it('preserves legacy post, claim and child commands even for ambiguous ownership', async () => {
    useOwnershipPatch(false);
    withAmbiguousPost();
    await expect(pollSocialCommentsWorkflow()).resolves.toEqual({
      success: true, processedPosts: 2, processedComments: 2,
    });
    expect(commandNames()).toEqual([
      'logWorkflowExecutionActivity', 'fetchSitesWithSocialCommentsActivity',
      'fetchOutstandPostsActivity', 'upsertContentFromOutstandPostActivity',
      'fetchOutstandPostRepliesActivity', 'claimSyncedObjectsBatchActivity',
      'fetchOutstandPostsActivity', 'upsertContentFromOutstandPostActivity',
      'fetchOutstandPostRepliesActivity', 'claimSyncedObjectsBatchActivity',
      'logWorkflowExecutionActivity',
    ]);
    expect(mockStartChild).toHaveBeenCalledTimes(2);
    for (const [index, siteId] of ['site-1', 'site-2'].entries()) {
      expect(mockStartChild.mock.calls[index][1]).toMatchObject({
        workflowId: `social-comment-${siteId}-outstand_linkedin_comment-1`,
        args: [{ siteId, externalId: 'outstand:linkedin:comment-1', claimToken: 'claim-1' }],
      });
    }
  });

  it('skips ambiguous post activities and child workflows only in the new branch', async () => {
    withAmbiguousPost();
    await expect(pollSocialCommentsWorkflow()).resolves.toEqual({
      success: true, processedPosts: 0, processedComments: 0,
    });
    expect(mockActivities.upsertContentFromOutstandPostActivity).not.toHaveBeenCalled();
    expect(mockActivities.fetchOutstandPostRepliesActivity).not.toHaveBeenCalled();
    expect(mockActivities.claimSyncedObjectsBatchActivity).not.toHaveBeenCalled();
    expect(mockStartChild).not.toHaveBeenCalled();
  });

  it('continues ingesting comments for a uniquely owned post in the new branch', async () => {
    withAmbiguousPost();
    mockActivities.fetchSitesWithSocialCommentsActivity.mockResolvedValue([site]);
    await expect(pollSocialCommentsWorkflow()).resolves.toEqual({
      success: true, processedPosts: 1, processedComments: 1,
    });
    expect(mockStartChild).toHaveBeenCalledTimes(1);
    expect(mockActivities.importOutstandPostsActivity).not.toHaveBeenCalled();
  });

  it('persists uniquely owned TikTok posts without attempting comment requests', async () => {
    mockPatched.mockImplementation((id: string) => id !== durableSyncPatch);
    const tikTok = { id: 'yTdoj', network: 'tiktok', isActive: true };
    const tikTokSite = { site_id: 'site-1', social_media: [tikTok] };
    mockActivities.fetchSitesWithSocialCommentsActivity.mockResolvedValue([tikTokSite]);
    mockActivities.fetchOutstandPostsActivity.mockResolvedValue([{
      id: 'video-1', publishedAt: new Date(now).toISOString(),
      containers: [{ content: 'A video' }],
      socialAccounts: [{ ...tikTok, status: 'published', platformPostId: 'tiktok-video-1' }],
    }]);

    await expect(pollSocialCommentsWorkflow()).resolves.toEqual({
      success: true, processedPosts: 1, processedComments: 0,
    });
    expect(mockActivities.upsertContentFromOutstandPostActivity).toHaveBeenCalledTimes(1);
    expect(mockActivities.fetchOutstandPostRepliesActivity).not.toHaveBeenCalled();
    expect(mockStartChild).not.toHaveBeenCalled();
  });

  it('persists a Bluesky post without calling unsupported comment endpoints', async () => {
    mockPatched.mockImplementation((id: string) => id !== durableSyncPatch);
    const bluesky = { id: 'bluesky-1', network: 'bluesky', isActive: true };
    mockActivities.fetchSitesWithSocialCommentsActivity.mockResolvedValue([
      { site_id: 'site-1', social_media: [bluesky] },
    ]);
    mockActivities.fetchOutstandPostsActivity.mockResolvedValue([{
      id: 'bluesky-post', publishedAt: new Date(now).toISOString(),
      socialAccounts: [{ ...bluesky, status: 'published', platformPostId: 'external-post' }],
      containers: [{ content: 'A post' }],
    }]);
    mockActivities.fetchOutstandAccountsActivity.mockResolvedValue([bluesky]);
    await expect(pollSocialCommentsWorkflow()).resolves.toMatchObject({ processedPosts: 1, processedComments: 0 });
    expect(mockActivities.fetchOutstandPostRepliesActivity).not.toHaveBeenCalled();
    expect(mockActivities.upsertContentFromOutstandPostActivity).toHaveBeenCalledTimes(1);
  });

  it('imports each owned social account at most once, even if the legacy site marker exists', async () => {
    mockPatched.mockImplementation((id: string) => id !== importJobPatch && id !== durableSyncPatch);
    const tiktok = { id: 'yTdoj', network: 'tiktok', isActive: true };
    const instagram = { id: 'Lm3jV', network: 'instagram', isActive: true };
    mockActivities.fetchSitesWithSocialCommentsActivity.mockResolvedValue([
      { site_id: 'site-1', social_media: [tiktok, instagram] },
    ]);
    mockActivities.fetchOutstandAccountsActivity.mockResolvedValue([tiktok, instagram]);
    mockActivities.checkIfImportTriggeredActivity.mockImplementation(async (_siteId, accountId) =>
      accountId === 'yTdoj'
    );

    await pollSocialCommentsWorkflow();
    expect(mockActivities.checkIfImportTriggeredActivity.mock.calls).toEqual([
      ['site-1', 'yTdoj'], ['site-1', 'Lm3jV'],
    ]);
    expect(mockActivities.importOutstandPostsActivity).toHaveBeenCalledTimes(1);
    expect(mockActivities.importOutstandPostsActivity).toHaveBeenCalledWith('site-1', 'Lm3jV');
    expect(mockActivities.markImportTriggeredActivity).toHaveBeenCalledWith('site-1', 'Lm3jV');
  });

  it('does not mark a failed account as imported and retries it on a later run', async () => {
    mockPatched.mockImplementation((id: string) => id !== importJobPatch && id !== durableSyncPatch);
    const tiktok = { id: 'yTdoj', network: 'tiktok', isActive: true };
    mockActivities.fetchSitesWithSocialCommentsActivity.mockResolvedValue([
      { site_id: 'site-1', social_media: [tiktok] },
    ]);
    mockActivities.fetchOutstandAccountsActivity.mockResolvedValue([tiktok]);
    mockActivities.importOutstandPostsActivity.mockRejectedValue(new Error('Provider unavailable'));

    await pollSocialCommentsWorkflow();
    expect(mockActivities.importOutstandPostsActivity).toHaveBeenCalledWith('site-1', 'yTdoj');
    expect(mockActivities.markImportTriggeredActivity).not.toHaveBeenCalled();
  });

  it('imports a newly connected account even if other accounts already have posts', async () => {
    mockPatched.mockImplementation((id: string) => id !== importJobPatch && id !== durableSyncPatch);
    const tiktok = { id: 'yTdoj', network: 'tiktok', isActive: true };
    const instagram = { id: 'Lm3jV', network: 'instagram', isActive: true };
    mockActivities.fetchSitesWithSocialCommentsActivity.mockResolvedValue([
      { site_id: 'site-1', social_media: [tiktok, instagram] },
    ]);
    mockActivities.fetchOutstandPostsActivity.mockResolvedValue([{
      id: 'post-1', publishedAt: new Date(now).toISOString(),
      socialAccounts: [{ ...instagram, status: 'published', platformPostId: 'instagram-post-1' }],
    }]);
    mockActivities.fetchOutstandAccountsActivity.mockResolvedValue([tiktok, instagram]);
    mockActivities.checkIfImportTriggeredActivity.mockImplementation(async (_siteId, accountId) =>
      accountId === 'Lm3jV'
    );

    await pollSocialCommentsWorkflow();
    expect(mockActivities.importOutstandPostsActivity).toHaveBeenCalledTimes(1);
    expect(mockActivities.importOutstandPostsActivity).toHaveBeenCalledWith('site-1', 'yTdoj');
    expect(mockActivities.markImportTriggeredActivity).toHaveBeenCalledWith('site-1', 'yTdoj');
  });

  it('starts a bounded initial import for an owned account with no provider jobs', async () => {
    mockPatched.mockImplementation((id: string) => id !== durableSyncPatch);
    mockActivities.fetchOutstandImportJobsActivity.mockResolvedValue([]);
    await pollSocialCommentsWorkflow();
    expect(mockActivities.fetchOutstandImportJobsActivity).toHaveBeenCalledWith('site-1', account.id);
    expect(mockActivities.startInitialOutstandImportActivity).toHaveBeenCalledWith('site-1', account.id);
    expect(mockActivities.importOutstandPostsActivity).not.toHaveBeenCalled();
    expect(mockActivities.markImportTriggeredActivity).not.toHaveBeenCalled();
  });

  it('does not mark queued or failed import jobs complete or enqueue another', async () => {
    mockPatched.mockImplementation((id: string) => id !== durableSyncPatch);
    for (const job of [
      { id: 'queued', status: 'queued', imported: 0, failed: 0 },
      { id: 'failed', status: 'failed', imported: 0, failed: 1, error: 'Platform unavailable' },
      { id: 'empty', status: 'completed', imported: 0, failed: 0 },
    ]) {
      mockActivities.fetchOutstandImportJobsActivity.mockResolvedValueOnce([job]);
      await pollSocialCommentsWorkflow();
    }
    expect(mockActivities.importOutstandPostsActivity).not.toHaveBeenCalled();
    expect(mockActivities.startInitialOutstandImportActivity).not.toHaveBeenCalled();
    expect(mockActivities.markImportTriggeredActivity).not.toHaveBeenCalled();
  });

  it('recognizes a finished provider job without creating a billable import or premature marker', async () => {
    mockPatched.mockImplementation((id: string) => id !== durableSyncPatch);
    mockActivities.fetchOutstandImportJobsActivity.mockResolvedValue([
      { id: 'job-1', status: 'completed', imported: 6, failed: 0 },
    ]);
    await pollSocialCommentsWorkflow();
    await pollSocialCommentsWorkflow();
    expect(mockActivities.recordInitialOutstandImportActivity).toHaveBeenCalledWith('site-1', account.id,
      { id: 'job-1', status: 'completed', imported: 6, failed: 0 });
    expect(mockActivities.startInitialOutstandImportActivity).not.toHaveBeenCalled();
    expect(mockActivities.markImportTriggeredActivity).not.toHaveBeenCalled();
    expect(mockActivities.importOutstandPostsActivity).not.toHaveBeenCalled();
  });

  it('adopts the oldest existing job as the initial import for an account', async () => {
    mockPatched.mockImplementation((id: string) => id !== durableSyncPatch);
    const initial = { id: 'first-job', status: 'completed', imported: 6, failed: 0 };
    mockActivities.fetchOutstandImportJobsActivity.mockResolvedValue([
      { id: 'later-job', status: 'failed', imported: 0, failed: 1 }, initial,
    ]);
    await pollSocialCommentsWorkflow();
    expect(mockActivities.recordInitialOutstandImportActivity).toHaveBeenCalledWith('site-1', account.id, initial);
    expect(mockActivities.startInitialOutstandImportActivity).not.toHaveBeenCalled();
  });

  it('checks every owned account even when the site already has posts', async () => {
    mockPatched.mockImplementation((id: string) => id !== durableSyncPatch);
    mockActivities.fetchOutstandPostsActivity.mockResolvedValue([{
      id: 'other-post', publishedAt: new Date(now).toISOString(),
      socialAccounts: [{ ...account, status: 'published', platformPostId: 'old-post' }],
      containers: [{ content: 'already known' }],
    }]);
    await pollSocialCommentsWorkflow();
    expect(mockActivities.startInitialOutstandImportActivity).toHaveBeenCalledWith('site-1', account.id);
  });

  it('does not start a new import if two sites own the same account', async () => {
    mockPatched.mockImplementation((id: string) => id !== durableSyncPatch);
    mockActivities.fetchSitesWithSocialCommentsActivity.mockResolvedValue([site, { ...site, site_id: 'site-2' }]);
    await pollSocialCommentsWorkflow();
    expect(mockActivities.startInitialOutstandImportActivity).not.toHaveBeenCalled();
  });

  it('does not queue a billable import when provider job history is unavailable', async () => {
    mockPatched.mockImplementation((id: string) => id !== durableSyncPatch);
    mockActivities.fetchOutstandImportJobsActivity.mockRejectedValue(new Error('Outstand unavailable'));
    await pollSocialCommentsWorkflow();
    expect(mockActivities.startInitialOutstandImportActivity).not.toHaveBeenCalled();
  });

  it('fails closed for provider jobs bound to another account', async () => {
    mockPatched.mockImplementation((id: string) => id !== durableSyncPatch);
    mockActivities.fetchOutstandImportJobsActivity.mockResolvedValue([
      { id: 'job-foreign', socialAccountId: 'another-account', status: 'completed', imported: 6 },
    ]);
    await pollSocialCommentsWorkflow();
    expect(mockActivities.recordInitialOutstandImportActivity).not.toHaveBeenCalled();
    expect(mockActivities.startInitialOutstandImportActivity).not.toHaveBeenCalled();
  });

  it('persists imported posts older than thirty days but never fetches their comments', async () => {
    mockPatched.mockImplementation((id: string) => id !== durableSyncPatch);
    mockActivities.fetchOutstandPostsActivity.mockResolvedValue([{
      id: 'historical-post',
      publishedAt: new Date(now - 100 * 24 * 60 * 60 * 1000).toISOString(),
      socialAccounts: [{ ...account, status: 'published', platformPostId: 'old-id' }],
      containers: [{ content: 'Old published post' }],
    }]);
    await expect(pollSocialCommentsWorkflow()).resolves.toEqual({
      success: true, processedPosts: 1, processedComments: 0,
    });
    expect(mockActivities.upsertContentFromOutstandPostActivity).toHaveBeenCalledTimes(1);
    expect(mockActivities.fetchOutstandPostRepliesActivity).not.toHaveBeenCalled();
  });

  it('does not count an Outstand post as processed when content persistence fails', async () => {
    mockPatched.mockImplementation((id: string) => id !== durableSyncPatch);
    mockActivities.fetchOutstandPostsActivity.mockResolvedValue([{
      id: 'post-1', publishedAt: new Date(now).toISOString(),
      socialAccounts: [{ ...account, status: 'published', platformPostId: 'post-1' }],
      containers: [{ content: 'Published post' }],
    }]);
    mockActivities.upsertContentFromOutstandPostActivity.mockResolvedValue(null);
    await expect(pollSocialCommentsWorkflow()).resolves.toEqual({
      success: true, processedPosts: 0, processedComments: 0,
    });
    expect(mockActivities.fetchOutstandPostRepliesActivity).not.toHaveBeenCalled();
  });

  it('continues past the first 100 posts when the API wrapper drops pagination', async () => {
    mockPatched.mockImplementation((id: string) => id !== durableSyncPatch);
    const old = new Date(now - 100 * 24 * 60 * 60 * 1000).toISOString();
    const post = (id: string) => ({
      id, publishedAt: old,
      socialAccounts: [{ ...account, status: 'published', platformPostId: id }],
      containers: [{ content: id }],
    });
    mockActivities.fetchOutstandPostsActivity
      .mockResolvedValueOnce(Array.from({ length: 100 }, (_, index) => post(`post-${index}`)))
      .mockResolvedValueOnce([post('post-100')]);
    await expect(pollSocialCommentsWorkflow()).resolves.toEqual({
      success: true, processedPosts: 101, processedComments: 0,
    });
    expect(mockActivities.fetchOutstandPostsActivity.mock.calls).toEqual([
      ['site-1', 100, 0], ['site-1', 100, 100],
    ]);
  });
});