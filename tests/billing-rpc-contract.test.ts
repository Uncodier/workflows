import type { SupabaseClient } from '@supabase/supabase-js';
import {
  fetchBillingRenewalCandidates,
  initializeSiteBilling,
  renewSitePlanCredits,
} from '../src/temporal/services/supabase-impl/billing';

describe('coordinated billing RPC contract', () => {
  const client = { rpc: jest.fn(), from: jest.fn() };
  const supabase = client as unknown as SupabaseClient;

  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  it.each([
    ['commission', 1], ['engine', 20], ['foundry', 100], ['enterprise', 500],
  ])('returns authoritative %s aggregate without recalculating protected balances', async (_plan, allowance) => {
    const purchased = 40.5;
    const legacy = 16.25;
    const response = {
      success: true, outcome: 'reset', credits_granted: allowance,
      credits_available: Number(allowance) + purchased + legacy,
    };
    client.rpc.mockResolvedValue({ data: response, error: null });
    await expect(renewSitePlanCredits(supabase, 'site')).resolves.toEqual(response);
    expect(client.rpc).toHaveBeenCalledWith('renew_site_plan_credits', { p_site_id: 'site' });
    expect(client.from).not.toHaveBeenCalled();
  });

  it('returns already-initialized balance unchanged; no additive signup fallback', async () => {
    const response = {
      success: true, outcome: 'already_initialized', credits_granted: 0,
      billing_id: 'existing-billing', credits_available: 107.5,
    };
    client.rpc.mockResolvedValue({ data: response, error: null });
    await expect(initializeSiteBilling(supabase, 'site')).resolves.toEqual(response);
    expect(client.rpc).toHaveBeenCalledWith('initialize_site_billing', { p_site_id: 'site' });
    expect(client.from).not.toHaveBeenCalled();
  });

  it('passes through same-period no-op balances after a first reset and spending', async () => {
    const response = { success: true, outcome: 'not_due', credits_granted: 0, credits_available: 57.5 };
    client.rpc.mockResolvedValue({ data: response, error: null });
    await expect(renewSitePlanCredits(supabase, 'site')).resolves.toEqual(response);
    await expect(renewSitePlanCredits(supabase, 'site')).resolves.toEqual(response);
    expect(client.from).not.toHaveBeenCalled();
  });

  it('accepts stale_period without trying to overwrite a later persisted period', async () => {
    const response = { success: true, outcome: 'stale_period', credits_granted: 0, credits_available: 13.5 };
    client.rpc.mockResolvedValue({ data: response, error: null });
    await expect(renewSitePlanCredits(supabase, 'site')).resolves.toEqual(response);
    expect(client.from).not.toHaveBeenCalled();
  });

  it.each([initializeSiteBilling, renewSitePlanCredits])('fails closed when RPC is absent or forbidden', async (action) => {
    client.rpc.mockResolvedValue({ data: null, error: { message: 'RPC unavailable or permission denied' } });
    await expect(action(supabase, 'site')).rejects.toThrow('RPC unavailable or permission denied');
    expect(client.from).not.toHaveBeenCalled();
  });

  it.each([initializeSiteBilling, renewSitePlanCredits])('rejects unsuccessful missing-site/billing results', async (action) => {
    client.rpc.mockResolvedValue({ data: { success: false, error: 'Site not found' }, error: null });
    await expect(action(supabase, 'deleted-site')).rejects.toThrow('Site not found');
    expect(client.from).not.toHaveBeenCalled();
  });

  it.each([
    null, [], { success: false },
    { success: true, outcome: 'unknown', credits_granted: 0, credits_available: 40 },
    { success: true, outcome: 'reset', credits_granted: -1, credits_available: 40 },
    { success: true, outcome: 'reset', credits_granted: 1, credits_available: '40' },
    { success: true, outcome: 'reset', credits_granted: Number.NaN, credits_available: 40 },
    { success: true, outcome: 'reset', credits_granted: 1, credits_available: Number.POSITIVE_INFINITY },
  ])('rejects malformed renewal JSON without legacy writes (%j)', async (data) => {
    client.rpc.mockResolvedValue({ data, error: null });
    await expect(renewSitePlanCredits(supabase, 'site')).rejects.toThrow(/failed:/);
    expect(client.from).not.toHaveBeenCalled();
  });

  it('requires a billing ID in successful signup responses', async () => {
    client.rpc.mockResolvedValue({
      data: { success: true, outcome: 'initialized', credits_granted: 30, credits_available: 30 }, error: null,
    });
    await expect(initializeSiteBilling(supabase, 'site')).rejects.toThrow('Invalid billing ID');
    expect(client.from).not.toHaveBeenCalled();
  });

  it('discovers every state including inactive rows with terminal subscription status', async () => {
    const records = [{ site_id: 'site', status: 'inactive', subscription_status: 'cancelled' }];
    const query = {
      select: jest.fn().mockReturnThis(), order: jest.fn().mockReturnThis(),
      range: jest.fn().mockResolvedValue({ data: records, error: null }),
    };
    client.from.mockReturnValue(query);
    await expect(fetchBillingRenewalCandidates(supabase)).resolves.toEqual(records);
    expect(query.order).toHaveBeenCalledWith('id', { ascending: true });
    expect(query.range).toHaveBeenCalledWith(0, 499);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('paginates renewal discovery rather than dropping sites above the row cap', async () => {
    const firstPage = Array.from({ length: 500 }, (_, i) => ({ site_id: `site-${i}` }));
    const secondPage = Array.from({ length: 500 }, (_, i) => ({ site_id: `site-${500 + i}` }));
    const lastPage = [{ site_id: 'last-site' }];
    const query = {
      select: jest.fn().mockReturnThis(), order: jest.fn().mockReturnThis(),
      range: jest.fn()
        .mockResolvedValueOnce({ data: firstPage, error: null })
        .mockResolvedValueOnce({ data: secondPage, error: null })
        .mockResolvedValueOnce({ data: lastPage, error: null }),
    };
    client.from.mockReturnValue(query);
    await expect(fetchBillingRenewalCandidates(supabase)).resolves.toEqual([...firstPage, ...secondPage, ...lastPage]);
    expect(query.range).toHaveBeenNthCalledWith(2, 500, 999);
    expect(query.range).toHaveBeenNthCalledWith(3, 1000, 1499);
  });

  it('fails on candidate query errors', async () => {
    const query = {
      select: jest.fn().mockReturnThis(), order: jest.fn().mockReturnThis(),
      range: jest.fn().mockResolvedValue({ data: null, error: { message: 'Read denied' } }),
    };
    client.from.mockReturnValue(query);
    await expect(fetchBillingRenewalCandidates(supabase)).rejects.toThrow('Read denied');
  });
});