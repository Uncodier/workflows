const mockGet = jest.fn();
const mockPost = jest.fn();
const mockRpc = jest.fn();
const mockEq = jest.fn();
const mockNot = jest.fn();
const mockSelect = jest.fn(() => ({ not: mockNot, eq: mockEq }));
const mockFrom = jest.fn(() => ({ select: mockSelect, upsert: jest.fn().mockResolvedValue({ error: null }) }));
const mockSchema = jest.fn(() => ({ from: mockFrom, rpc: mockRpc }));

jest.mock('../src/temporal/services/apiService', () => ({
  apiService: { get: mockGet, post: mockPost },
}));
jest.mock('../src/lib/supabase/client', () => ({
  supabaseServiceRole: { schema: mockSchema },
}));

import {
  checkIfImportTriggeredActivity,
  fetchOutstandAccountsActivity,
  fetchOutstandImportJobsActivity,
  fetchOutstandPostAnalyticsActivity,
  fetchOutstandPostsActivity,
  importOutstandPostsActivity,
  markImportTriggeredActivity,
  startInitialOutstandImportActivity,
  recordInitialOutstandImportActivity,
} from '../src/temporal/activities/outstandActivities';

const account = { id: 'account-1', network: 'linkedin', isActive: true };
const rejected = { type: 'OUTSTAND_IMPORT_REQUIRES_CONFIRMATION', nonRetryable: true };

