import {
  buildOutstandContentExternalId,
  buildOutstandContentHash,
  buildOwnedOutstandTags,
  mergeOutstandMetadata,
  mergeOutstandTags,
  normalizeOutstandContent,
  outstandPostText,
} from '../src/temporal/activities/outstandContentIdentity';

describe('Outstand content identity', () => {
  it('retains captionless media as distinct posts rather than dropping or merging them', () => {
    expect(outstandPostText({ id: 'post-1', containers: [{ content: '' }] })).toBe('Social media post post-1');
    expect(outstandPostText({ id: 'post-2', containers: [{ content: '  ' }] })).toBe('Social media post post-2');
    expect(outstandPostText({ id: 'post-1', text: '  Real caption ' })).toBe('Real caption');
    expect(buildOutstandContentHash(outstandPostText({ id: 'post-1' })))
      .not.toBe(buildOutstandContentHash(outstandPostText({ id: 'post-2' })));
  });
  it('normalizes equivalent text before hashing', () => {
    const unix = 'Same post\nAcross networks';
    const windows = '  Same post\r\nAcross networks  ';

    expect(normalizeOutstandContent(windows)).toBe(unix);
    expect(buildOutstandContentHash(windows)).toBe(
      buildOutstandContentHash(unix)
    );
  });

  it('uses the content hash instead of the provider post ID', () => {
    const hash = buildOutstandContentHash('Shared logical post');

    expect(buildOutstandContentExternalId(hash)).toBe(
      `outstand:content:${hash}`
    );
  });

  it('merges network tags and external IDs idempotently', () => {
    const linkedinTags = buildOwnedOutstandTags('linkedin-id', [{
      network: 'linkedin',
      platformPostId: 'urn:li:share:1',
    }]);
    const facebookTags = buildOwnedOutstandTags('facebook-id', [{
      network: 'facebook',
      platformPostId: 'page_post',
    }]);

    const tags = mergeOutstandTags(
      mergeOutstandTags([], linkedinTags),
      facebookTags
    );
    expect(tags).toEqual(expect.arrayContaining([
      'outstand_id_linkedin-id',
      'outstand_id_facebook-id',
      'published_linkedin',
      'published_facebook',
    ]));
    expect(new Set(tags).size).toBe(tags.length);

    const first = mergeOutstandMetadata(null, 'hash', 'linkedin-id');
    const second = mergeOutstandMetadata(first, 'hash', 'facebook-id');
    const repeated = mergeOutstandMetadata(second, 'hash', 'facebook-id');

    expect(repeated).toMatchObject({
      source: 'outstand',
      source_content_hash: 'hash',
      outstand_post_ids: ['linkedin-id', 'facebook-id'],
    });
  });
});
