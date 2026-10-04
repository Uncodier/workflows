import { getSupabaseService } from '../services/supabaseService';
import type {
  BillingInitializationResult,
  PlanCreditRenewalResult,
} from '../services/supabase-impl/billing';

/** Discovery only; the DB owns UTC-calendar periods and Stripe eligibility. */
export async function fetchSitesDueForCreditRenewalActivity(): Promise<any[]> {
  const billings = await getSupabaseService().fetchBillingRenewalCandidates();
  const seen = new Set<string>();
  return billings.filter((billing) => {
    if (!billing.site_id || seen.has(billing.site_id)) return false;
    seen.add(billing.site_id);
    return true;
  });
}

export async function renewSiteCreditsActivity(
  siteId: string,
  // Keep positional hints for queued Temporal activities. Financial authority
  // must come from locked persisted billing, never an earlier discovery read.
  _plan?: string,
  _currentCredits?: number,
  _stripeSubscriptionId?: string,
  _options?: { note?: string }
): Promise<PlanCreditRenewalResult> {
  console.log(`🔄 Reconciling current plan-credit period for site ${siteId}`);
  return getSupabaseService().renewSitePlanCredits(siteId);
}

export async function fetchSitesNeedingInitializationActivity(): Promise<string[]> {
  const siteIds = await getSupabaseService().fetchSitesWithoutBilling();
  return [...new Set(siteIds.filter(Boolean))];
}

export async function initializeSiteCreditsActivity(siteId: string): Promise<BillingInitializationResult> {
  console.log(`✨ Ensuring one-time billing initialization for site ${siteId}`);
  return getSupabaseService().initializeSiteBilling(siteId);
}