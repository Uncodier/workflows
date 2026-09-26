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

const ownershipPatch = 'poll-social-comments-strict-site-ownership-v1';
const account = { id: 'account-1', network: 'linkedin', isActive: true };
const site = { site_id: 'site-1', social_media: [account] };
const now = Date.UTC(2026, 8, 26, 12);

function useOwnershipPatch(enabled: boolean) {
  mockPatched.mockImplementation((id: string) => id === ownershipPatch ? enabled : true);
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
});