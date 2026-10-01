// Same queued, chainable Supabase boundary pattern as finder-persistence-activities.test.ts.
const mockReplies: any[] = [];
const mockQueries: any[] = [];
const mockFrom = jest.fn((table: string) => {
  const query: any = { table, filters: [], write: undefined };
  const finish = () => {
    if (!mockReplies.length) throw new Error(`Unexpected query ${table}`);
    return Promise.resolve(mockReplies.shift());
  };
  for (const method of ['select', 'eq', 'contains', 'not', 'order', 'limit']) {
    query[method] = (...args: any[]) => { query.filters.push([method, ...args]); return query; };
  }
  for (const method of ['insert', 'update']) {
    query[method] = (payload: any) => { query.write = { method, payload }; return query; };
  }
  query.single = finish;
  query.maybeSingle = finish;
  query.then = (resolve: any, reject: any) => finish().then(resolve, reject);
  mockQueries.push(query);
  return query;
});
const mockSchema = jest.fn(() => ({ from: mockFrom }));
const mockClaim = jest.fn();
const mockFinishClaim = jest.fn();

jest.mock('../src/lib/supabase/client', () => ({ supabaseServiceRole: { schema: mockSchema } }));
jest.mock('../src/temporal/activities/syncedObjectActivities', () => ({
  claimSyncedObjectActivity: mockClaim,
  finishSyncedObjectClaimActivity: mockFinishClaim,
}));

import { upsertContentFromOutstandPostActivity } from '../src/temporal/activities/outstandContentActivities';
import { buildOutstandContentHash } from '../src/temporal/activities/outstandContentIdentity';

const row = (data: any) => ({ data, error: null });
const siteId = 'site-1';
const text = 'Shared logical post';
const hash = buildOutstandContentHash(text);
const owned = {
  id: 'account-1', network: 'instagram', status: 'published',
  username: 'brand', nickname: 'Brand account',
  platformPostId: 'media-1', platformPostUrl: 'https://example.test/posts/media-1',
  accessToken: 'secret', refresh_token: 'secret', raw: { private: true },
};
const settings = [{ id: owned.id, network: owned.network, isActive: true }];
const foreign = { ...owned, id: 'foreign', username: 'someone-else', platformPostId: 'foreign-media' };
const post = { id: 'post-1', text, socialAccounts: [owned, foreign] };
const safeAccount = {
  outstand_post_id: post.id, account_id: owned.id, network: owned.network,
  username: owned.username, nickname: owned.nickname,
  platform_post_id: owned.platformPostId, platform_post_url: owned.platformPostUrl,
};

