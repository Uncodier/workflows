import { SupabaseClient } from '@supabase/supabase-js';

export async function fetchSites(client: SupabaseClient): Promise<any[]> {
  console.log('🔍 Fetching sites from Supabase...');
  const { data, error } = await client
    .from('sites')
    .select('*');

  if (error) {
    console.error('❌ Error fetching sites:', error);
    throw new Error(`Failed to fetch sites: ${error.message}`);
  }

  console.log(`✅ Successfully fetched ${data?.length || 0} sites from database`);
  return data || [];
}

export async function fetchSitesWithEmailEnabled(client: SupabaseClient): Promise<any[]> {
  console.log('🔍 Fetching sites with email sync enabled...');
  
  // First, get all settings that have channels configured
  const { data: settingsData, error: settingsError } = await client
    .from('settings')
    .select('site_id, channels')
    .not('channels', 'is', null);

  if (settingsError) {
    console.error('❌ Error fetching settings with channels:', settingsError);
    throw new Error(`Failed to fetch settings: ${settingsError.message}`);
  }

  // Filter settings that have email, agent or agent_mail enabled and active
  const enabledEmailSettings = (settingsData || []).filter(setting => {
    const channels = setting.channels;
    if (!channels) return false;

    // Check email (accepts "active" or "synced")
    const isEmailEnabled = channels.email?.enabled === true && 
      (channels.email?.status === 'active' || channels.email?.status === 'synced');
    
    // Check agent (accepts "active")
    const isAgentEnabled = channels.agent?.enabled === true && 
      channels.agent?.status === 'active';

    // Check agent_mail or agent_email (accepts "active" or "synced" or enabled=true)
    const agentChannel = channels.agent_mail || channels.agent_email;
    const isAgentMailEnabled = agentChannel && agentChannel.enabled === true && (
      agentChannel.status === 'active' || 
      agentChannel.status === 'synced'
    );

    return isEmailEnabled || isAgentEnabled || isAgentMailEnabled;
  });

  console.log(`✅ Found ${enabledEmailSettings.length} settings with email enabled`);

  if (enabledEmailSettings.length === 0) {
    return [];
  }

  // Get the corresponding sites
  const siteIds = enabledEmailSettings.map(setting => setting.site_id);
  console.log(`🔍 Fetching sites data for ${siteIds.length} site IDs...`);

  const { data: sitesData, error: sitesError } = await client
    .from('sites')
    .select('*')
    .in('id', siteIds);

  if (sitesError) {
    console.error('❌ Error fetching sites:', sitesError);
    throw new Error(`Failed to fetch sites: ${sitesError.message}`);
  }

  console.log(`✅ Successfully fetched ${sitesData?.length || 0} sites with email enabled`);

  // Combine sites with their email settings
  const sitesWithEmailConfig = (sitesData || []).map(site => {
    const siteSettings = enabledEmailSettings.find(setting => setting.site_id === site.id);
    return {
      ...site,
      emailSettings: siteSettings?.channels?.email || null
    };
  });

  return sitesWithEmailConfig;
}

