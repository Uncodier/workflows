import { randomUUID } from 'node:crypto';
import {
  countMissedRenewalCycles,
  fetchSitesDueForCreditRenewalActivity,
  renewSiteCreditsActivity,
} from '../src/temporal/activities/billingActivities';
import {
  getSupabaseService,
  type SupabaseService,
} from '../src/temporal/services/supabaseService';

jest.mock('../src/temporal/services/supabaseService', () => ({
  getSupabaseService: jest.fn(),
}));

describe('countMissedRenewalCycles', () => {
  it('counts one missed cycle when renewal day passed this month', () => {
    const start = new Date('2026-03-24T22:50:25Z');
    const today = new Date('2026-05-18T12:00:00Z');

    expect(countMissedRenewalCycles(start, null, today)).toBe(1);
  });

  it('returns zero when no renewal dates have passed yet', () => {
    const start = new Date('2026-05-10T00:00:00Z');
    const today = new Date('2026-05-18T12:00:00Z');

    expect(countMissedRenewalCycles(start, null, today)).toBe(0);
  });

  it('returns zero when last renewal covers the latest cycle', () => {
    const start = new Date('2025-01-15T00:00:00Z');
    const lastRenewal = new Date('2026-04-15T00:00:00Z');
    const today = new Date('2026-05-10T12:00:00Z');

    expect(countMissedRenewalCycles(start, lastRenewal, today)).toBe(0);
  });

  it('handles end-of-month anchor days', () => {
    const start = new Date('2025-01-31T00:00:00Z');
    const today = new Date('2026-03-31T12:00:00Z');

    expect(countMissedRenewalCycles(start, null, today)).toBeGreaterThan(0);
  });
});

