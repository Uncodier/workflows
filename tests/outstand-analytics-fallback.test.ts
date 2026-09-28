const mockRpc = jest.fn();
const mockContentLimit = jest.fn();
const mockSnapshotIn = jest.fn();
const mockFrom = jest.fn((table: string) => {
  if (table === 'content') {
    return { select: () => ({
      in: () => ({ or: () => ({ not: () => ({ order: () => ({ limit: mockContentLimit }) }) }) }),
    }) };
  }
  return { select: () => ({ in: () => ({ in: mockSnapshotIn }) }) };
});

jest.mock('../src/temporal/services/apiService', () => ({ apiService: { get: jest.fn(), post: jest.fn() } }));
jest.mock('../src/lib/supabase/client', () => ({
  supabaseServiceRole: {
    schema: () => ({ rpc: mockRpc, from: mockFrom }),
  },
}));

import { fetchAllSocialPostsDueForAnalyticsActivity } from '../src/temporal/activities/outstandActivities';

const siteId = '00000000-0000-4000-8000-000000000001';

describe('social analytics when the RPC has not been deployed', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'function not found' } });
    mockContentLimit.mockResolvedValue({ data: [
      { id: 'content-1', site_id: siteId, status: 'published', published_at: new Date().toISOString(), tags: ['outstand_id_post-1', 'published_tiktok'] },
      { id: 'content-2', site_id: siteId, status: 'published', published_at: new Date().toISOString(), tags: ['outstand_id_post-2', 'published_instagram'] },
    ], error: null });
    mockSnapshotIn.mockResolvedValue({ data: [], error: null });
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('loads only due Outstand posts without requiring the missing RPC', async () => {
    mockSnapshotIn.mockResolvedValue({ data: [
      { site_id: siteId, outstand_post_id: 'post-2', fetched_at: new Date().toISOString() },
    ], error: null });
    await expect(fetchAllSocialPostsDueForAnalyticsActivity([siteId]))
      .resolves.toEqual([{ siteId, postId: 'post-1', contentId: 'content-1' }]);
    expect(mockFrom).toHaveBeenCalledWith('content');
    expect(mockFrom).toHaveBeenCalledWith('content_performance');
  });

  it('does not hide unrelated RPC failures', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'permission denied' } });
    await expect(fetchAllSocialPostsDueForAnalyticsActivity([siteId]))
      .rejects.toThrow('permission denied');
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('retains the fast RPC when installed', async () => {
    mockRpc.mockResolvedValue({ data: [{ site_id: siteId, post_id: 'post-1', content_id: 'content-1' }], error: null });
    await expect(fetchAllSocialPostsDueForAnalyticsActivity([siteId]))
      .resolves.toEqual([{ siteId, postId: 'post-1', contentId: 'content-1' }]);
    expect(mockFrom).not.toHaveBeenCalled();
  });
});