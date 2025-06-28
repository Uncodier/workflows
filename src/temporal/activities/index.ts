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
export * from './customerSupportActivities';
export * from './emailActivities';
export * from './whatsappActivities';
export * from './siteSetupActivities';
export * from './executeToolActivities';
export * from './campaignActivities';
export * from './leadActivities';
export * from './interventionActivities';
export * from './dataAnalystActivities';
export * from './cmoActivities';

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
import * as customerSupportActivities from './customerSupportActivities';
import * as emailActivities from './emailActivities';
import * as whatsappActivities from './whatsappActivities';
import * as siteSetupActivities from './siteSetupActivities';
import * as executeToolActivities from './executeToolActivities';
import * as campaignActivities from './campaignActivities';
import * as leadActivities from './leadActivities';
import * as interventionActivities from './interventionActivities';
import * as dataAnalystActivities from './dataAnalystActivities';
import * as cmoActivities from './cmoActivities';

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
  ...customerSupportActivities,
  ...emailActivities,
  ...whatsappActivities,
  ...siteSetupActivities,
  ...executeToolActivities,
  ...campaignActivities,
  ...leadActivities,
  ...interventionActivities,
  ...dataAnalystActivities,
  ...cmoActivities,
};

export type Activities = typeof activities; 