describe('monthly credit renewal activities', () => {
  const stripeSubscriptionId = `sub_test_${randomUUID()}`;
  const supabaseService: jest.Mocked<Pick<SupabaseService,
    | 'fetchActiveBillings'
    | 'fetchBillingForSite'
    | 'updateSiteCredits'
    | 'createPaymentRecord'
    | 'fetchLastStripeSubscriptionPayment'
    | 'getClient'
  >> = {
    fetchActiveBillings: jest.fn(),
    fetchBillingForSite: jest.fn(),
    updateSiteCredits: jest.fn(),
    createPaymentRecord: jest.fn(),
    fetchLastStripeSubscriptionPayment: jest.fn(),
    getClient: jest.fn(),
  };
  const renewalQuery = {
    select: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn(),
  };
  const client = { from: jest.fn() };

  beforeEach(() => {
    jest.resetAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-04-30T12:00:00Z'));
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.mocked(getSupabaseService).mockReturnValue(supabaseService as unknown as SupabaseService);
    supabaseService.getClient.mockReturnValue(client as unknown as ReturnType<SupabaseService['getClient']>);
    client.from.mockReturnValue(renewalQuery);
    renewalQuery.select.mockReturnThis();
    renewalQuery.in.mockReturnThis();
    renewalQuery.eq.mockReturnThis();
    renewalQuery.order.mockResolvedValue({ data: [], error: null });
    supabaseService.fetchBillingForSite.mockResolvedValue(null);
    supabaseService.updateSiteCredits.mockResolvedValue(undefined);
    supabaseService.createPaymentRecord.mockResolvedValue({ id: 'renewal-payment' });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  function expectNoCreditWrites() {
    expect(supabaseService.updateSiteCredits).not.toHaveBeenCalled();
    expect(supabaseService.createPaymentRecord).not.toHaveBeenCalled();
    expect(supabaseService.fetchLastStripeSubscriptionPayment).not.toHaveBeenCalled();
  }

  describe('renewSiteCreditsActivity', () => {
    it.each([137, 0])('uses persisted Stripe ownership when queued input omits it (balance %s)', async (balance) => {
      supabaseService.fetchBillingForSite.mockResolvedValue({
        stripe_subscription_id: stripeSubscriptionId,
        credits_available: balance,
      });

      await expect(renewSiteCreditsActivity('site-stripe', 'startup', 50)).resolves.toEqual({
        success: true,
        newCredits: balance,
        oldCredits: balance,
      });

      expect(supabaseService.fetchBillingForSite).toHaveBeenCalledWith('site-stripe');
      expectNoCreditWrites();
    });

    it('also skips queued Stripe input when persisted billing has no Stripe ID', async () => {
      supabaseService.fetchBillingForSite.mockResolvedValue({
        stripe_subscription_id: null,
        credits_available: 73,
      });

      await expect(renewSiteCreditsActivity('site-stripe', 'enterprise', 50, stripeSubscriptionId))
        .resolves.toEqual({ success: true, newCredits: 73, oldCredits: 73 });

      expect(supabaseService.fetchBillingForSite).toHaveBeenCalledWith('site-stripe');
      expectNoCreditWrites();
    });

    it('skips queued Stripe input even if persisted billing is missing', async () => {
      await expect(renewSiteCreditsActivity('site-stripe', 'startup', 50, stripeSubscriptionId))
        .resolves.toEqual({ success: true, newCredits: 50, oldCredits: 50 });

      expect(supabaseService.fetchBillingForSite).toHaveBeenCalledWith('site-stripe');
      expectNoCreditWrites();
    });

    it.each([undefined, stripeSubscriptionId])('fails closed if the persisted read fails (input %s)', async (inputId) => {
      const error = new Error('Billing read failed');
      supabaseService.fetchBillingForSite.mockRejectedValue(error);

      await expect(renewSiteCreditsActivity('site-unreadable', 'startup', 50, inputId)).rejects.toThrow(error);

      expect(supabaseService.fetchBillingForSite).toHaveBeenCalledWith('site-unreadable');
      expectNoCreditWrites();
    });

    it.each<[string, number, number, number]>([
      ['startup', 50, 150, 100],
      ['ENTERPRISE', 50, 1050, 1000],
      ['free', 5, 20, 15],
      ['free', 50, 20, 0],
      ['commission', 5, 20, 15],
      ['commission', 50, 20, 0],
      ['manual', 50, 80, 30],
      ['', 50, 20, 0],
    ])('preserves non-Stripe %s policy from %s to %s', async (plan, current, renewed, granted) => {
      supabaseService.fetchBillingForSite.mockResolvedValue({
        stripe_subscription_id: null,
        credits_available: current,
      });

      await expect(renewSiteCreditsActivity('site-manual', plan, current)).resolves.toEqual({
        success: true,
        newCredits: renewed,
        oldCredits: current,
      });

      expect(supabaseService.fetchBillingForSite).toHaveBeenCalledWith('site-manual');
      expect(supabaseService.fetchBillingForSite.mock.invocationCallOrder[0])
        .toBeLessThan(supabaseService.updateSiteCredits.mock.invocationCallOrder[0]);
      expect(supabaseService.updateSiteCredits).toHaveBeenCalledTimes(1);
      expect(supabaseService.updateSiteCredits).toHaveBeenCalledWith('site-manual', renewed);
      expect(supabaseService.createPaymentRecord).toHaveBeenCalledTimes(1);
      expect(supabaseService.createPaymentRecord).toHaveBeenCalledWith({
        site_id: 'site-manual',
        amount: 0,
        credits: granted,
        payment_method: 'credit_renewal',
        status: 'completed',
        transaction_type: 'credit',
        details: {
          note: 'Monthly credit renewal',
          plan: (plan || 'free').toLowerCase(),
          stripe_subscription_id: null,
        },
      });
      expect(supabaseService.fetchLastStripeSubscriptionPayment).not.toHaveBeenCalled();
    });

    it('preserves non-Stripe renewal and custom notes when no billing row is returned', async () => {
      await expect(renewSiteCreditsActivity('site-manual', 'startup', 50, undefined, { note: 'Backfill credit renewal' }))
        .resolves.toEqual({ success: true, newCredits: 150, oldCredits: 50 });

      expect(supabaseService.fetchBillingForSite).toHaveBeenCalledWith('site-manual');
      expect(supabaseService.updateSiteCredits).toHaveBeenCalledWith('site-manual', 150);
      expect(supabaseService.createPaymentRecord).toHaveBeenCalledWith(expect.objectContaining({
        credits: 100,
        details: { note: 'Backfill credit renewal', plan: 'startup', stripe_subscription_id: null },
      }));
    });
  });

  describe('fetchSitesDueForCreditRenewalActivity', () => {
    const billing = {
      plan: 'startup',
      credits_available: 50,
      status: 'active',
      subscription_start_date: '2026-01-30T00:00:00Z',
      created_at: '2026-01-30T00:00:00Z',
      stripe_subscription_id: null,
    };

    it('excludes Stripe rows on renewal day, month-end catchup and overdue backfill', async () => {
      const stripeBillings = [
        { ...billing, site_id: 'stripe-exact', stripe_subscription_id: stripeSubscriptionId },
        { ...billing, site_id: 'stripe-month-end', subscription_start_date: '2026-01-31T00:00:00Z', stripe_subscription_id: stripeSubscriptionId },
        { ...billing, site_id: 'stripe-overdue', subscription_start_date: '2026-01-01T00:00:00Z', stripe_subscription_id: stripeSubscriptionId },
      ];
      const manualBillings = ['free', 'commission', 'startup', 'enterprise', 'manual'].map((plan) => ({
        ...billing, site_id: `site-${plan}`, plan,
      }));
      supabaseService.fetchActiveBillings.mockResolvedValue([...stripeBillings, ...manualBillings]);

      await expect(fetchSitesDueForCreditRenewalActivity()).resolves.toEqual(manualBillings);

      expect(supabaseService.fetchActiveBillings).toHaveBeenCalledTimes(1);
      expect(renewalQuery.in).toHaveBeenCalledWith('site_id', manualBillings.map((row) => row.site_id));
      expectNoCreditWrites();
    });

    it('does not query renewal history if all active billings are Stripe-managed', async () => {
      supabaseService.fetchActiveBillings.mockResolvedValue([
        { ...billing, site_id: 'stripe-only', stripe_subscription_id: stripeSubscriptionId },
      ]);

      await expect(fetchSitesDueForCreditRenewalActivity()).resolves.toEqual([]);

      expect(supabaseService.getClient).not.toHaveBeenCalled();
      expectNoCreditWrites();
    });

    it('keeps non-Stripe month-end/overdue catchup and skips newly started or recently renewed rows', async () => {
      const monthEnd = { ...billing, site_id: 'manual-month-end', subscription_start_date: '2026-01-31T00:00:00Z' };
      const overdue = { ...billing, site_id: 'manual-overdue', subscription_start_date: '2026-01-01T00:00:00Z' };
      const missingStripeId = { ...billing, site_id: 'manual-legacy', stripe_subscription_id: undefined };
      supabaseService.fetchActiveBillings.mockResolvedValue([
        monthEnd,
        overdue,
        missingStripeId,
        { ...billing, site_id: 'manual-new', subscription_start_date: '2026-04-30T00:00:00Z' },
        { ...billing, site_id: 'manual-recent' },
      ]);
      renewalQuery.order.mockResolvedValue({
        data: [{ site_id: 'manual-recent', created_at: '2026-04-20T00:00:00Z' }],
        error: null,
      });

      await expect(fetchSitesDueForCreditRenewalActivity()).resolves.toEqual([monthEnd, overdue, missingStripeId]);

      expectNoCreditWrites();
    });
  });
});
