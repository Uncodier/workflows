import { getSupabaseService } from '../services/supabaseService';
import { fetchSetupSite } from './siteSetupAgentHelpers';

export interface Site {
  id: string;
  name: string;
  url: string;
  description?: string;
  user_id: string;
  created_at: string;
  updated_at: string;
}

export interface GetSiteResult {
  success: boolean;
  site?: Site;
  error?: string;
}

export async function getSiteActivity(siteId: string): Promise<GetSiteResult> {
  console.log(`🏢 Getting site information for: ${siteId}`);

  try {
    const supabaseService = getSupabaseService();

    // A scoped read is also the connectivity check; no global site probe is needed.
    const siteData = await fetchSetupSite(supabaseService.getClient(), siteId);

    if (!siteData) {
      console.error(`❌ Site ${siteId} not found`);
      return {
        success: false,
        error: 'Site not found'
      };
    }

    const site: Site = {
      id: siteData.id,
      name: siteData.name || '',
      url: siteData.url || '',
      description: siteData.description || null,
      user_id: siteData.user_id,
      created_at: siteData.created_at,
      updated_at: siteData.updated_at
    };

    console.log(`✅ Retrieved site information for ${site.name}: ${site.url}`);

    return {
      success: true,
      site
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Exception getting site ${siteId}:`, errorMessage);

    return {
      success: false,
      error: errorMessage
    };
  }
}