describe('Outstand content publishing accounts with mocked persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReplies.length = 0;
    mockQueries.length = 0;
    mockClaim.mockResolvedValue({ claimed: true, claimToken: 'claim-1' });
    mockFinishClaim.mockResolvedValue(undefined);
  });

  afterEach(() => {
    expect(mockReplies).toHaveLength(0);
    jest.restoreAllMocks();
  });

  it('inserts only owned published accounts, without tokens, raw objects or unrelated connected accounts', async () => {
    const second = { ...owned, id: 'account-2', username: 'second-brand', platformPostId: 'media-2' };
    const socialMedia = [
      ...settings, { id: second.id, network: second.network, isActive: true },
      { id: 'pending', network: 'instagram', isActive: true },
      { id: 'inactive', network: 'instagram', isActive: false },
      { id: 'not-on-post', network: 'instagram', isActive: true },
    ];
    mockReplies.push(row(null), row(null), row([]), row({ id: 'content-1' }));
    await expect(upsertContentFromOutstandPostActivity(siteId, {
      ...post, socialAccounts: [
        ...post.socialAccounts, second, second,
        { id: 'pending', network: 'instagram', status: 'pending' },
        { ...owned, id: 'inactive' },
        { ...owned, network: 'linkedin' },
      ],
    }, socialMedia)).resolves.toBe('content-1');

    const writes = mockQueries.filter(query => query.write);
    expect(writes).toHaveLength(1);
    expect(writes[0].write.method).toBe('insert');
    expect(writes[0].write.payload[0]).toMatchObject({ site_id: siteId, text, status: 'published' });
    expect(writes[0].write.payload[0].metadata).toEqual({
      source: 'outstand', source_content_hash: hash, outstand_post_ids: ['post-1'],
      outstand_social_accounts: [safeAccount, {
        ...safeAccount, account_id: second.id, username: second.username, platform_post_id: second.platformPostId,
      }],
    });
    expect(writes[0].write.payload[0].tags).not.toContain('platform_post_id_foreign-media');
    expect(mockQueries.every(query => query.table === 'content')).toBe(true);
    expect(mockClaim).toHaveBeenCalledWith(expect.objectContaining({
      siteId, externalId: `outstand:content:${hash}`, provider: 'outstand',
    }));
    expect(mockFinishClaim).toHaveBeenCalledWith(expect.objectContaining({
      siteId, externalId: `outstand:content:${hash}`, claimToken: 'claim-1', status: 'completed',
    }));
  });

  it.each(['post ID', 'content hash', 'legacy text'])
    ('backfills an existing match by %s, preserves other accounts/metadata and skips repeated writes', async match => {
      const previousAccount = {
        outstand_post_id: 'other-post', account_id: 'other-account', network: 'tiktok', username: 'original',
      };
      const existing = {
        id: 'content-1', text,
        tags: ['editorial', 'outstand_only', 'outstand_id_other-post'],
        metadata: {
          source: 'editor', editorial: { keep: true }, outstand_post_ids: ['other-post'],
          outstand_social_accounts: [previousAccount],
        },
      };
      if (match !== 'post ID') mockReplies.push(row(null));
      if (match === 'legacy text') mockReplies.push(row(null));
      mockReplies.push(row(match === 'legacy text' ? [existing] : existing), row(null));

      await expect(upsertContentFromOutstandPostActivity(siteId, post, settings)).resolves.toBe(existing.id);
      const writes = mockQueries.filter(query => query.write);
      expect(writes).toHaveLength(1);
      expect(writes[0].write.method).toBe('update');
      const update = writes[0].write.payload;
      expect(Object.keys(update).sort()).toEqual(['metadata', 'tags']);
      expect(update.metadata).toEqual({
        ...existing.metadata, source_content_hash: hash, outstand_post_ids: ['other-post', 'post-1'],
        outstand_social_accounts: [previousAccount, safeAccount],
      });
      expect(update.tags).toEqual(expect.arrayContaining([...existing.tags, 'outstand_id_post-1', 'published_instagram']));
      expect(writes[0].filters).toContainEqual(['eq', 'id', existing.id]);
      expect(mockQueries.every(query => query.filters.some((filter: any[]) =>
        filter[0] === 'eq' && filter[1] === 'site_id' && filter[2] === siteId))).toBe(true);
      if (match === 'content hash') {
        expect(mockQueries[1].filters).toContainEqual(['eq', 'metadata->>source_content_hash', hash]);
      }

      // Both identical and sparse subsequent imports must leave rich stored data untouched.
      for (const repeated of [post, {
        ...post, socialAccounts: [{ ...owned, username: '', nickname: null, platformPostId: undefined, platformPostUrl: ' ' }],
      }]) {
        mockReplies.push(row({ ...existing, ...update }));
        await expect(upsertContentFromOutstandPostActivity(siteId, repeated, settings)).resolves.toBe(existing.id);
      }
      expect(mockQueries.filter(query => query.write)).toHaveLength(1);
      expect(mockClaim).not.toHaveBeenCalled();
      expect(mockFinishClaim).not.toHaveBeenCalled();
      expect(existing.metadata.outstand_social_accounts).toEqual([previousAccount]);
    });

  it('does not rewrite unchanged metadata when stored JSON object keys have a different order', async () => {
    const metadata = {
      outstand_social_accounts: [Object.fromEntries(Object.entries(safeAccount).reverse())],
      outstand_post_ids: ['post-1'], source_content_hash: hash, source: 'outstand',
    };
    mockReplies.push(row({
      id: 'content-1', metadata,
      tags: ['outstand_only', 'outstand_id_post-1', 'published_instagram',
        'platform_post_id_media-1', 'platform_post_id_instagram_media-1'],
    }));
    await expect(upsertContentFromOutstandPostActivity(siteId, post, settings)).resolves.toBe('content-1');
    expect(mockQueries.some(query => query.write)).toBe(false);
    expect(mockClaim).not.toHaveBeenCalled();
  });

  it('enriches an existing account even when tags and post IDs have not changed', async () => {
    const existing = {
      id: 'content-1',
      tags: ['outstand_only', 'outstand_id_post-1', 'published_instagram',
        'platform_post_id_media-1', 'platform_post_id_instagram_media-1'],
      metadata: {
        source: 'outstand', source_content_hash: hash, outstand_post_ids: ['post-1'],
        outstand_social_accounts: [{ ...safeAccount, platform_post_url: undefined }],
      },
    };
    mockReplies.push(row(existing), row(null));
    await expect(upsertContentFromOutstandPostActivity(siteId, post, settings)).resolves.toBe('content-1');
    const writes = mockQueries.filter(query => query.write);
    expect(writes).toHaveLength(1);
    expect(writes[0].write.payload).toEqual({
      tags: existing.tags,
      metadata: { ...existing.metadata, outstand_social_accounts: [safeAccount] },
    });
    mockReplies.push(row({ ...existing, ...writes[0].write.payload }));
    await expect(upsertContentFromOutstandPostActivity(siteId, post, settings)).resolves.toBe('content-1');
    expect(mockQueries.filter(query => query.write)).toHaveLength(1);
    expect(mockClaim).not.toHaveBeenCalled();
  });

  it.each([
    ['foreign account', [foreign], settings],
    ['wrong network', [{ ...owned, network: 'linkedin' }], settings],
    ['unpublished account', [{ id: owned.id, network: owned.network, status: 'pending' }], settings],
    ['inactive connection', [owned], [{ ...settings[0], isActive: false }]],
    ['missing settings', [owned], null],
  ])('skips %s before persistence or claiming', async (_name, socialAccounts, socialMedia) => {
    await expect(upsertContentFromOutstandPostActivity(siteId, { ...post, socialAccounts }, socialMedia))
      .resolves.toBeNull();
    expect(mockSchema).not.toHaveBeenCalled();
    expect(mockClaim).not.toHaveBeenCalled();
    expect(mockFinishClaim).not.toHaveBeenCalled();
  });

  it('retains the claim guard for new content', async () => {
    mockReplies.push(row(null), row(null), row([]));
    mockClaim.mockResolvedValueOnce({ claimed: false });
    await expect(upsertContentFromOutstandPostActivity(siteId, post, settings)).resolves.toBeNull();
    expect(mockQueries.some(query => query.write)).toBe(false);
    expect(mockFinishClaim).not.toHaveBeenCalled();
  });

  it('does not insert or claim a duplicate when an existing metadata update fails', async () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockReplies.push(row({ id: 'content-1', tags: [], metadata: null }), {
      data: null, error: { message: 'mock update denied' },
    });
    await expect(upsertContentFromOutstandPostActivity(siteId, post, settings)).resolves.toBeNull();
    expect(mockQueries.filter(query => query.write).map(query => query.write.method)).toEqual(['update']);
    expect(mockClaim).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      message: 'Failed to merge Outstand content: mock update denied',
    }));
  });
});