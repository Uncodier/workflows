const mockGet = jest.fn();
jest.mock('../src/temporal/services/apiService', () => ({ apiService: { get: mockGet } }));
jest.mock('../src/lib/supabase/client', () => ({ supabaseServiceRole: {} }));

import { fetchOutstandPostRepliesActivity } from '../src/temporal/activities/outstandActivities';
import { socialCommentCandidates } from '../src/temporal/workflows/helpers/socialCommentPayload';

const comment = { id: 'comment-1', text: 'A comment', author: 'author-1',
  author_name: 'A Person', author_username: 'a_person', author_profile_url: 'https://www.instagram.com/a_person/' };

describe('social comment API boundary', () => {
  beforeEach(() => jest.resetAllMocks());

  it.each([
    { success: true, data: [comment] },
    { success: true, data: { success: true, data: [comment], replies: { comments: [] } } },
    { success: true, data: { comments: [comment] } },
    { success: true, data: { replies: [comment] } },
    { success: true, data: { replies: { comments: [comment] } } },
  ])('recognizes a supported response shape without losing comments', async response => {
    mockGet.mockResolvedValue(response);
    await expect(fetchOutstandPostRepliesActivity('site-1', 'post-1', 'instagram')).resolves.toEqual([comment]);
    expect(mockGet).toHaveBeenCalledWith('/api/integrations/outstand/posts/post-1/comments?tenant_id=site-1&network=instagram');
  });

  it.each([
    { success: true, data: [], degraded: true },
    { success: true, data: { success: true, degraded: true, data: [] } },
    { success: true, data: { success: false, data: [] } },
    { success: false, error: { message: '503 Service Unavailable' } },
    { success: true, data: {} },
    { success: true, data: { data: null, comments: [] } },
  ])('does not acknowledge failed or malformed responses as empty', async response => {
    mockGet.mockResolvedValue(response);
    await expect(fetchOutstandPostRepliesActivity('site-1', 'post-1', 'instagram')).rejects.toThrow();
  });

  it('accepts an explicit successful empty list', async () => {
    mockGet.mockResolvedValue({ success: true, data: [] });
    await expect(fetchOutstandPostRepliesActivity('site-1', 'post-1', 'instagram')).resolves.toEqual([]);
  });

  it('sends the exact owned account selector to the authorized API guard', async () => {
    mockGet.mockResolvedValue({ success: true, data: [] });
    await fetchOutstandPostRepliesActivity('site', 'post', 'twitter', { accountId: 'owned-account', durableIdentity: true });
    expect(mockGet).toHaveBeenCalledWith('/api/integrations/outstand/posts/post/comments?tenant_id=site&network=x&account_id=owned-account');
  });

  it('requests the owned publishing account and strips LinkedIn profiles before returning to Temporal', async () => {
    mockGet.mockResolvedValue({ success: true, data: [{
      id: 'comment-1', text: 'A comment', author: 'urn:li:person:123',
      author_name: 'Resolved Person', author_username: 'resolved-person',
      platform_specific: { commentUrn: 'urn:li:comment:1', profile: { name: 'Resolved Person' } },
    }] });
    const result = await fetchOutstandPostRepliesActivity('site-1', 'post-1', 'linkedin', {
      username: 'brand', durableIdentity: true,
    });
    expect(mockGet).toHaveBeenCalledWith('/api/integrations/outstand/posts/post-1/comments?tenant_id=site-1&network=linkedin&username=brand&resolve_author_names=false');
    expect(result).toEqual([{ id: 'comment-1', text: 'A comment', author_id: 'urn:li:person:123', platform_specific: { commentUrn: 'urn:li:comment:1' } }]);
    expect(JSON.stringify(result)).not.toContain('Resolved Person');
  });

  it('preserves Instagram author fields and never opts in to LinkedIn resolution during ingestion', async () => {
    mockGet.mockResolvedValue({ success: true, data: [comment] });
    await expect(fetchOutstandPostRepliesActivity('site-1', 'post-1', 'instagram', {
      username: 'brand', durableIdentity: true,
    })).resolves.toEqual([comment]);
    expect(mockGet).toHaveBeenCalledWith('/api/integrations/outstand/posts/post-1/comments?tenant_id=site-1&network=instagram&username=brand');
  });

  it('protects pending legacy LinkedIn activities even without new options', async () => {
    mockGet.mockResolvedValue({ success: true, data: [{ id: 'c', text: 'Example',
      author: 'urn:li:person:123', author_name: 'Private Name', author_username: 'private-name' }] });
    await expect(fetchOutstandPostRepliesActivity('site', 'post', 'linkedin')).resolves.toEqual([
      { id: 'c', text: 'Example', author_id: 'urn:li:person:123', platform_specific: {} },
    ]);
    expect(mockGet).toHaveBeenCalledWith('/api/integrations/outstand/posts/post/comments?tenant_id=site&network=linkedin&resolve_author_names=false');
  });

  it.each([[400, true], [403, true], [408, false], [429, false], [502, false]])('sanitizes LinkedIn error bodies without losing HTTP %s retryability', async (status, nonRetryable) => {
    mockGet.mockResolvedValue({ success: false, error: { status, message: 'Upstream included Private Name' } });
    const error = await fetchOutstandPostRepliesActivity('site', 'post', 'linkedin').catch(value => value);
    expect(error).toMatchObject({ message: `LinkedIn comments request failed (HTTP ${status})`, nonRetryable });
    expect(error.cause).toBeUndefined();
    expect(error.stack).not.toContain('Private Name');
  });

  it('does not leak transport errors into LinkedIn activity history', async () => {
    mockGet.mockRejectedValue(new Error('Private Name'));
    await expect(fetchOutstandPostRepliesActivity('site', 'post', 'linkedin')).rejects.toMatchObject({
      message: 'LinkedIn comments request failed', cause: undefined,
    });
  });
});

describe('social comment identity mapping', () => {
  it('uses normalized author identity instead of the publishing account', () => {
    const candidate = [...socialCommentCandidates([{ ...comment, accountUsername: 'brand' }], 'instagram', true).values()][0];
    expect(candidate).toMatchObject({ authorName: 'A Person', handle: 'a_person', authorId: 'author-1', profileUrl: comment.author_profile_url });
  });

  it('keeps the old mapping for historical workflow replay', () => {
    expect([...socialCommentCandidates([comment], 'instagram').values()][0]).toMatchObject({ handle: 'author-1', profileUrl: '' });
  });

  it('deduplicates repeated provider comments', () => {
    expect(socialCommentCandidates([comment, comment], 'instagram', true).size).toBe(1);
  });

  it.each([{ id: 'missing-text' }, { text: 'missing id' }, { ...comment, network: 'facebook' }])('rejects invalid comments rather than advancing the checkpoint', value => {
    expect(() => socialCommentCandidates([value], 'instagram', true)).toThrow();
  });
});