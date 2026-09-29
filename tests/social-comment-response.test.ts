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