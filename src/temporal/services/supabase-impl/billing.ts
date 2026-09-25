import { SupabaseClient } from '@supabase/supabase-js';

export async function fetchActiveBillings(client: SupabaseClient): Promise<any[]> {
  console.log('🔍 Fetching active billing records...');
  
  const { data, error } = await client
    .from('billing')
    .select(`
      id,
      site_id,
      plan,
      credits_available,
      credits_used,
      subscription_start_date,
      created_at,
      status,
      stripe_subscription_id
    `)
    .eq('status', 'active');

  if (error) {
    console.error('❌ Error fetching billing records:', error);
    throw new Error(`Failed to fetch billing records: ${error.message}`);
  }

  console.log(`✅ Successfully fetched ${data?.length || 0} active billing records`);
  return data || [];
}

export async function updateSiteCredits(
  client: SupabaseClient, 
  siteId: string, 
  credits: number
): Promise<void> {
  console.log(`Updating credits for site ${siteId} to ${credits}`);
  
  const { error } = await client
    .from('billing')
    .update({ 
      credits_available: credits,
      updated_at: new Date().toISOString()
    })
    .eq('site_id', siteId);

  if (error) {
    console.error(`❌ Error updating credits for site ${siteId}:`, error);
    throw new Error(`Failed to update credits: ${error.message}`);
  }
  
  console.log(`✅ Successfully updated credits for site ${siteId}`);
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

export async function createBillingRecord(
  client: SupabaseClient,
  billingData: {
    site_id: string;
    plan?: string;
    credits_available?: number;
    status?: string;
  }
): Promise<any> {
  console.log(`Creating billing record for site ${billingData.site_id}`);

  // First, check if a billing record already exists to avoid duplicates
  // since site_id does not have a unique constraint, we cannot use upsert with onConflict.
  const { data: existingData, error: fetchError } = await client
    .from('billing')
    .select()
    .eq('site_id', billingData.site_id)
    .maybeSingle();

  if (fetchError) {
    console.error(`❌ Error fetching existing billing record for site ${billingData.site_id}:`, fetchError);
    throw new Error(`Failed to fetch existing billing record: ${fetchError.message}`);
  }

  if (existingData) {
    console.log(`ℹ️ Billing record already exists for site ${billingData.site_id}, returning existing record...`);
    return existingData;
  }

  let { data, error } = await client
    .from('billing')
    .insert(
      {
        site_id: billingData.site_id,
        plan: billingData.plan || 'free',
        credits_available: billingData.credits_available || 0,
        credits_used: 0,
        status: billingData.status || 'active',
        subscription_start_date: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }
    )
    .select()
    .maybeSingle();

  if (error) {
    if (error.code === '23503' && error.message?.includes('billing_site_id_fkey')) {
      console.log(`⚠️ Site ${billingData.site_id} no longer exists. Skipping billing record creation.`);
      return null;
    }
    console.error(`❌ Error creating billing record for site ${billingData.site_id}:`, error);
    throw new Error(`Failed to create billing record: ${error.message}`);
  }

  console.log(`✅ Successfully created billing record for site ${billingData.site_id}`);
  return data;
}
