import { supabaseServiceRole } from '../../lib/supabase/client';

/**
 * Fetch a single map of activities per site to be reused across scheduling calls.
 * If siteIds is empty or not provided, it fetches all rows from settings.
 */
export async function fetchActivitiesMapActivity(siteIds?: string[]): Promise<Record<string, any>> {
  const activitiesMap: Record<string, any> = {};

  try {
    let query = supabaseServiceRole
      .from('settings')
      .select('site_id, activities');

    if (siteIds && siteIds.length > 0) {
      query = query.in('site_id', siteIds);
    }

    const { data, error } = await query;
    if (error) {
      console.error('❌ Error fetching settings activities map:', error);
      return activitiesMap; // Return empty map on error to avoid breaking scheduling
    }

    for (const row of data || []) {
      if (row && row.site_id) {
        activitiesMap[row.site_id] = row.activities || undefined;
      }
    }

    return activitiesMap;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('❌ Exception in fetchActivitiesMapActivity:', msg);
    return activitiesMap;
  }
}



