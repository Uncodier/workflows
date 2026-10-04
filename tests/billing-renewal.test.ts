import { randomUUID } from 'node:crypto';
import {
  fetchSitesDueForCreditRenewalActivity,
  fetchSitesNeedingInitializationActivity,
  initializeSiteCreditsActivity,
  renewSiteCreditsActivity,
} from '../src/temporal/activities/billingActivities';
import { getSupabaseService, type SupabaseService } from '../src/temporal/services/supabaseService';
import { reconcileCurrentCreditPeriods } from '../src/scripts/backfill-credit-renewals';

jest.mock('../src/temporal/services/supabaseService', () => ({
  getSupabaseService: jest.fn(),
}));

describe('credit RPC activities', () => {
  const service = {
    fetchBillingRenewalCandidates: jest.fn(),
    fetchSitesWithoutBilling: jest.fn(),
    renewSitePlanCredits: jest.fn(),
    initializeSiteBilling: jest.fn(),
    // These old writer mocks must never be used by any activity.
    updateSiteCredits: jest.fn(),
    createBillingRecord: jest.fn(),
    createPaymentRecord: jest.fn(),
    fetchBillingForSite: jest.fn(),
    getClient: jest.fn(),
  };

  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(getSupabaseService).mockReturnValue(service as unknown as SupabaseService);
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    expect(service.updateSiteCredits).not.toHaveBeenCalled();
    expect(service.createBillingRecord).not.toHaveBeenCalled();
    expect(service.createPaymentRecord).not.toHaveBeenCalled();
    expect(service.fetchBillingForSite).not.toHaveBeenCalled();
    expect(service.getClient).not.toHaveBeenCalled();
    jest.restoreAllMocks();
  });

  it.each(['reset', 'not_due', 'stale_period', 'stripe_managed', 'inactive'])(
    'uses only site ID, ignoring stale/additive queued hints (%s)', async (outcome) => {
      const result = { success: true, outcome, credits_available: 27, credits_granted: 0 };
      service.renewSitePlanCredits.mockResolvedValue(result);
      await expect(renewSiteCreditsActivity('site', 'enterprise', 100000,
        `sub_test_${randomUUID()}`, { note: '12 missed grants' })).resolves.toEqual(result);
      expect(service.renewSitePlanCredits).toHaveBeenCalledWith('site');
      expect(service.renewSitePlanCredits).toHaveBeenCalledTimes(1);
    }
  );

  it.each(['initialized', 'already_initialized'])('uses shared once-only signup RPC (%s)', async (outcome) => {
    const result = { success: true, outcome, billing_id: 'billing', credits_available: 30, credits_granted: 0 };
    service.initializeSiteBilling.mockResolvedValue(result);
    await expect(initializeSiteCreditsActivity('site')).resolves.toEqual(result);
    expect(service.initializeSiteBilling).toHaveBeenCalledWith('site');
  });

  it.each(['initializeSiteBilling', 'renewSitePlanCredits'] as const)('fails closed on %s errors', async (method) => {
    service[method].mockRejectedValue(new Error('Coordinated RPC unavailable'));
    const action = method === 'initializeSiteBilling' ? initializeSiteCreditsActivity : renewSiteCreditsActivity;
    await expect(action('site')).rejects.toThrow('Coordinated RPC unavailable');
  });

  it('discovers canceled with retained Stripe IDs and active Stripe as RPC candidates', async () => {
    const billings = [
      { site_id: 'active', status: 'active', stripe_subscription_id: `sub_test_${randomUUID()}` },
      { site_id: 'canceled', status: 'canceled', stripe_subscription_id: `sub_test_${randomUUID()}` },
      { site_id: 'cancelled', status: 'cancelled' },
      { site_id: 'expired', status: 'incomplete_expired' },
      { site_id: 'old', created_at: '2020-01-01' },
      { site_id: 'new', created_at: '2026-10-03' },
    ];
    service.fetchBillingRenewalCandidates.mockResolvedValue([...billings, billings[0], { site_id: null }]);
    await expect(fetchSitesDueForCreditRenewalActivity()).resolves.toEqual(billings);
    expect(service.renewSitePlanCredits).not.toHaveBeenCalled();
  });

  it('deduplicates signup discovery without granting on discovery', async () => {
    service.fetchSitesWithoutBilling.mockResolvedValue(['site', 'site', 'other', '']);
    await expect(fetchSitesNeedingInitializationActivity()).resolves.toEqual(['site', 'other']);
    expect(service.initializeSiteBilling).not.toHaveBeenCalled();
  });

  it('backfill reconciles once per unique site and counts no-ops separately', async () => {
    const renew = jest.fn()
      .mockResolvedValueOnce({ success: true, outcome: 'reset', credits_available: 120 })
      .mockResolvedValueOnce({ success: true, outcome: 'not_due', credits_available: 120 })
      .mockResolvedValueOnce({ success: true, outcome: 'stripe_managed', credits_available: 120 })
      .mockRejectedValueOnce(new Error('RPC failed'));
    await expect(reconcileCurrentCreditPeriods(['missed-years', 'missed-years', 'current', 'stripe', 'bad'], renew))
      .resolves.toEqual({ reset: 1, skipped: 2, errors: 1 });
    expect(renew).toHaveBeenCalledTimes(4);
    expect(renew).toHaveBeenNthCalledWith(1, 'missed-years');
  });
});