/**
 * Centralized mapping of workflow names to their corresponding activity configuration keys
 * Used by the workflow configuration validation system
 */

export const WORKFLOW_ACTIVITY_KEYS: Record<string, string> = {
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
export function getActivityKeyForWorkflow(workflowName: string): string | undefined {
  return WORKFLOW_ACTIVITY_KEYS[workflowName];
}

/**
 * Get all workflow names that have activity configuration keys
 * @returns Array of workflow names
 */
export function getConfiguredWorkflowNames(): string[] {
  return Object.keys(WORKFLOW_ACTIVITY_KEYS);
}

/**
 * Get all activity configuration keys
 * @returns Array of activity keys
 */
export function getAllActivityKeys(): string[] {
  return Object.values(WORKFLOW_ACTIVITY_KEYS);
}






