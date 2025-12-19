import { SupabaseClient } from '@supabase/supabase-js';

export async function fetchSettings(client: SupabaseClient, siteIds: string[]): Promise<any[]> {
  console.log(`🔍 Fetching settings for ${siteIds.length} sites from Supabase...`);
  const { data, error } = await client
    .from('settings')
    .select('site_id, channels')
    .in('site_id', siteIds);

  if (error) {
    console.error('❌ Error fetching settings:', error);
    throw new Error(`Failed to fetch settings: ${error.message}`);
  }

  console.log(`✅ Successfully fetched ${data?.length || 0} settings from database`);
  return data || [];
}

export async function fetchCompleteSettings(client: SupabaseClient, siteIds: string[]): Promise<any[]> {
  console.log(`🔍 Fetching complete settings for ${siteIds.length} sites from Supabase...`);
  const { data, error } = await client
    .from('settings')
    .select('*')
    .in('site_id', siteIds);

  if (error) {
    console.error('❌ Error fetching complete settings:', error);
    throw new Error(`Failed to fetch complete settings: ${error.message}`);
  }

  console.log(`✅ Successfully fetched ${data?.length || 0} complete settings from database`);
  
  // Log which fields we actually got for debugging
  if (data && data.length > 0) {
    const availableFields = Object.keys(data[0]);
    console.log(`📊 Available settings fields:`, {
      about: availableFields.includes('about'),
      industry: availableFields.includes('industry'),
      company_size: availableFields.includes('company_size'),
      products: availableFields.includes('products'),
      services: availableFields.includes('services'),
      goals: availableFields.includes('goals'),
      competitors: availableFields.includes('competitors'),
      branding: availableFields.includes('branding'),
      team_members: availableFields.includes('team_members'),
      locations: availableFields.includes('locations'),
      business_hours: availableFields.includes('business_hours'),
      channels: availableFields.includes('channels'),
      social_media: availableFields.includes('social_media'),
      swot: availableFields.includes('swot'),
      marketing_channels: availableFields.includes('marketing_channels'),
      marketing_budget: availableFields.includes('marketing_budget'),
      team_roles: availableFields.includes('team_roles'),
      org_structure: availableFields.includes('org_structure')
    });
  }
  
  return data || [];
}

export async function updateSiteSettings(client: SupabaseClient, siteId: string, updateData: any): Promise<any> {
  console.log(`🔍 Updating settings for site: ${siteId}`);
  console.log(`📝 Update data:`, JSON.stringify(updateData, null, 2));
  
  const { data, error } = await client
    .from('settings')
    .update({
      ...updateData,
      updated_at: new Date().toISOString()
    })
    .eq('site_id', siteId)
    .select()
    .single();

  if (error) {
    console.error(`❌ Error updating settings for site ${siteId}:`, error);
    throw new Error(`Failed to update settings: ${error.message}`);
  }

  if (!data) {
    throw new Error(`Settings for site ${siteId} not found or update failed`);
  }

  console.log(`✅ Successfully updated settings for site ${siteId}`);
  return data;
}



