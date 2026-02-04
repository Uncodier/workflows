import { dataProcessingWorkflow } from './dataProcessingWorkflow';
import { scheduledApiPollingWorkflow } from './cronWorkflow';
import { syncEmailsWorkflow } from './syncEmailsWorkflow';
import { syncEmailsScheduleWorkflow } from './syncEmailsScheduleWorkflow';
import { scheduleActivitiesWorkflow } from './scheduleActivitiesWorkflow';
import { activityPrioritizationEngineWorkflow } from './activityPrioritizationEngineWorkflow';
import { dailyOperationsWorkflow } from './dailyOperationsWorkflow';
import { sendReportWorkflow } from './sendReportWorkflow';
import { scheduleCustomerSupportMessagesWorkflow } from './scheduleCustomerSupportMessagesWorkflow';
import { customerSupportMessageWorkflow } from './customerSupportWorkflow';
import { emailCustomerSupportMessageWorkflow } from './emailCustomerSupportWorkflow';
import { sendEmailFromAgent } from './sendEmailFromAgentWorkflow';
import { sendWhatsappFromAgent } from './sendWhatsappFromAgentWorkflow';
import { answerWhatsappMessageWorkflow, processWhatsAppMessagesWorkflow } from './answerWhatsappMessageWorkflow';
import { leadAttentionWorkflow } from './leadAttentionWorkflow';

// Export alias for backward compatibility
export const whatsappMessageWorkflow = answerWhatsappMessageWorkflow;

// ✅ Export aliases for agent workflows to support different naming conventions
export const sendWhatsappFromAgentWorkflow = sendWhatsappFromAgent;
export const sendEmailFromAgentWorkflow = sendEmailFromAgent;
import { siteSetupWorkflow } from './siteSetupWorkflow';
import { buildCampaignsWorkflow } from './buildCampaignsWorkflow';
import { buildSegmentsWorkflow } from './buildSegmentsWorkflow';
import { buildContentWorkflow } from './buildContentWorkflow';
import { leadFollowUpWorkflow } from './leadFollowUpWorkflow';
import { leadQualificationWorkflow } from './leadQualificationWorkflow';
import { leadResearchWorkflow } from './leadResearchWorkflow';
import { leadCompanyResearchWorkflow } from './leadCompanyResearchWorkflow';
import { buildSegmentsICPWorkflow, buildSingleSegmentICPWorkflow } from './buildSegmentsICPWorkflow';
import { humanInterventionWorkflow } from './humanInterventionWorkflow';
import { deepResearchWorkflow } from './deepResearchWorkflow';
import { dailyStandUpWorkflow } from './dailyStandUpWorkflow';
import { delayedExecutionWorkflow } from './delayedExecutionWorkflow';
import { leadGenerationWorkflow } from './leadGenerationWorkflow';
import { analyzeSiteWorkflow } from './analyzeSiteWorkflow';
import { sendNewsletterWorkflow } from './sendNewsletterWorkflow';
import { dailyProspectionWorkflow } from './dailyProspectionWorkflow';
import { dailyStrategicAccountsWorkflow } from './dailyStrategicAccountsWorkflow';
import { leadInvalidationWorkflow } from './leadInvalidationWorkflow';
import { startRobotWorkflow } from './startRobotWorkflow';
import { robotWorkflow } from './robotWorkflow';
import { promptRobotWorkflow } from './promptRobotWorkflow';
import { validateEmailWorkflow } from './validateEmailWorkflow';
import { webhookDispatchWorkflow } from './webhookDispatchWorkflow';
import { idealClientProfileMiningWorkflow } from './idealClientProfileMiningWorkflow';
import { idealClientProfilePageSearchWorkflow } from './idealClientProfilePageSearchWorkflow';
import { enrichLeadWorkflow } from './enrichLeadWorkflow';
import { generatePersonEmailWorkflow } from './generatePersonEmailWorkflow';
import { leadGenerationDomainSearchWorkflow } from './leadGenerationDomainSearchWorkflow';
import { sendApprovedMessagesWorkflow } from './sendApprovedMessagesWorkflow';

