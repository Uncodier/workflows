import { supabaseServiceRole } from '../../lib/supabase/client';

export interface ValidateWorkflowConfigResult {
  shouldExecute: boolean;
  reason: string;
  activityKey: string;
  activityStatus?: string;
}

/**
 * Validate if a workflow should execute based on settings.activities configuration
 * This provides a second line of defense beyond scheduling checks
 */
export async function validateWorkflowConfigActivity(
  siteId: string,
  activityKey: string
): Promise<ValidateWorkflowConfigResult> {
  console.log(`🔐 Validating workflow configuration for site ${siteId}, activity: ${activityKey}`);
  
  try {
    // Fetch activities configuration for the site
    const activitiesMap = await fetchActivitiesMapActivity([siteId]);
    const siteActivities = activitiesMap[siteId];

    // If no activities configuration exists, allow execution (backward compatibility)
    if (!siteActivities) {
      console.log(`✅ No activities configuration found - allowing execution (backward compatibility)`);
      return {
        shouldExecute: true,
        reason: 'No activities configuration found - backward compatibility',
        activityKey,
      };
    }

    // Check if the specific activity key exists in configuration
    const activityConfig = siteActivities[activityKey];
    
    // If activity key doesn't exist in configuration, allow execution (default behavior)
    if (!activityConfig) {
      console.log(`✅ Activity '${activityKey}' not configured - allowing execution (default behavior)`);
      return {
        shouldExecute: true,
        reason: `Activity '${activityKey}' not configured - default behavior`,
        activityKey,
      };
    }

    // Check the status of the activity
    const activityStatus = activityConfig.status;
    console.log(`📊 Activity '${activityKey}' status: ${activityStatus}`);

    // If status is 'inactive', block execution
    if (activityStatus === 'inactive') {
      console.log(`⛔ Workflow execution blocked - activity '${activityKey}' is inactive`);
      return {
        shouldExecute: false,
        reason: `Activity '${activityKey}' is inactive in site settings`,
        activityKey,
        activityStatus,
      };
    }

    // For any other status (including 'default'), allow execution
    console.log(`✅ Workflow execution allowed - activity '${activityKey}' status: ${activityStatus}`);
    return {
      shouldExecute: true,
      reason: `Activity '${activityKey}' is ${activityStatus}`,
      activityKey,
      activityStatus,
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Error validating workflow configuration for site ${siteId}:`, errorMessage);
    
    // On error, allow execution to avoid breaking workflows
    return {
      shouldExecute: true,
      reason: `Error validating configuration - allowing execution to avoid breaking workflow`,
      activityKey,
    };
  }
}

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



