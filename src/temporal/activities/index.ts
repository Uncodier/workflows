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
export * from './updateMessageStatusActivity';
export * from './interventionActivities';
export * from './dataAnalystActivities';
export * from './cmoActivities';
export * from './dailyStandUpConfigurationActivity';
export * from './leadGenerationActivities';
export * from './uxActivities';
export * from './newsletterActivities';
export * from './qualificationActivities';
export * from './dailyProspectionActivities';
export * from './robotActivities';
export * from './validateEmailActivities';
export * from './webhookActivities';
export * from './finderActivities';
export * from './activityControlActivities';
export * from './icpMiningConfigurationActivity';
export * from './icpMiningExecutionActivities';
export * from './icpMiningSchedulingActivity';
export * from './icpDispatcherActivities';
export * from './leadResearchStateActivity';
export * from './messageActivities';
export * from './outreachDeliveryActivities';
export * from './outreachConfigurationActivity';
export * from './icypeasActivities';
export * from './billingActivities';
export * from './reservationActivities';
export * from './subscriptionActivities';
export * from './taskActivities';
export * from './channelActivities';
export * from './channelGuidanceActivities';
export * from './outstandActivities';
export * from './outstandContentActivities';
export * from './syncedObjectActivities';
export * from './socialCommentSyncActivities';
export * from './sessionRecordingMaintenanceActivities';

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
import * as updateMessageStatusActivity from './updateMessageStatusActivity';
import * as interventionActivities from './interventionActivities';
import * as dataAnalystActivities from './dataAnalystActivities';
import * as cmoActivities from './cmoActivities';
import * as dailyStandUpConfigurationActivities from './dailyStandUpConfigurationActivity';
import * as leadGenerationActivities from './leadGenerationActivities';
import * as uxActivities from './uxActivities';
import * as newsletterActivities from './newsletterActivities';
import * as qualificationActivities from './qualificationActivities';
import * as dailyProspectionActivities from './dailyProspectionActivities';
import * as robotActivities from './robotActivities'; // Used in activities spread
import * as validateEmailActivities from './validateEmailActivities';
import * as webhookActivities from './webhookActivities';
import * as finderActivities from './finderActivities';
import * as activityControlActivities from './activityControlActivities';
import * as icpMiningConfigurationActivities from './icpMiningConfigurationActivity';
import * as icpMiningExecutionActivities from './icpMiningExecutionActivities';
import * as icpMiningSchedulingActivities from './icpMiningSchedulingActivity';
import * as icpDispatcherActivities from './icpDispatcherActivities';
import * as leadResearchStateActivities from './leadResearchStateActivity';
import * as messageActivities from './messageActivities';
import * as outreachDeliveryActivities from './outreachDeliveryActivities';
import * as outreachConfigurationActivities from './outreachConfigurationActivity';
import * as icypeasActivities from './icypeasActivities';
import * as billingActivities from './billingActivities';
import * as reservationActivities from './reservationActivities';
import * as subscriptionActivities from './subscriptionActivities';
import * as taskActivities from './taskActivities';
import * as channelActivities from './channelActivities';
import * as channelGuidanceActivities from './channelGuidanceActivities';
import * as outstandActivities from './outstandActivities';
import * as outstandContentActivities from './outstandContentActivities';
import * as syncedObjectActivities from './syncedObjectActivities';
import * as socialCommentSyncActivities from './socialCommentSyncActivities';
import * as sessionRecordingMaintenanceActivities from './sessionRecordingMaintenanceActivities';

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
  ...updateMessageStatusActivity,
  ...interventionActivities,
  ...dataAnalystActivities,
  ...cmoActivities,
  ...dailyStandUpConfigurationActivities,
  ...leadGenerationActivities,
  ...uxActivities,
  ...newsletterActivities,
  ...qualificationActivities,
  ...dailyProspectionActivities,
  ...robotActivities,
  ...validateEmailActivities,
  ...webhookActivities,
  ...finderActivities,
  ...activityControlActivities,
  ...icpMiningConfigurationActivities,
  ...icpMiningExecutionActivities,
  ...icpMiningSchedulingActivities,
  ...icpDispatcherActivities,
  ...leadResearchStateActivities,
  ...messageActivities,
  ...outreachDeliveryActivities,
  ...outreachConfigurationActivities,
  ...icypeasActivities,
  ...billingActivities,
  ...reservationActivities,
  ...subscriptionActivities,
  ...taskActivities,
  ...channelActivities,
  ...channelGuidanceActivities,
  ...outstandActivities,
  ...outstandContentActivities,
  ...syncedObjectActivities,
  ...socialCommentSyncActivities,
  ...sessionRecordingMaintenanceActivities
};

export type Activities = typeof activities; 

export { 
  executeDailyStandUpWorkflowsActivity,
  scheduleDailyOperationsWorkflowActivity,
  scheduleIndividualDailyStandUpsActivity,
  scheduleIndividualSiteAnalysisActivity,
  scheduleIndividualLeadGenerationActivity,
  scheduleIndividualDailyProspectionActivity,
  executeDailyProspectionWorkflowsActivity
} from './workflowSchedulingActivities'; 

export {
  logWorkflowExecutionActivity,
  trackApiCallActivity,
  fetchConfigurationActivity,
  storeWorkflowResultActivity,
  createResourceActivity,
  updateResourceActivity,
  deleteResourceActivity,
  checkSiteAnalysisActivity
} from './supabaseActivities'; 

export {
  fetchSitesDueForCreditRenewalActivity,
  renewSiteCreditsActivity,
  fetchSitesNeedingInitializationActivity,
  initializeSiteCreditsActivity
} from './billingActivities'; 
