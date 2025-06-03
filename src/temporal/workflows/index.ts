import { dataProcessingWorkflow } from './dataProcessingWorkflow';
import { scheduledApiPollingWorkflow } from './cronWorkflow';
import { syncEmailsWorkflow } from './syncEmailsWorkflow';
import { syncEmailsScheduleWorkflow } from './syncEmailsScheduleWorkflow';
import { scheduleActivitiesWorkflow } from './scheduleActivitiesWorkflow';
import { activityPrioritizationEngineWorkflow } from './activityPrioritizationEngineWorkflow';
import { sendReportWorkflow } from './sendReportWorkflow';
import { scheduleCustomerSupportMessagesWorkflow } from './scheduleCustomerSupportMessagesWorkflow';
import { customerSupportMessageWorkflow, emailCustomerSupportMessageWorkflow } from './customerSupportWorkflow';
import { sendEmailFromAgent } from './sendEmailFromAgentWorkflow';
import { sendWhatsappFromAgent } from './sendWhatsappFromAgentWorkflow';
import { answerWhatsappMessageWorkflow, processWhatsAppMessagesWorkflow } from './answerWhatsappMessageWorkflow';
import { siteSetupWorkflow } from './siteSetupWorkflow';

// Export workflows individually
export * from './dataProcessingWorkflow';
export * from './cronWorkflow';
export * from './syncEmailsWorkflow';
export * from './syncEmailsScheduleWorkflow';
export * from './scheduleActivitiesWorkflow';
export * from './activityPrioritizationEngineWorkflow';
export * from './sendReportWorkflow';
export * from './scheduleCustomerSupportMessagesWorkflow';
export * from './sendEmailFromAgentWorkflow';
export * from './sendWhatsappFromAgentWorkflow';
export * from './answerWhatsappMessageWorkflow';
export * from './siteSetupWorkflow';

// Also export as a bundle for the client
export const workflows = {
  dataProcessingWorkflow,
  scheduledApiPollingWorkflow,
  syncEmailsWorkflow,
  syncEmailsScheduleWorkflow,
  scheduleActivitiesWorkflow,
  activityPrioritizationEngineWorkflow,
  sendReportWorkflow,
  scheduleCustomerSupportMessagesWorkflow,
  customerSupportMessageWorkflow,
  emailCustomerSupportMessageWorkflow,
  sendEmailFromAgent,
  sendWhatsappFromAgent,
  answerWhatsappMessageWorkflow,
  processWhatsAppMessagesWorkflow,
  siteSetupWorkflow,
};

// Workflow names for Temporal Client (strings)
export const workflowNames = {
  dataProcessingWorkflow: 'dataProcessingWorkflow',
  scheduledApiPollingWorkflow: 'scheduledApiPollingWorkflow', 
  syncEmailsWorkflow: 'syncEmailsWorkflow',
  syncEmailsScheduleWorkflow: 'syncEmailsScheduleWorkflow',
  scheduleActivitiesWorkflow: 'scheduleActivitiesWorkflow',
  activityPrioritizationEngineWorkflow: 'activityPrioritizationEngineWorkflow',
  sendReportWorkflow: 'sendReportWorkflow',
  scheduleCustomerSupportMessagesWorkflow: 'scheduleCustomerSupportMessagesWorkflow',
  customerSupportMessageWorkflow: 'customerSupportMessageWorkflow',
  emailCustomerSupportMessageWorkflow: 'emailCustomerSupportMessageWorkflow',
  sendEmailFromAgent: 'sendEmailFromAgent',
  sendWhatsappFromAgent: 'sendWhatsappFromAgent',
  answerWhatsappMessageWorkflow: 'answerWhatsappMessageWorkflow',
  processWhatsAppMessagesWorkflow: 'processWhatsAppMessagesWorkflow',
  siteSetupWorkflow: 'siteSetupWorkflow',
};

// Workflow types for type-safe execution
export type WorkflowType = keyof typeof workflows; 