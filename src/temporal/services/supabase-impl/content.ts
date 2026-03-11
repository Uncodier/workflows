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
    
    let hasAnalysis = completedAnalysis.length > 0;
    let lastAnalysis = hasAnalysis ? completedAnalysis[0] : null; // First one is most recent due to ordering
    let count = completedAnalysis.length;

    // Fallback: Check if the site was analyzed by looking at the settings table
    // If 'about' and 'industry' are populated and not just the default placeholders, the site has been analyzed.
    if (!hasAnalysis) {
      console.log(`🔍 Checking settings table as fallback for site: ${siteId}`);
      const { data: settingsData, error: settingsError } = await client
        .from('settings')
        .select('about, industry')
        .eq('site_id', siteId)
        .single();
        
      if (!settingsError && settingsData) {
        // Checking if we have valid about/industry that are not the default descriptions
        const hasValidAbout = settingsData.about && 
                              settingsData.about.trim() !== '' && 
                              !settingsData.about.includes('A comprehensive description');
        const hasValidIndustry = settingsData.industry && 
                                 settingsData.industry.trim() !== '' && 
                                 !settingsData.industry.includes('The specific industry sector');
                                 
        if (hasValidAbout || hasValidIndustry) {
          console.log(`✅ Site ${siteId} has populated settings (about/industry), considering it analyzed.`);
          hasAnalysis = true;
          count = 1;
          lastAnalysis = { created_at: new Date().toISOString(), status: 'completed', source: 'settings_fallback' };
        }
      }
    }
    
    console.log(`📊 Site ${siteId} analysis status: ${hasAnalysis ? 'HAS ANALYSIS' : 'NO ANALYSIS'} (${count} completed records)`);
    
    return {
      hasAnalysis,
      lastAnalysis,
      count
    };
  } catch (error) {
    console.error(`❌ Error checking site analysis for ${siteId}:`, error);
    // In case of error, assume no analysis to be safe
    return { hasAnalysis: false, count: 0 };
  }
}