describe('importOutstandPostsActivity historical ID contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGet.mockResolvedValue({ success: true, data: { accounts: [account] } });
    mockRpc.mockResolvedValue({ data: true, error: null });
  });

  it('rejects old automatic imports before any network or database side effect', async () => {
    await expect(importOutstandPostsActivity('site-1', account.id)).rejects.toMatchObject(rejected);
    expect(mockGet).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('scopes the posts list to the tenant even with a shared provider organization', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: { posts: [], pagination: { total: 0 } } });
    await fetchOutstandPostsActivity('site-1', 100, 0);
    expect(mockGet).toHaveBeenCalledWith(
      '/api/integrations/outstand/posts?tenant_id=site-1&tenantId=site-1&limit=100&offset=0'
    );
  });

  it('unwraps the real Outstand posts envelope rather than silently treating it as empty', async () => {
    const post = { id: 'ig-post', socialAccounts: [{ id: 'account-1', network: 'instagram' }] };
    mockGet.mockResolvedValueOnce({
      success: true,
      data: { success: true, posts: [post], data: [post], pagination: { total: 1 } },
    });
    await expect(fetchOutstandPostsActivity('site-1', 100, 0)).resolves.toEqual({
      posts: [post], pagination: { total: 1 },
    });
  });

  it('fails on a malformed Outstand posts response rather than skipping import', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: { success: true, pagination: { total: 6 } } });
    await expect(fetchOutstandPostsActivity('site-1')).rejects.toThrow('Invalid Outstand posts response');
  });

  it('preserves the Outstand analytics envelope instead of silently writing zeros', async () => {
    const analytics = {
      success: true,
      post: { id: 'ig-post' },
      metrics_by_account: [{ network: 'instagram', metrics: { views: 25 } }],
      aggregated_metrics: { total_views: 25 },
    };
    mockGet.mockResolvedValueOnce({ success: true, data: analytics });
    await expect(fetchOutstandPostAnalyticsActivity('site-1', 'ig-post')).resolves.toEqual(analytics);
  });

  it('rejects analytics payloads without metrics rather than reporting zero performance', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: { success: true, data: {} } });
    await expect(fetchOutstandPostAnalyticsActivity('site-1', 'ig-post'))
      .rejects.toThrow('missing aggregated_metrics');
  });

  it('unwraps the existing API social-accounts response', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: { success: true, data: [account], accounts: [account] } });
    await expect(fetchOutstandAccountsActivity('site-1')).resolves.toEqual([account]);
  });

  it('lists provider import jobs without creating a billable import', async () => {
    const job = { id: 'job-1', status: 'queued', imported: 0, failed: 0 };
    mockGet.mockResolvedValueOnce({ success: true, data: { success: true, data: [job], count: 1 } });
    await expect(fetchOutstandImportJobsActivity('site-1', account.id)).resolves.toEqual([job]);
    expect(mockGet).toHaveBeenCalledWith(
      '/api/integrations/outstand/social-accounts/account-1/imports?tenant_id=site-1'
    );
  });

  it('accepts the import jobs array unwrapped by ApiService', async () => {
    const job = { id: 'job-1', status: 'completed', imported: 6, failed: 0 };
    mockGet.mockResolvedValueOnce({ success: true, data: [job] });
    await expect(fetchOutstandImportJobsActivity('site-1', account.id)).resolves.toEqual([job]);
  });

  it('fails closed on a malformed provider jobs response', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: { success: true, data: null } });
    await expect(fetchOutstandImportJobsActivity('site-1', account.id))
      .rejects.toThrow('Invalid Outstand import jobs response');
  });

  it('does not mark an account imported merely because another account was imported', async () => {
    const mockMaybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
    mockEq.mockReturnValue({ eq: jest.fn(() => ({ maybeSingle: mockMaybeSingle })) });
    await expect(checkIfImportTriggeredActivity('site-1', 'yTdoj')).resolves.toBe(false);
    expect(mockEq).toHaveBeenCalledWith('site_id', 'site-1');
    expect(mockEq.mock.results[0].value.eq).toHaveBeenCalledWith('activity_name', 'outstand_historical_import_yTdoj');

    await markImportTriggeredActivity('site-1', 'yTdoj');
    expect(mockFrom.mock.results[mockFrom.mock.results.length - 1]?.value.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ activity_name: 'outstand_historical_import_yTdoj' }),
      { onConflict: 'site_id,activity_name', ignoreDuplicates: false },
    );
  });

  it('only posts for a currently connected, unclaimed account', async () => {
    const settingsMaybe = jest.fn().mockResolvedValue({ data: { social_media: [account] }, error: null });
    const ledgerMaybe = jest.fn().mockResolvedValue({ data: null, error: null });
    mockFrom.mockImplementation((name) => ({
      select: () => ({ eq: () => ({ maybeSingle: name === 'settings' ? settingsMaybe : ledgerMaybe }) }),
    }));
    mockPost.mockResolvedValue({ success: true, data: { id: 'job-1', status: 'queued' } });
    await expect(startInitialOutstandImportActivity('site-1', account.id)).resolves.toBe(true);
    expect(mockPost).toHaveBeenCalledWith(
      '/api/integrations/outstand/social-accounts/account-1/imports?tenant_id=site-1',
      { confirm: true, limit: 100 }
    );
  });

  it('does not queue an unsupported X import', async () => {
    mockFrom.mockImplementation(() => ({ select: () => ({ eq: () => ({
      maybeSingle: jest.fn().mockResolvedValue({
        data: { social_media: [{ id: 'x-1', network: 'x', isActive: true }] }, error: null,
      }),
    }) }) }));
    await expect(startInitialOutstandImportActivity('site-1', 'x-1')).resolves.toBe(false);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('skips an inactive account before calling the billable route', async () => {
    mockFrom.mockImplementation(() => ({ select: () => ({ eq: () => ({
      maybeSingle: jest.fn().mockResolvedValue({
        data: { social_media: [{ ...account, isActive: false }] }, error: null,
      }),
    }) }) }));
    await expect(startInitialOutstandImportActivity('site-1', account.id)).resolves.toBe(false);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('records a terminal provider job once, without posting', async () => {
    await expect(recordInitialOutstandImportActivity('site-1', account.id, {
      id: 'job-1', status: 'completed', imported: 6, skipped: 0, failed: 0,
    })).resolves.toBe(true);
    expect(mockRpc).toHaveBeenCalledWith('record_outstand_initial_import', {
      p_site_id: 'site-1', p_account_id: account.id,
      p_status: 'completed', p_job_id: 'job-1', p_imported: 6, p_failed: 0,
    });
    expect(mockPost).not.toHaveBeenCalled();
  });
});