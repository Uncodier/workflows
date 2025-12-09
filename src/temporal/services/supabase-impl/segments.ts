import { SupabaseClient } from '@supabase/supabase-js';

export async function fetchSegments(client: SupabaseClient, siteId: string): Promise<any[]> {
  console.log(`🔍 Fetching segments for site: ${siteId}`);
  const { data, error } = await client
    .from('segments')
    .select('*')
    .eq('site_id', siteId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('❌ Error fetching segments:', error);
    throw new Error(`Failed to fetch segments: ${error.message}`);
  }

  console.log(`✅ Successfully fetched ${data?.length || 0} segments from database`);
  return data || [];
}
