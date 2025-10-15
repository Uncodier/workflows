"use strict";
/**
 * Centralized mapping of workflow names to their corresponding activity configuration keys
 * Used by the workflow configuration validation system
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.WORKFLOW_ACTIVITY_KEYS = void 0;
exports.getActivityKeyForWorkflow = getActivityKeyForWorkflow;
exports.getConfiguredWorkflowNames = getConfiguredWorkflowNames;
exports.getAllActivityKeys = getAllActivityKeys;
exports.WORKFLOW_ACTIVITY_KEYS = {
    dailyStandUpWorkflow: 'daily_resume_and_stand_up',
    idealClientProfileMiningWorkflow: 'icp_lead_generation',
    dailyProspectionWorkflow: 'leads_initial_cold_outreach',
    leadQualificationWorkflow: 'leads_follow_up',
    syncEmailsWorkflow: 'email_sync',
};
/**
 * Get the activity configuration key for a given workflow name
 * @param workflowName - The name of the workflow
 * @returns The activity key if found, undefined otherwise
 */
function getActivityKeyForWorkflow(workflowName) {
    return exports.WORKFLOW_ACTIVITY_KEYS[workflowName];
}
/**
 * Get all workflow names that have activity configuration keys
 * @returns Array of workflow names
 */
function getConfiguredWorkflowNames() {
    return Object.keys(exports.WORKFLOW_ACTIVITY_KEYS);
}
/**
 * Get all activity configuration keys
 * @returns Array of activity keys
 */
function getAllActivityKeys() {
    return Object.values(exports.WORKFLOW_ACTIVITY_KEYS);
}
