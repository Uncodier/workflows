import { SupabaseClient } from '@supabase/supabase-js';

export async function fetchDraftContent(client: SupabaseClient, siteId: string): Promise<any[]> {
  console.log(`🔍 Fetching draft content for site: ${siteId}`);
  const { data, error } = await client
    .from('content')
    .select('*')
    .eq('site_id', siteId)
    .eq('status', 'draft');

  if (error) {
    console.error('❌ Error fetching draft content:', error);
    throw new Error(`Failed to fetch draft content: ${error.message}`);
  }

  console.log(`✅ Successfully fetched ${data?.length || 0} draft content records from database`);
  return data || [];
}

export async function fetchSiteAnalysis(client: SupabaseClient, siteId: string): Promise<any[]> {
  console.log(`🔍 Checking analysis records for site: ${siteId}`);
  const { data, error } = await client
    .from('analysis')
    .select('*')
    .eq('site_id', siteId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('❌ Error fetching site analysis:', error);
    throw new Error(`Failed to fetch site analysis: ${error.message}`);
  }

  console.log(`✅ Found ${data?.length || 0} analysis records for site ${siteId}`);
  return data || [];
}

export async function hasSiteAnalysis(client: SupabaseClient, siteId: string): Promise<{ hasAnalysis: boolean; lastAnalysis?: any; count: number }> {
  try {
    const analysisRecords = await fetchSiteAnalysis(client, siteId);
    const completedAnalysis = analysisRecords.filter(record => 
      record.status === 'completed' || record.status === null // null is also considered completed
    );
    
    const hasAnalysis = completedAnalysis.length > 0;
    const lastAnalysis = hasAnalysis ? completedAnalysis[0] : null; // First one is most recent due to ordering
    
    console.log(`📊 Site ${siteId} analysis status: ${hasAnalysis ? 'HAS ANALYSIS' : 'NO ANALYSIS'} (${completedAnalysis.length} completed records)`);
    
    return {
      hasAnalysis,
      lastAnalysis,
      count: completedAnalysis.length
    };
  } catch (error) {
    console.error(`❌ Error checking site analysis for ${siteId}:`, error);
    // In case of error, assume no analysis to be safe
    return { hasAnalysis: false, count: 0 };
  }
}