// Export workflows individually
export * from './dataProcessingWorkflow';
export * from './cronWorkflow';
export * from './syncEmailsWorkflow';
export * from './syncEmailsScheduleWorkflow';
export * from './scheduleActivitiesWorkflow';
export * from './activityPrioritizationEngineWorkflow';
export * from './dailyOperationsWorkflow';
export * from './sendReportWorkflow';
export * from './scheduleCustomerSupportMessagesWorkflow';
export * from './sendEmailFromAgentWorkflow';
export * from './startRobotWorkflow';
export * from './robotWorkflow';
export * from './promptRobotWorkflow';
export * from './sendWhatsappFromAgentWorkflow';
export * from './answerWhatsappMessageWorkflow';
export * from './siteSetupWorkflow';
export * from './buildCampaignsWorkflow';
export * from './buildSegmentsWorkflow';
export * from './buildContentWorkflow';
export * from './leadFollowUpWorkflow';
export * from './leadQualificationWorkflow';
export * from './leadResearchWorkflow';
export * from './leadCompanyResearchWorkflow';
export * from './buildSegmentsICPWorkflow';
export * from './humanInterventionWorkflow';
export * from './deepResearchWorkflow';
export * from './dailyStandUpWorkflow';
export * from './delayedExecutionWorkflow';
export * from './leadGenerationWorkflow';
export * from './analyzeSiteWorkflow';
export * from './sendNewsletterWorkflow';
export * from './leadAttentionWorkflow';
export * from './dailyProspectionWorkflow';
export * from './dailyStrategicAccountsWorkflow';
export * from './leadInvalidationWorkflow';
export * from './validateEmailWorkflow';
export * from './webhookDispatchWorkflow';
export * from './idealClientProfileMiningWorkflow';
export * from './idealClientProfilePageSearchWorkflow';
export * from './enrichLeadWorkflow';
export * from './generatePersonEmailWorkflow';
export * from './leadGenerationDomainSearchWorkflow';
export * from './sendApprovedMessagesWorkflow';

// Also export as a bundle for the client
export const workflows = {
  dataProcessingWorkflow,
  scheduledApiPollingWorkflow,
  syncEmailsWorkflow,
  syncEmailsScheduleWorkflow,
  scheduleActivitiesWorkflow,
  activityPrioritizationEngineWorkflow,
  dailyOperationsWorkflow,
  sendReportWorkflow,
  scheduleCustomerSupportMessagesWorkflow,
  customerSupportMessageWorkflow,
  emailCustomerSupportMessageWorkflow,
  sendEmailFromAgent,
  sendWhatsappFromAgent,
  answerWhatsappMessageWorkflow,
  processWhatsAppMessagesWorkflow,
  siteSetupWorkflow,
  buildCampaignsWorkflow,
  buildSegmentsWorkflow,
  buildContentWorkflow,
  leadFollowUpWorkflow,
  leadQualificationWorkflow,
  leadResearchWorkflow,
  leadCompanyResearchWorkflow,
  buildSegmentsICPWorkflow,
  buildSingleSegmentICPWorkflow,
  humanInterventionWorkflow,
  deepResearchWorkflow,
  dailyStandUpWorkflow,
  delayedExecutionWorkflow,
  leadGenerationWorkflow,
  analyzeSiteWorkflow,
  sendNewsletterWorkflow,
  leadAttentionWorkflow,
  dailyProspectionWorkflow,
  dailyStrategicAccountsWorkflow,
  leadInvalidationWorkflow,
  startRobotWorkflow,
  robotWorkflow,
  promptRobotWorkflow,
  validateEmailWorkflow,
  webhookDispatchWorkflow,
  idealClientProfileMiningWorkflow,
  idealClientProfilePageSearchWorkflow,
  enrichLeadWorkflow,
  generatePersonEmailWorkflow,
  leadGenerationDomainSearchWorkflow,
  sendApprovedMessagesWorkflow,
  // Alias for backward compatibility
  whatsappMessageWorkflow: answerWhatsappMessageWorkflow,
  // ✅ Aliases for agent workflows with different naming conventions
  sendWhatsappFromAgentWorkflow: sendWhatsappFromAgent,
  sendEmailFromAgentWorkflow: sendEmailFromAgent,
};

