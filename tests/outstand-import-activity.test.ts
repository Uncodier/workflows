const mockGet = jest.fn();
const mockPost = jest.fn();
const mockNot = jest.fn();
const mockSelect = jest.fn(() => ({ not: mockNot }));
const mockFrom = jest.fn(() => ({ select: mockSelect }));
const mockSchema = jest.fn(() => ({ from: mockFrom }));

jest.mock('../src/temporal/services/apiService', () => ({
  apiService: { get: mockGet, post: mockPost },
}));
jest.mock('../src/lib/supabase/client', () => ({
  supabaseServiceRole: { schema: mockSchema },
}));

import { importOutstandPostsActivity } from '../src/temporal/activities/outstandActivities';

const account = { id: 'account-1', network: 'linkedin', isActive: true };
const owner = { site_id: 'site-1', social_media: [account] };
const rejected = { type: 'OUTSTAND_IMPORT_OWNERSHIP_REJECTED', nonRetryable: true };

describe('importOutstandPostsActivity historical ID contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGet.mockResolvedValue({ success: true, data: { accounts: [account] } });
    mockNot.mockResolvedValue({ data: [owner], error: null });
    mockPost.mockResolvedValue({ success: true, data: { importId: 'import-1' } });
  });

  it('accepts the original string payload and resolves ownership before POST', async () => {
    await expect(importOutstandPostsActivity('site-1', 'account-1'))
      .resolves.toEqual({ importId: 'import-1' });
    expect(mockGet).toHaveBeenCalledWith('/api/integrations/outstand/accounts?tenant_id=site-1');
    expect(mockFrom).toHaveBeenCalledWith('settings');
    expect(mockSelect).toHaveBeenCalledWith('site_id, social_media');
    expect(mockPost).toHaveBeenCalledWith(
      '/api/integrations/outstand/accounts/account-1/imports?tenant_id=site-1', {}
    );
    expect(mockNot.mock.invocationCallOrder[0]).toBeLessThan(mockPost.mock.invocationCallOrder[0]);
  });

  it('does not trust the shared-organization accounts list as proof of ownership', async () => {
    mockNot.mockResolvedValue({ data: [{ ...owner, site_id: 'another-site' }], error: null });
    await expect(importOutstandPostsActivity('site-1', account.id)).rejects.toMatchObject(rejected);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('rejects accounts connected to two sites without retrying the import', async () => {
    mockNot.mockResolvedValue({ data: [owner, { ...owner, site_id: 'site-2' }], error: null });
    await expect(importOutstandPostsActivity('site-1', account.id)).rejects.toMatchObject(rejected);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it.each([
    { settings: [] },
    { settings: [{ ...owner, social_media: [{ ...account, isActive: false }] }] },
    { settings: [{ ...owner, social_media: [{ ...account, network: 'facebook' }] }] },
  ])('rejects missing, inactive or mismatched connections: %j', async ({ settings }) => {
    mockNot.mockResolvedValue({ data: settings, error: null });
    await expect(importOutstandPostsActivity('site-1', account.id)).rejects.toMatchObject(rejected);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('rechecks current ownership when retrying a previously valid account ID', async () => {
    await importOutstandPostsActivity('site-1', account.id);
    mockNot.mockResolvedValue({ data: [{ ...owner, site_id: 'new-owner' }], error: null });
    await expect(importOutstandPostsActivity('site-1', account.id)).rejects.toMatchObject(rejected);
    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it.each([
    { accounts: [] },
    { accounts: [account, { ...account }] },
    { accounts: [{ ...account, isActive: false }] },
  ])(
    'rejects missing, ambiguous or inactive provider accounts: %j', async ({ accounts }) => {
      mockGet.mockResolvedValue({ success: true, data: accounts });
      await expect(importOutstandPostsActivity('site-1', account.id)).rejects.toMatchObject(rejected);
      expect(mockPost).not.toHaveBeenCalled();
    }
  );

  it('fails closed on a database error while allowing Temporal to retry the lookup', async () => {
    mockNot.mockResolvedValue({ data: null, error: { message: 'connection unavailable' } });
    await expect(importOutstandPostsActivity('site-1', account.id))
      .rejects.toThrow('Failed to verify Outstand import ownership: connection unavailable');
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('fails closed when resolving the account fails', async () => {
    mockGet.mockResolvedValue({ success: false, error: { message: '500 upstream unavailable' } });
    await expect(importOutstandPostsActivity('site-1', account.id)).rejects.toThrow('fetchOutstandAccounts failed');
    expect(mockNot).not.toHaveBeenCalled();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('rejects a malformed accounts response before POST', async () => {
    mockGet.mockResolvedValue({ success: true, data: { accounts: {} } });
    await expect(importOutstandPostsActivity('site-1', account.id)).rejects.toThrow('invalid accounts response');
    expect(mockPost).not.toHaveBeenCalled();
  });

  it.each(['', ' ', null, { id: account.id }])('rejects invalid ID payloads: %j', async payload => {
    await expect(importOutstandPostsActivity('site-1', payload as string)).rejects.toMatchObject({
      type: 'OUTSTAND_IMPORT_INVALID_INPUT', nonRetryable: true,
    });
    expect(mockGet).not.toHaveBeenCalled();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('preserves provider import errors after successful ownership validation', async () => {
    mockPost.mockResolvedValue({ success: false, error: { message: '400 Bad Request' } });
    await expect(importOutstandPostsActivity('site-1', account.id)).rejects.toMatchObject({
      type: 'OUTSTAND_CLIENT_ERROR', nonRetryable: true,
    });
  });
});