import { mergeOutstandMetadata } from '../src/temporal/activities/outstandContentIdentity';
import { getOwnedPublishedSocialPostAccounts } from '../src/temporal/workflows/helpers/outstandPoll';

describe('Outstand owned publishing account metadata', () => {
  it('projects only safe fields from the owned published accounts', () => {
    const account = Object.freeze({
      id: 'account-1', network: 'Instagram', status: 'published',
      username: ' brand ', nickname: 'Brand account',
      platformPostId: 'media-1', platformPostUrl: 'https://example.test/posts/media-1',
      accessToken: 'secret', refresh_token: 'secret', raw: { private: true },
    });
    const owned = getOwnedPublishedSocialPostAccounts({ socialAccounts: [
      account,
      { ...account, id: 'foreign', username: 'someone-else' },
    ] }, [{ id: 'account-1', network: 'instagram', isActive: true }]);

    expect(mergeOutstandMetadata(null, 'hash', 'post-1', owned)).toEqual({
      source: 'outstand', source_content_hash: 'hash', outstand_post_ids: ['post-1'],
      outstand_social_accounts: [{
        outstand_post_id: 'post-1', account_id: 'account-1', network: 'instagram',
        username: 'brand', nickname: 'Brand account',
        platform_post_id: 'media-1', platform_post_url: 'https://example.test/posts/media-1',
      }],
    });
    expect(account.username).toBe(' brand ');
  });

  const idFields = [
    'id', 'accountId', 'account_id', 'socialAccountId', 'social_account_id',
    'customer_social_network_id', 'network_unique_id',
  ];
  it.each(idFields.flatMap(field => ['direct', 'socialAccount', 'social_account'].map(wrapper => [field, wrapper])))
    ('supports the ownership helper ID alias %s in %s', (field, wrapper) => {
      const details = {
        [field]: 42, username: 'handle', nickname: 'Display name',
        platform_post_id: 123, platform_post_url: 'https://example.test/posts/123',
        access_token: 'secret', raw: { private: true },
      };
      const account = {
        network: 'Twitter', status: 'published',
        ...(wrapper === 'direct' ? details : { [wrapper]: details }),
      };
      const owned = getOwnedPublishedSocialPostAccounts({ socialAccounts: [account] }, [
        { id: '42', network: 'x', isActive: true },
      ]);
      expect(owned).toHaveLength(1);
      expect(mergeOutstandMetadata(null, 'hash', 'post-1', owned).outstand_social_accounts).toEqual([{
        outstand_post_id: 'post-1', account_id: '42', network: 'x',
        username: 'handle', nickname: 'Display name',
        platform_post_id: '123', platform_post_url: 'https://example.test/posts/123',
      }]);
    });

  it('merges by the full post/account/network key without losing other metadata or mutating inputs', () => {
    const previous = Object.freeze({
      outstand_post_id: 'post-1', account_id: 'account-1', network: 'instagram',
      nickname: 'Original name',
    });
    const existing = Object.freeze({
      source: 'editor', source_content_hash: 'hash', outstand_post_ids: Object.freeze(['post-1']),
      editorial: { approved: true },
      outstand_social_accounts: Object.freeze([previous, { ...previous, username: 'original' }]),
    });
    const first = mergeOutstandMetadata(existing, 'hash', 'post-1', [
      { id: 'account-1', network: 'instagram', username: 'updated', nickname: '' },
      { id: 'account-2', network: 'instagram', username: 'second' },
      { id: 'account-1', network: 'tiktok', platformPostId: 'video-1' },
    ]);
    const incoming = [
      { id: 'account-1', network: 'instagram', username: 'another-post' },
      { id: 'account-1', network: 'instagram', platformPostUrl: 'https://example.test/new' },
    ];
    const merged = mergeOutstandMetadata(first, 'hash', 'post-2', incoming);
    expect(merged).toEqual({
      source: 'editor', source_content_hash: 'hash', outstand_post_ids: ['post-1', 'post-2'],
      editorial: { approved: true },
      outstand_social_accounts: [
        { ...previous, username: 'updated' },
        { outstand_post_id: 'post-1', account_id: 'account-2', network: 'instagram', username: 'second' },
        { outstand_post_id: 'post-1', account_id: 'account-1', network: 'tiktok', platform_post_id: 'video-1' },
        { outstand_post_id: 'post-2', account_id: 'account-1', network: 'instagram',
          username: 'another-post', platform_post_url: 'https://example.test/new' },
      ],
    });
    expect(JSON.stringify(mergeOutstandMetadata(merged, 'hash', 'post-2', incoming)))
      .toBe(JSON.stringify(merged));
    expect(existing.outstand_social_accounts).toHaveLength(2);
    expect(previous).not.toHaveProperty('username');
  });

  it.each([undefined, null, '', '  ', {}, [], false, NaN, Infinity])
    ('does not overwrite valid account details with empty or non-scalar input (%p)', value => {
      const rich = mergeOutstandMetadata(null, 'hash', 'post-1', [{
        id: 'account-1', network: 'instagram', username: 'brand', nickname: 'Brand',
        platformPostId: 'media-1', platformPostUrl: 'https://example.test/media-1',
      }]);
      const sparse = mergeOutstandMetadata(rich, 'hash', 'post-1', [{
        id: 'account-1', network: 'instagram', username: value, nickname: value,
        platformPostId: value, platformPostUrl: value,
      }]);
      expect(JSON.stringify(sparse)).toBe(JSON.stringify(rich));
    });

  it('is byte-stable on a repeat after filling a previously missing optional field', () => {
    const first = mergeOutstandMetadata(null, 'hash', 'post-1', [{
      id: 'account-1', network: 'twitter', nickname: 'Brand', platformPostId: 'media-1',
    }]);
    const incoming = [{ id: 'account-1', network: 'x', username: 'brand' }];
    const enriched = mergeOutstandMetadata(first, 'hash', 'post-1', incoming);
    expect(enriched.outstand_social_accounts).toEqual([{
      outstand_post_id: 'post-1', account_id: 'account-1', network: 'x',
      username: 'brand', nickname: 'Brand', platform_post_id: 'media-1',
    }]);
    expect(JSON.stringify(mergeOutstandMetadata(enriched, 'hash', 'post-1', incoming)))
      .toBe(JSON.stringify(enriched));
  });

  it('omits unavailable fields and unusable identities instead of storing raw objects or invented IDs', () => {
    const merged = mergeOutstandMetadata({
      custom: true, outstand_social_accounts: [null, 'invalid', {
        outstand_post_id: 'older', account_id: 'older-account', network: 'instagram',
        username: 'older', access_token: 'secret', raw: { private: true },
      }],
    }, 'hash', 'post-1', [
      null, {}, { network: 'instagram' }, { id: 'missing-network' },
      { id: {}, network: 'instagram' },
      { id: 'account-1', network: 'instagram', username: { token: 'secret' }, nickname: ' ' },
    ]);
    expect(merged.outstand_social_accounts).toEqual([
      { outstand_post_id: 'older', account_id: 'older-account', network: 'instagram', username: 'older' },
      { outstand_post_id: 'post-1', account_id: 'account-1', network: 'instagram' },
    ]);
    expect(merged.custom).toBe(true);
    expect(mergeOutstandMetadata({ outstand_social_accounts: {} }, 'hash', 'post-1')
      .outstand_social_accounts).toEqual([]);
  });
});