// Workflow names for Temporal Client (strings)
export const workflowNames = {
  dataProcessingWorkflow: 'dataProcessingWorkflow',
  scheduledApiPollingWorkflow: 'scheduledApiPollingWorkflow', 
  syncEmailsWorkflow: 'syncEmailsWorkflow',
  syncEmailsScheduleWorkflow: 'syncEmailsScheduleWorkflow',
  scheduleActivitiesWorkflow: 'scheduleActivitiesWorkflow',
  activityPrioritizationEngineWorkflow: 'activityPrioritizationEngineWorkflow',
  dailyOperationsWorkflow: 'dailyOperationsWorkflow',
  sendReportWorkflow: 'sendReportWorkflow',
  scheduleCustomerSupportMessagesWorkflow: 'scheduleCustomerSupportMessagesWorkflow',
  customerSupportMessageWorkflow: 'customerSupportMessageWorkflow',
  emailCustomerSupportMessageWorkflow: 'emailCustomerSupportMessageWorkflow',
  sendEmailFromAgent: 'sendEmailFromAgent',
  sendWhatsappFromAgent: 'sendWhatsappFromAgent',
  answerWhatsappMessageWorkflow: 'answerWhatsappMessageWorkflow',
  processWhatsAppMessagesWorkflow: 'processWhatsAppMessagesWorkflow',
  siteSetupWorkflow: 'siteSetupWorkflow',
  buildCampaignsWorkflow: 'buildCampaignsWorkflow',
  buildSegmentsWorkflow: 'buildSegmentsWorkflow',
  buildContentWorkflow: 'buildContentWorkflow',
  leadFollowUpWorkflow: 'leadFollowUpWorkflow',
  leadQualificationWorkflow: 'leadQualificationWorkflow',
  leadResearchWorkflow: 'leadResearchWorkflow',
  leadCompanyResearchWorkflow: 'leadCompanyResearchWorkflow',
  buildSegmentsICPWorkflow: 'buildSegmentsICPWorkflow',
  buildSingleSegmentICPWorkflow: 'buildSingleSegmentICPWorkflow',
  humanInterventionWorkflow: 'humanInterventionWorkflow',
  deepResearchWorkflow: 'deepResearchWorkflow',
  dailyStandUpWorkflow: 'dailyStandUpWorkflow',
  delayedExecutionWorkflow: 'delayedExecutionWorkflow',
  leadGenerationWorkflow: 'leadGenerationWorkflow',
  analyzeSiteWorkflow: 'analyzeSiteWorkflow',
  sendNewsletterWorkflow: 'sendNewsletterWorkflow',
  leadAttentionWorkflow: 'leadAttentionWorkflow',
  dailyProspectionWorkflow: 'dailyProspectionWorkflow',
  dailyStrategicAccountsWorkflow: 'dailyStrategicAccountsWorkflow',
  leadInvalidationWorkflow: 'leadInvalidationWorkflow',
  startRobotWorkflow: 'startRobotWorkflow',
  robotWorkflow: 'robotWorkflow',
  promptRobotWorkflow: 'promptRobotWorkflow',
  validateEmailWorkflow: 'validateEmailWorkflow',
  webhookDispatchWorkflow: 'webhookDispatchWorkflow',
  idealClientProfileMiningWorkflow: 'idealClientProfileMiningWorkflow',
  idealClientProfilePageSearchWorkflow: 'idealClientProfilePageSearchWorkflow',
  enrichLeadWorkflow: 'enrichLeadWorkflow',
  generatePersonEmailWorkflow: 'generatePersonEmailWorkflow',
  leadGenerationDomainSearchWorkflow: 'leadGenerationDomainSearchWorkflow',
  sendApprovedMessagesWorkflow: 'sendApprovedMessagesWorkflow',
  // Alias for backward compatibility
  whatsappMessageWorkflow: 'whatsappMessageWorkflow',
  // ✅ Aliases for agent workflows with different naming conventions
  sendWhatsappFromAgentWorkflow: 'sendWhatsappFromAgentWorkflow',
  sendEmailFromAgentWorkflow: 'sendEmailFromAgentWorkflow',
};

// Workflow types for type-safe execution
export type WorkflowType = keyof typeof workflows; 
