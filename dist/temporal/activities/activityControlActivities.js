"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateWorkflowConfigActivity = validateWorkflowConfigActivity;
exports.fetchActivitiesMapActivity = fetchActivitiesMapActivity;
exports.getSiteIdFromCommandOrConversationActivity = getSiteIdFromCommandOrConversationActivity;
const client_1 = require("../../lib/supabase/client");
/**
 * Validate if a workflow should execute based on settings.activities configuration
 * This provides a second line of defense beyond scheduling checks
 */
async function validateWorkflowConfigActivity(siteId, activityKey) {
    console.log(`🔐 Validating workflow configuration for site ${siteId}, activity: ${activityKey}`);
    // Define opt-in activities that require explicit activation
    const optInActivities = ['supervise_conversations', 'assign_leads_to_team'];
    try {
        // Fetch activities configuration for the site
        const activitiesMap = await fetchActivitiesMapActivity([siteId]);
        const siteActivities = activitiesMap[siteId];
        // Special handling for opt-in activities: if no activities config exists, default to inactive
        if (optInActivities.includes(activityKey)) {
            if (!siteActivities) {
                console.log(`⛔ No activities configuration found - blocking execution for opt-in activity '${activityKey}' (defaults to inactive)`);
                return {
                    shouldExecute: false,
                    reason: `No activities configuration found - opt-in activity '${activityKey}' defaults to inactive`,
                    activityKey,
                };
            }
        }
        else {
            // For regular activities: if no activities configuration exists, allow execution (backward compatibility)
            if (!siteActivities) {
                console.log(`✅ No activities configuration found - allowing execution (backward compatibility)`);
                return {
                    shouldExecute: true,
                    reason: 'No activities configuration found - backward compatibility',
                    activityKey,
                };
            }
        }
        // Check if the specific activity key exists in configuration
        const activityConfig = siteActivities[activityKey];
        // Special handling for opt-in activities: if not configured, default to inactive
        if (optInActivities.includes(activityKey)) {
            if (!activityConfig) {
                console.log(`⛔ Activity '${activityKey}' not configured - blocking execution (opt-in feature defaults to inactive)`);
                return {
                    shouldExecute: false,
                    reason: `Activity '${activityKey}' not configured - opt-in feature defaults to inactive`,
                    activityKey,
                };
            }
        }
        else {
            // For regular activities: if activity key doesn't exist in configuration, allow execution (default behavior)
            if (!activityConfig) {
                console.log(`✅ Activity '${activityKey}' not configured - allowing execution (default behavior)`);
                return {
                    shouldExecute: true,
                    reason: `Activity '${activityKey}' not configured - default behavior`,
                    activityKey,
                };
            }
        }
        // Check the status of the activity
        const activityStatus = activityConfig.status;
        console.log(`📊 Activity '${activityKey}' status: ${activityStatus}`);
        // Special handling for opt-in activities (supervise_conversations, assign_leads_to_team)
        // These use "inactive" | "active" pattern and must be explicitly set to "active"
        if (optInActivities.includes(activityKey)) {
            if (activityStatus === 'active') {
                console.log(`✅ Workflow execution allowed - activity '${activityKey}' is active`);
                return {
                    shouldExecute: true,
                    reason: `Activity '${activityKey}' is active`,
                    activityKey,
                    activityStatus,
                };
            }
            else {
                // inactive or any other status blocks execution for opt-in activities
                console.log(`⛔ Workflow execution blocked - activity '${activityKey}' is not active (status: ${activityStatus})`);
                return {
                    shouldExecute: false,
                    reason: `Activity '${activityKey}' is not active in site settings (opt-in feature)`,
                    activityKey,
                    activityStatus,
                };
            }
        }
        // For regular activities: if status is 'inactive', block execution
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
    }
    catch (error) {
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
async function fetchActivitiesMapActivity(siteIds) {
    const activitiesMap = {};
    try {
        let query = client_1.supabaseServiceRole
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
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('❌ Exception in fetchActivitiesMapActivity:', msg);
        return activitiesMap;
    }
}
/**
 * Get site_id from command_id or conversation_id
 * This helper is used to determine the site context for activity validation
 */
async function getSiteIdFromCommandOrConversationActivity(params) {
    const { command_id, conversation_id } = params;
    console.log(`🔍 Getting site_id from command_id or conversation_id...`);
    console.log(`📋 Command ID: ${command_id || 'not provided'}`);
    console.log(`💬 Conversation ID: ${conversation_id || 'not provided'}`);
    try {
        // Try to get site_id from command_id first
        if (command_id) {
            const { data: commandData, error: commandError } = await client_1.supabaseServiceRole
                .from('commands')
                .select('site_id')
                .eq('id', command_id)
                .single();
            if (!commandError && commandData && commandData.site_id) {
                console.log(`✅ Found site_id from command: ${commandData.site_id}`);
                return {
                    success: true,
                    site_id: commandData.site_id
                };
            }
            if (commandError && commandError.code !== 'PGRST116') {
                // PGRST116 is "not found" - that's okay, we'll try conversation_id
                console.log(`⚠️ Error querying command (non-critical): ${commandError.message}`);
            }
        }
        // Try to get site_id from conversation_id
        if (conversation_id) {
            const { data: conversationData, error: conversationError } = await client_1.supabaseServiceRole
                .from('conversations')
                .select('site_id')
                .eq('id', conversation_id)
                .single();
            if (!conversationError && conversationData && conversationData.site_id) {
                console.log(`✅ Found site_id from conversation: ${conversationData.site_id}`);
                return {
                    success: true,
                    site_id: conversationData.site_id
                };
            }
            if (conversationError && conversationError.code !== 'PGRST116') {
                console.log(`⚠️ Error querying conversation (non-critical): ${conversationError.message}`);
            }
        }
        // If we get here, neither command_id nor conversation_id yielded a site_id
        console.log(`⚠️ Could not determine site_id from command_id or conversation_id`);
        return {
            success: false,
            error: 'Could not determine site_id from command_id or conversation_id'
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Exception getting site_id from command/conversation:`, errorMessage);
        return {
            success: false,
            error: errorMessage
        };
    }
}
