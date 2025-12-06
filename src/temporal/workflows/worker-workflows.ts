// This file is specifically for the worker to load workflows
export * from './dataProcessingWorkflow';
export * from './cronWorkflow'; 
export * from './syncEmailsWorkflow';
export * from './syncEmailsScheduleWorkflow';
export * from './scheduleActivitiesWorkflow';
export * from './activityPrioritizationEngineWorkflow';
export * from './dailyOperationsWorkflow';
export * from './sendReportWorkflow';
export * from './scheduleCustomerSupportMessagesWorkflow';
export * from './customerSupportWorkflow';
export * from './sendEmailFromAgentWorkflow';
export * from './sendWhatsappFromAgentWorkflow';
export * from './answerWhatsappMessageWorkflow';
// Export alias for backward compatibility  
export { answerWhatsappMessageWorkflow as whatsappMessageWorkflow } from './answerWhatsappMessageWorkflow';

// ✅ Export aliases for agent workflows to support different naming conventions
export { sendWhatsappFromAgent as sendWhatsappFromAgentWorkflow } from './sendWhatsappFromAgentWorkflow';
export { sendEmailFromAgent as sendEmailFromAgentWorkflow } from './sendEmailFromAgentWorkflow';

export * from './siteSetupWorkflow';
export * from './executeToolWorkflow';
export * from './buildCampaignsWorkflow';
export * from './buildSegmentsWorkflow';
export * from './buildSegmentsICPWorkflow';
export * from './buildContentWorkflow';
export * from './leadFollowUpWorkflow';
export * from './leadQualificationWorkflow';
export * from './leadResearchWorkflow';
export * from './humanInterventionWorkflow';
export * from './deepResearchWorkflow';
export * from './dailyStandUpWorkflow';
export * from './delayedExecutionWorkflow';
export * from './leadGenerationWorkflow';
export * from './analyzeSiteWorkflow';
export * from './leadAttentionWorkflow';
export * from './sendNewsletterWorkflow';
export * from './dailyProspectionWorkflow';
export * from './dailyStrategicAccountsWorkflow';
export * from './leadInvalidationWorkflow';
export * from './validateEmailWorkflow';
export * from './startRobotWorkflow';
export * from './robotWorkflow';
export * from './promptRobotWorkflow'; 
export * from './webhookDispatchWorkflow';
export * from './idealClientProfileMiningWorkflow';
export * from './idealClientProfilePageSearchWorkflow';
export * from './agentSupervisorWorkflow';
export * from './enrichLeadWorkflow';
export * from './generatePersonEmailWorkflow';
export * from './leadGenerationDomainSearchWorkflow';