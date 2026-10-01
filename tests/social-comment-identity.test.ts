import { durableLinkedInComment, resolveSocialCommentIdentity } from '../src/temporal/workflows/helpers/socialCommentIdentity';
import { socialCommentCandidates } from '../src/temporal/workflows/helpers/socialCommentPayload';

describe('Outstand comment author identity', () => {
  it.each(['instagram', 'threads', 'x', 'bluesky'])('uses readable author strings on %s without pretending they are stable IDs', network => {
    expect(resolveSocialCommentIdentity({ author: 'johndoe' }, network)).toEqual({
      authorName: 'johndoe', handle: 'johndoe', authorId: '', profileUrl: '',
    });
  });

  it('treats Facebook textual authors as display names, not handles', () => {
    expect(resolveSocialCommentIdentity({ author: 'John Doe' }, 'facebook')).toMatchObject({
      authorName: 'John Doe', handle: '', authorId: '',
    });
  });

  it('recovers Facebook name and stable ID from the original provider comment', () => {
    expect(resolveSocialCommentIdentity({
      author: 'John Doe', accountUsername: 'brand',
      platform_specific: { from: { id: '12345', name: 'John Doe' } },
    }, 'facebook')).toEqual({ authorName: 'John Doe', handle: '', authorId: '12345', profileUrl: '' });
  });

  it('selects nonblank fields and ignores placeholders or malformed author containers', () => {
    expect(resolveSocialCommentIdentity({
      author_name: 'Social User', author_username: '  ', author: [],
      from: { name: ' Alice ', username: ' @alice ', id: 123 },
      author_profile_url: 'javascript:alert(1)',
    }, 'instagram')).toEqual({ authorName: 'Alice', handle: 'alice', authorId: '123', profileUrl: '' });
  });

  it.each(['urn:li:person:123', '12345', 'https://example.com/profile', 'Social User', '   '])('does not turn IDs, URLs, or placeholders into handles: %s', author => {
    expect(resolveSocialCommentIdentity({ author }, 'instagram')).toMatchObject({ authorName: '', handle: '' });
  });

  it('never borrows the publishing account identity', () => {
    expect(resolveSocialCommentIdentity({ accountUsername: 'brand', account: { username: 'brand' } }, 'instagram'))
      .toEqual({ authorName: '', handle: '', authorId: '', profileUrl: '' });
  });

  it('retains numeric usernames only when the provider explicitly identifies them as usernames', () => {
    expect(resolveSocialCommentIdentity({ author_username: '12345', author: '67890' }, 'instagram'))
      .toMatchObject({ handle: '12345', authorId: '67890' });
    expect(resolveSocialCommentIdentity({ author: '12345' }, 'instagram')).toMatchObject({ handle: '' });
  });

  it('retains canonical fields ahead of raw Facebook metadata', () => {
    expect(resolveSocialCommentIdentity({ author_name: 'New Name', author_username: 'newhandle',
      author_id: 'stable', from: { name: 'Old Name', username: 'oldhandle', id: 'old' },
    }, 'facebook')).toMatchObject({ authorName: 'New Name', handle: 'newhandle', authorId: 'stable' });
  });

  it('does not expose resolved LinkedIn profiles to a durable workflow payload', () => {
    const comment = { author: 'urn:li:person:123', author_name: 'Resolved Person',
      author_username: 'resolved-person', author_profile_url: 'https://www.linkedin.com/in/resolved-person' };
    expect(resolveSocialCommentIdentity(comment, 'linkedin')).toEqual({
      authorName: '', handle: '', authorId: 'urn:li:person:123', profileUrl: '',
    });
  });

  it('keeps both earlier mappings unchanged unless the identity patch is enabled', () => {
    const comments = [{ id: 'comment', text: 'Example', author: 'johndoe' }];
    expect([...socialCommentCandidates(comments, 'instagram').values()][0]).toMatchObject({ handle: 'johndoe', authorId: 'johndoe' });
    expect([...socialCommentCandidates(comments, 'instagram', true).values()][0]).toMatchObject({ authorName: 'Social User', handle: '', authorId: 'johndoe' });
    expect([...socialCommentCandidates(comments, 'instagram', true, true).values()][0]).toMatchObject({ authorName: 'johndoe', handle: 'johndoe', authorId: '' });
  });
});

describe('LinkedIn activity history boundary', () => {
  it('preserves network evidence so sanitizing cannot hide a mismatched account', () => {
    const comment = durableLinkedInComment({ id: 'comment', text: 'Example',
      account: { network: 'instagram', username: 'private-profile' } });
    expect(comment.network).toBe('instagram');
    expect(comment).not.toHaveProperty('account');
    expect(() => socialCommentCandidates([comment], 'linkedin', true, true)).toThrow('network does not match');
  });

  it('keeps comment identifiers and text while removing all resolved profile copies, including nested replies', () => {
    const input = {
      id: 'normalized-comment', text: 'Comment text', author: 'urn:li:person:123',
      author_name: 'Resolved Person', author_username: 'resolved-person',
      author_avatar_url: 'https://example.com/avatar', author_profile_url: 'https://example.com/profile',
      from: { id: 'urn:li:person:123', name: 'Resolved Person' },
      platform_specific: { id: 'platform-comment', commentUrn: 'urn:li:comment:1', actor: 'urn:li:person:123', profile: { name: 'Resolved Person' } },
      replies: [{ id: 'reply', text: 'Reply text', author: 'urn:li:person:456', author_name: 'Another Person' }],
    };
    const result = durableLinkedInComment(input);
    expect(result).toEqual({
      id: 'normalized-comment', text: 'Comment text', author_id: 'urn:li:person:123',
      platform_specific: { id: 'platform-comment', commentUrn: 'urn:li:comment:1' },
      replies: [{ id: 'reply', text: 'Reply text', author_id: 'urn:li:person:456', platform_specific: {} }],
    });
    expect(input.author_name).toBe('Resolved Person');
    expect(JSON.stringify(result)).not.toMatch(/Resolved Person|Another Person|resolved-person|example\.com/);
  });
});