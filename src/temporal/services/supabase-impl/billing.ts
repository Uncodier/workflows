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
      status
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
