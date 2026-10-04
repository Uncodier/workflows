import { SupabaseClient } from '@supabase/supabase-js';

export interface BillingInitializationResult {
  success: true;
  outcome: 'initialized' | 'already_initialized';
  credits_granted: number;
  billing_id: string;
  credits_available: number;
}

export interface PlanCreditRenewalResult {
  success: true;
  outcome: 'reset' | 'not_due' | 'stale_period' | 'stripe_managed' | 'inactive';
  credits_granted: number;
  credits_available: number;
}

/** Candidates only: the RPC owns period eligibility and Stripe ownership. */
export async function fetchBillingRenewalCandidates(client: SupabaseClient): Promise<any[]> {
  console.log('🔍 Fetching billing renewal candidates...');
  const records: any[] = [];
  const pageSize = 500;
  // Include all states: subscription_status can be canceled while billing.status
  // is inactive. RPC eligibility is authoritative. Page to avoid PostgREST caps.
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await client
      .from('billing')
      .select('id, site_id, plan, credits_available, status, stripe_subscription_id')
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) {
      throw new Error(`Failed to fetch billing records: ${error.message}`);
    }
    records.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  console.log(`✅ Successfully fetched ${records.length} billing renewal candidates`);
  return records;
}

async function callCreditRpc(
  client: SupabaseClient,
  name: string,
  siteId: string,
  outcomes: readonly string[]
): Promise<Record<string, unknown>> {
  const { data, error } = await client.rpc(name, { p_site_id: siteId });
  if (error) {
    throw new Error(`${name} failed: ${error.message}`);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.success !== true) {
    throw new Error(`${name} failed: ${typeof data?.error === 'string' ? data.error : 'Invalid or unsuccessful RPC result'}`);
  }
  if (!outcomes.includes(data.outcome) ||
      typeof data.credits_granted !== 'number' || !Number.isFinite(data.credits_granted) || data.credits_granted < 0 ||
      typeof data.credits_available !== 'number' || !Number.isFinite(data.credits_available)) {
    throw new Error(`${name} failed: Invalid credit RPC result`);
  }
  return data;
}

export async function renewSitePlanCredits(client: SupabaseClient, siteId: string): Promise<PlanCreditRenewalResult> {
  const result = await callCreditRpc(client, 'renew_site_plan_credits', siteId,
    ['reset', 'not_due', 'stale_period', 'stripe_managed', 'inactive']);
  return result as unknown as PlanCreditRenewalResult;
}

export async function initializeSiteBilling(client: SupabaseClient, siteId: string): Promise<BillingInitializationResult> {
  const result = await callCreditRpc(client, 'initialize_site_billing', siteId,
    ['initialized', 'already_initialized']);
  if (typeof result.billing_id !== 'string' || !result.billing_id) {
    throw new Error('initialize_site_billing failed: Invalid billing ID');
  }
  return result as unknown as BillingInitializationResult;
}

export async function fetchBillingForSite(client: SupabaseClient, siteId: string): Promise<any> {
  const { data, error } = await client
    .from('billing')
    .select('*')
    .eq('site_id', siteId)
    .maybeSingle();

  if (error) {
    console.error(`❌ Error fetching billing for site ${siteId}:`, error);
    throw new Error(`Failed to fetch billing: ${error.message}`);
  }
  return data;
}

export async function fetchSitesWithoutBilling(client: SupabaseClient): Promise<string[]> {
  console.log('🔍 Fetching sites needing billing initialization...');

  const { data, error } = await client.rpc(
    'fetch_sites_needing_billing_initialization'
  );

  if (error) {
    throw new Error(`Failed to fetch sites needing billing initialization: ${error.message}`);
  }

  const siteIds = (data || []).map((row: { site_id: string }) => row.site_id);
  console.log(`✅ Found ${siteIds.length} sites needing billing initialization`);
  return siteIds;
}
