// Export all activities
export * from './supabaseActivities';
export * from './apiActivities';
export * from './prioritizationActivities';
export * from './reportActivities';
export * from './projectActivities';
export * from './emailSyncActivities';
export * from './cronActivities';
export * from './workflowSchedulingActivities';
export * from './emailAnalysisActivities';

// Bundle all activities for the worker
import * as supabaseActivities from './supabaseActivities';
import * as apiActivities from './apiActivities';
import * as prioritizationActivities from './prioritizationActivities';
import * as reportActivities from './reportActivities';
import * as projectActivities from './projectActivities';
import * as emailSyncActivities from './emailSyncActivities';
import * as cronActivities from './cronActivities';
import * as workflowSchedulingActivities from './workflowSchedulingActivities';
import * as emailAnalysisActivities from './emailAnalysisActivities';

export const activities = {
  ...supabaseActivities,
  ...apiActivities,
  ...prioritizationActivities,
  ...reportActivities,
  ...projectActivities,
  ...emailSyncActivities,
  ...cronActivities,
  ...workflowSchedulingActivities,
  ...emailAnalysisActivities,
};

export type Activities = typeof activities; 